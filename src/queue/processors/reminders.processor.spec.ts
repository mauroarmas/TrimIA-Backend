import { RemindersProcessor } from './reminders.processor';
import { PrismaService } from '../../database/prisma.service';
import { ReminderConfigService } from '../../collections/reminder-config.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../../ai/orchestrator/orchestration-logger.service';

describe('RemindersProcessor', () => {
  let processor: RemindersProcessor;
  let prisma: {
    quota: { findMany: jest.Mock; update: jest.Mock };
  };
  let reminderConfig: { get: jest.Mock };
  let sender: { sendTemplate: jest.Mock };
  let logger: { logEvent: jest.Mock };

  const config = {
    id: 'cfg-1',
    daysBefore: [7, 3, 0],
    maxAttempts: 3,
    templateName: 'recordatorio_cuota',
    templateApproved: true,
  };

  beforeEach(() => {
    prisma = {
      quota: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    };
    reminderConfig = { get: jest.fn().mockResolvedValue(config) };
    sender = { sendTemplate: jest.fn() };
    logger = { logEvent: jest.fn() };

    processor = new RemindersProcessor(
      prisma as unknown as PrismaService,
      reminderConfig as unknown as ReminderConfigService,
      sender as unknown as WhatsappSenderService,
      logger as unknown as OrchestrationLogger,
    );
  });

  it('NO envía nada y audita el bloqueo si la plantilla no está aprobada', async () => {
    reminderConfig.get.mockResolvedValue({
      ...config,
      templateApproved: false,
    });

    await processor.process({} as any);

    expect(sender.sendTemplate).not.toHaveBeenCalled();
    expect(prisma.quota.findMany).not.toHaveBeenCalled();
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'reminder_cycle_blocked' }),
    );
  });

  it('envía un recordatorio a las cuotas que corresponden hoy e incrementa los intentos', async () => {
    const dueToday = new Date();
    prisma.quota.findMany.mockResolvedValue([
      {
        id: 'inst-1',
        status: 'PENDING',
        dueDate: dueToday,
        reminderAttempts: 0,
        amount: { toString: () => '42000' },
        client: { phone: '5491100000000', name: 'Juan' },
      },
    ]);

    await processor.process({} as any);

    expect(sender.sendTemplate).toHaveBeenCalledWith(
      '5491100000000',
      'recordatorio_cuota',
      expect.any(Array),
    );
    expect(prisma.quota.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inst-1' },
        data: expect.objectContaining({ reminderAttempts: 1 }),
      }),
    );
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'quota_reminder_sent' }),
    );
  });

  it('pasa a OVERDUE una cuota vencida que ya agotó los intentos, sin enviar nada', async () => {
    const overdue = new Date(Date.now() - 5 * 86400000);
    prisma.quota.findMany.mockResolvedValue([
      {
        id: 'inst-2',
        status: 'PENDING',
        dueDate: overdue,
        reminderAttempts: 3,
        client: { phone: '5491100000000', name: 'Juan' },
      },
    ]);

    await processor.process({} as any);

    expect(sender.sendTemplate).not.toHaveBeenCalled();
    expect(prisma.quota.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inst-2' },
        data: { status: 'OVERDUE' },
      }),
    );
  });

  it('no toca una cuota que no corresponde hoy ni está vencida', async () => {
    const dueInFiveDays = new Date(Date.now() + 5 * 86400000);
    prisma.quota.findMany.mockResolvedValue([
      {
        id: 'inst-3',
        status: 'PENDING',
        dueDate: dueInFiveDays,
        reminderAttempts: 0,
        client: { phone: '5491100000000', name: 'Juan' },
      },
    ]);

    await processor.process({} as any);

    expect(sender.sendTemplate).not.toHaveBeenCalled();
    expect(prisma.quota.update).not.toHaveBeenCalled();
  });
});
