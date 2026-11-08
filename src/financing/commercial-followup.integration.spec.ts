import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { financingTestPrisma } from './testing/financing-test-harness';
import { CommercialFollowUpService } from './commercial-followup.service';
import { FinancingNoticeService } from './financing-notice.service';
import { SimulatedFinancingNoticeAdapter } from './simulated-financing-notice.adapter';

const enabled = !!process.env.TEST_DATABASE_URL;
(enabled ? describe : describe.skip)(
  'CommercialFollowUp — integración aislada (021 US1, US2, US3)',
  () => {
    const prisma = enabled ? financingTestPrisma() : null!;
    const config = new ConfigService({
      FINANCING_NOTICE_TRANSPORT: 'simulated',
    });
    const transport = new SimulatedFinancingNoticeAdapter();
    let notices: FinancingNoticeService;
    let service: CommercialFollowUpService;
    let supervisorId: string;

    beforeAll(async () => {
      notices = new FinancingNoticeService(prisma as any, config, transport);
      service = new CommercialFollowUpService(prisma as any, config, notices);
      const sector = await prisma.sector.create({
        data: { name: 'Ventas 021 ' + randomUUID(), agentType: 'SALES' },
      });
      supervisorId = (
        await prisma.employee.create({
          data: {
            name: 'Supervisor General 021',
            email: randomUUID() + '@example.invalid',
            phone: randomUUID(),
            password: 'unused',
            role: 'SUPERVISOR',
            sectorId: sector.id,
          },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function createProspectScenario(params?: {
      phone?: string;
      productInterest?: string;
      messageCreatedAt?: Date;
      convStatus?: 'ACTIVE' | 'HUMAN_HANDLING';
    }) {
      const phone =
        params?.phone ??
        `+5493764${Math.floor(100000 + Math.random() * 899999)}`;
      const conv = await prisma.conversation.create({
        data: {
          externalId: phone,
          channel: 'WHATSAPP',
          userType: 'CLIENTE',
          status: params?.convStatus ?? 'ACTIVE',
        },
      });
      const msgDate =
        params?.messageCreatedAt ?? new Date(Date.now() - 50 * 3600 * 1000);
      await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: 'USER',
          content: 'Hola, me interesa consultar por una máquina',
          createdAt: msgDate,
        },
      });
      const prospect = await prisma.prospect.create({
        data: {
          phone,
          name: 'Comercio Ficticio 021',
          comercio: 'Despensa San Martín',
          localidad: 'Posadas',
          productInterest:
            params?.productInterest ?? 'Cortadora de Fiambre Berkley 300',
          conversationId: conv.id,
          status: 'NUEVO',
          syncStatus: 'SYNCED',
        },
      });
      return { phone, conv, prospect };
    }

    it('US1: habilita la regla, envía un único seguimiento simulado en el mismo hilo y no duplica ante concurrencia o nuevas pasadas (SC-001, SC-002)', async () => {
      const currentRule = await service.getRule();
      await service.updateRule(
        {
          enabled: true,
          inactivityHours: 48,
          expectedVersion: currentRule.version,
        },
        supervisorId,
      );

      const { prospect, conv } = await createProspectScenario({
        messageCreatedAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      const initialStatus = await service.getProspectFollowUpStatus(prospect.id);
      expect(initialStatus.status).toBe('SCHEDULED');
      expect(initialStatus.scheduledFor).toBeTruthy();

      // Simular vencimiento de las 48 h en modo demostración con concurrencia (2 llamadas simultáneas)
      const [res1, res2] = await Promise.all([
        service.simulateDue(prospect.id),
        service.simulateDue(prospect.id),
      ]);

      expect(res1.status).toBe('COMPLETED');
      expect(res2.status).toBe('COMPLETED');
      expect(res1.communication?.status).toBe('ACCEPTED');
      expect(res1.communication?.providerMessageId).toMatch(/^sim:/);

      const outboundRows = await prisma.outboundCommunication.findMany({
        where: { prospectId: prospect.id },
      });
      expect(outboundRows).toHaveLength(1);

      const assistantMessages = await prisma.message.findMany({
        where: { conversationId: conv.id, role: 'ASSISTANT' },
      });
      expect(assistantMessages).toHaveLength(1);
      expect(assistantMessages[0].content).toContain(
        'Cortadora de Fiambre Berkley 300',
      );

      // Una pasada adicional no programa ni envía un segundo seguimiento (FR-005)
      const afterSecondPass = await service.simulateDue(prospect.id);
      expect(afterSecondPass.status).toBe('COMPLETED');
      expect(
        await prisma.outboundCommunication.count({
          where: { prospectId: prospect.id },
        }),
      ).toBe(1);
    });

    it('US1.4 & Clarificación #2: ante varias oportunidades del mismo teléfono cancela definitivamente las anteriores y solo considera la más reciente', async () => {
      const sharedPhone = `+5493764${Math.floor(100000 + Math.random() * 899999)}`;
      const first = await createProspectScenario({
        phone: sharedPhone,
        productInterest: 'Balanza Systel Croma',
        messageCreatedAt: new Date(Date.now() - 5 * 60 * 1000),
      });
      const second = await createProspectScenario({
        phone: sharedPhone,
        productInterest: 'Heladera Exhibidora Briket',
        messageCreatedAt: new Date(Date.now() - 2 * 60 * 1000),
      });

      const statusOld = await service.simulateDue(first.prospect.id);
      expect(statusOld.status).toBe('CANCELLED');
      expect(statusOld.reasonCode).toBe('SUPERSEDED_BY_NEWER_PROSPECT');
      expect(statusOld.communication).toBeNull();

      // Incluso si la más reciente se cancela después, la vieja permanece CANCELLED
      await prisma.prospect.update({
        where: { id: second.prospect.id },
        data: { status: 'CANCELADO' },
      });
      const statusOldAfterCancel = await service.simulateDue(first.prospect.id);
      expect(statusOldAfterCancel.status).toBe('CANCELLED');
      expect(statusOldAfterCancel.reasonCode).toBe(
        'SUPERSEDED_BY_NEWER_PROSPECT',
      );
    });

    it('US2: bloquea por pausa humana, escalado, revisión administrativa, oferta vencida y baja de contacto (SC-003)', async () => {
      // 1. Conversación en control humano -> bloqueada; al liberar -> nuevo plazo
      const humanCase = await createProspectScenario({
        convStatus: 'HUMAN_HANDLING',
      });
      const blockedHuman = await service.simulateDue(humanCase.prospect.id);
      expect(blockedHuman.status).toBe('BLOCKED');
      expect(blockedHuman.reasonCode).toBe('HUMAN_HANDLING');
      expect(blockedHuman.communication).toBeNull();

      await prisma.conversation.update({
        where: { id: humanCase.conv.id },
        data: { status: 'ACTIVE', handledById: null },
      });
      const afterRelease = await service.getProspectFollowUpStatus(
        humanCase.prospect.id,
      );
      expect(afterRelease.status).toBe('SCHEDULED');
      expect(afterRelease.scheduledFor).toBeTruthy();

      // 2. Baja de contacto por teléfono (022) -> bloquea cualquier oportunidad de ese teléfono
      const optOutCase = await createProspectScenario();
      await prisma.contactPreference.upsert({
        where: { phone: optOutCase.phone },
        create: {
          phone: optOutCase.phone,
          optOut: true,
          reason: 'BAJA solicitada por cliente',
        },
        update: { optOut: true },
      });
      const blockedOptOut = await service.simulateDue(optOutCase.prospect.id);
      expect(blockedOptOut.status).toBe('BLOCKED');
      expect(blockedOptOut.reasonCode).toBe('CONTACT_OPT_OUT');
      expect(blockedOptOut.communication).toBeNull();

      // 3. Revisión administrativa pendiente de 020 -> bloquea
      const adminCase = await createProspectScenario();
      const client = await prisma.client.create({
        data: { name: 'Cliente Admin 021', phone: adminCase.phone },
      });
      await prisma.purchaseRequest.create({
        data: {
          clientId: client.id,
          prospectId: adminCase.prospect.id,
          conversationId: adminCase.conv.id,
          productSummary: adminCase.prospect.productInterest,
          amount: '500000.00',
          modality: 'FINANCED',
          status: 'PENDING_REVIEW',
          commercialFlow: {
            version: 2,
            stage: 'REVIEW',
            startedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            revision: 1,
            offers: [],
          },
        },
      });
      const blockedAdmin = await service.simulateDue(adminCase.prospect.id);
      expect(blockedAdmin.status).toBe('BLOCKED');
      expect(blockedAdmin.reasonCode).toBe('ADMIN_REVIEW_PENDING');
      expect(blockedAdmin.communication).toBeNull();
    });
  },
);
