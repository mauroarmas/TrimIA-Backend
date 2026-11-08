import { ChannelFinancingNoticeAdapter } from './channel-financing-notice.adapter';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { financingTestPrisma } from './testing/financing-test-harness';
import { FinancingService } from './financing.service';
import {
  FinancingNoticeService,
  FINANCING_CLAIM_TTL_MS,
} from './financing-notice.service';
import { SimulatedFinancingNoticeAdapter } from './simulated-financing-notice.adapter';
const enabled = !!process.env.TEST_DATABASE_URL;
(enabled ? describe : describe.skip)(
  'Notice failure recovery with PostgreSQL',
  () => {
    const prisma = enabled ? financingTestPrisma() : null!;
    const config = new ConfigService({
      FINANCING_NOTICE_TRANSPORT: 'simulated',
    });
    const finance = new FinancingService(prisma as any, config, {} as any);
    const normal = new SimulatedFinancingNoticeAdapter();
    let actor: string;
    beforeAll(async () => {
      const sector = await prisma.sector.create({
        data: { name: 'Notice ' + randomUUID(), agentType: 'ADMIN' },
      });
      actor = (
        await prisma.employee.create({
          data: {
            name: 'Responsable aviso',
            phone: randomUUID(),
            email: randomUUID() + '@example.invalid',
            password: 'unused',
            role: 'SUPERVISOR',
            sectorId: sector.id,
          },
        })
      ).id;
    });
    afterAll(() => prisma.$disconnect());
    async function pending() {
      const phone = '5493815' + String(Date.now()).slice(-6);
      const client = await prisma.client.create({
        data: { name: 'Aviso ' + randomUUID(), phone, dni: '30000008' },
      });
      const conversation = await prisma.conversation.create({
        data: { channel: 'WHATSAPP', externalId: phone, clientId: client.id },
      });
      const snapshot = {
        name: client.name,
        dni: '30000008',
        productSummary: 'Prueba recuperación',
        amount: '100.00',
        currency: 'ARS',
        priceSource: 'SUPERVISOR',
        priceConfirmedById: actor,
        priceConfirmedAt: new Date().toISOString(),
        conversationId: conversation.id,
        phone,
        inputVersion: 1,
      };
      const request = await prisma.purchaseRequest.create({
        data: {
          clientId: client.id,
          conversationId: conversation.id,
          productSummary: snapshot.productSummary,
          amount: '100.00',
          modality: 'FINANCED',
          inputSnapshot: snapshot,
          evaluationState: 'READY',
        },
      });
      await prisma.creditAssessment.create({
        data: {
          clientId: client.id,
          purchaseRequestId: request.id,
          requestVersion: 1,
          inputSnapshot: snapshot,
          verdict: 'APPROVED',
          source: 'MOCK',
          reason: 'Prueba',
        },
      });
      return { request, conversation };
    }
    async function resolved() {
      const { request, conversation } = await pending();
      await finance.review(
        request.id,
        { expectedVersion: 1, decision: 'APPROVED' },
        actor,
      );
      return {
        request,
        conversation,
        notice: await prisma.outboundCommunication.findFirstOrThrow({
          where: { purchaseRequestId: request.id },
        }),
      };
    }
    it('envía la decisión a WhatsApp una sola vez y conserva la aceptación de n8n', async () => {
      const { notice, conversation } = await resolved();
      const realConfig = new ConfigService({
        FINANCING_NOTICE_TRANSPORT: 'simulated',
        FINANCING_WHATSAPP_NOTICES_ENABLED: true,
      });
      const sender = { send: jest.fn().mockResolvedValue(undefined) };
      const service = new FinancingNoticeService(
        prisma as any,
        realConfig,
        new ChannelFinancingNoticeAdapter(realConfig, sender as any),
      );
      await service.dispatch(notice.id);
      await service.dispatch(notice.id);
      const saved = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(saved.status).toBe('ACCEPTED');
      expect(saved.transportMode).toBe('whatsapp');
      expect(saved.providerMessageId).toMatch(/^n8n:/);
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(sender.send).toHaveBeenCalledWith(
        conversation.externalId,
        notice.body,
        'WHATSAPP',
      );
    });
    it('FAILED admite retry conservando decisión, aviso y mensaje', async () => {
      const { request, notice } = await resolved();
      const transport: any = {
        send: jest
          .fn()
          .mockResolvedValueOnce({
            kind: 'NOT_ACCEPTED',
            code: 'FIXTURE_REJECTION',
          })
          .mockImplementationOnce((v) => normal.send(v)),
      };
      const service = new FinancingNoticeService(
        prisma as any,
        config,
        transport,
      );
      await service.dispatch(notice.id);
      const failed = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(failed.status).toBe('FAILED');
      const messageId = failed.messageId;
      await service.retry(notice.id, failed.version, actor);
      await service.dispatch(notice.id);
      const accepted = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.messageId).toBe(messageId);
      expect(accepted.attemptCount).toBe(2);
      expect(
        (
          await prisma.purchaseRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe('APPROVED');
    });
    it('respuesta HTTP vacía no acredita aceptación', async () => {
      const { notice } = await resolved();
      const service = new FinancingNoticeService(prisma as any, config, {
        send: async () => undefined,
      } as any);
      await service.dispatch(notice.id);
      const uncertain = await prisma.outboundCommunication.findUniqueOrThrow({
        where: { id: notice.id },
      });
      expect(uncertain.status).toBe('UNCERTAIN');
      await expect(
        service.retry(notice.id, uncertain.version, actor),
      ).rejects.toThrow();
    });
    it('claim vencido es incierto y una respuesta tardía no lo revierte', async () => {
      const { notice } = await resolved();
      let release: any;
      const wait = new Promise<any>((resolve) => (release = resolve));
      let input: any;
      const service = new FinancingNoticeService(prisma as any, config, {
        send: async (i) => {
          input = i;
          return wait;
        },
      });
      const job = service.dispatch(notice.id);
      for (let n = 0; n < 100 && !input; n++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(input).toBeDefined();
      await prisma.outboundCommunication.update({
        where: { id: notice.id },
        data: {
          attemptStartedAt: new Date(
            Date.now() - FINANCING_CLAIM_TTL_MS - 1000,
          ),
        },
      });
      await service.expireClaims();
      release({
        kind: 'ACCEPTED',
        noticeId: notice.id,
        attemptToken: input.attemptToken,
        providerMessageId: 'sim:late',
      });
      await job;
      expect(
        (
          await prisma.outboundCommunication.findUniqueOrThrow({
            where: { id: notice.id },
          })
        ).status,
      ).toBe('UNCERTAIN');
    });
    it.each(['disabled', 'HUMAN_HANDLING'])(
      'no reclama ni despacha si %s',
      async (mode) => {
        const { notice, conversation } = await resolved();
        const transport = { send: jest.fn() };
        if (mode === 'HUMAN_HANDLING')
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { status: 'HUMAN_HANDLING' },
          });
        const service = new FinancingNoticeService(
          prisma as any,
          new ConfigService({
            FINANCING_NOTICE_TRANSPORT:
              mode === 'disabled' ? 'disabled' : 'simulated',
          }),
          transport,
        );
        await service.dispatch(notice.id);
        expect(transport.send).not.toHaveBeenCalled();
        const row = await prisma.outboundCommunication.findUniqueOrThrow({
          where: { id: notice.id },
        });
        expect(row.status).toBe('PENDING');
        expect(row.messageId).toBeNull();
      },
    );
    it('fallo creando aviso revierte decisión y evento', async () => {
      const { request } = await pending();
      const broken: any = {
        $transaction: (fn: any) =>
          prisma.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(target, key) {
                  return key === 'outboundCommunication'
                    ? {
                        create: async () => {
                          throw Error('Aviso no persistido');
                        },
                      }
                    : target[key as keyof typeof target];
                },
              }),
            ),
          ),
      };
      const service = new FinancingService(broken, config, {} as any);
      await expect(
        service.review(
          request.id,
          { expectedVersion: 1, decision: 'APPROVED' },
          actor,
        ),
      ).rejects.toThrow('Aviso no persistido');
      expect(
        (
          await prisma.purchaseRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe('PENDING_REVIEW');
      expect(
        await prisma.outboundCommunication.count({
          where: { purchaseRequestId: request.id },
        }),
      ).toBe(0);
    });
    it('cancelación y revisión concurrentes dejan una transición y no un aviso tardío', async () => {
      const { request } = await pending();
      const outcomes = await Promise.allSettled([
        finance.cancel(request.id, { expectedVersion: 1 }, actor),
        finance.review(
          request.id,
          { expectedVersion: 1, decision: 'APPROVED' },
          actor,
        ),
      ]);
      expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
      const row = await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(
        await prisma.outboundCommunication.count({
          where: { purchaseRequestId: request.id },
        }),
      ).toBe(row.status === 'APPROVED' ? 1 : 0);
    });
    it('legado pendiente requiere adopción; el resuelto no genera otro aviso', async () => {
      const { request } = await pending();
      await prisma.purchaseRequest.update({
        where: { id: request.id },
        data: { inputSnapshot: undefined },
      });
      await prisma.$executeRaw`UPDATE "PurchaseRequest" SET "inputSnapshot"=NULL, "evaluationState"=NULL WHERE id=${request.id}`;
      await expect(
        finance.review(
          request.id,
          { expectedVersion: 1, decision: 'APPROVED' },
          actor,
        ),
      ).rejects.toThrow();
      await finance.correct(
        request.id,
        {
          expectedVersion: 1,
          name: 'Legado confirmado',
          dni: '30000008',
          productSummary: 'Producto legado',
          amount: '100.00',
          confirmData: true,
          note: 'Datos confirmados por humano',
        },
        actor,
      );
      const row = await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(row.inputSnapshot).not.toBeNull();
      expect(row.evaluationState).toBe('PENDING');
      expect(row.prospectId).not.toBeNull();
      expect(
        await prisma.outboundCommunication.count({
          where: { purchaseRequestId: request.id },
        }),
      ).toBe(0);
      const { notice, request: resolvedRequest } = await resolved();
      await expect(
        finance.review(
          resolvedRequest.id,
          { expectedVersion: 1, decision: 'APPROVED' },
          actor,
        ),
      ).rejects.toThrow();
      expect(
        await prisma.outboundCommunication.count({
          where: { purchaseRequestId: resolvedRequest.id },
        }),
      ).toBe(1);
      expect(notice.status).toBe('PENDING');
    });
    it('corrección y revisión concurrentes no aprueban una versión obsoleta', async () => {
      const { request } = await pending();
      const outcomes = await Promise.allSettled([
        finance.correct(
          request.id,
          {
            expectedVersion: 1,
            name: 'Datos corregidos',
            dni: '30000008',
            productSummary: 'Producto nuevo',
            amount: '200.00',
            confirmData: true,
            note: 'Confirmación humana',
          },
          actor,
        ),
        finance.review(
          request.id,
          { expectedVersion: 1, decision: 'APPROVED' },
          actor,
        ),
      ]);
      expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
      const row = await prisma.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      if (row.status === 'APPROVED') expect(row.amount!.toString()).toBe('100');
      else {
        expect(row.amount!.toString()).toBe('200');
        expect(row.evaluationState).toBe('PENDING');
      }
    });
  },
);
