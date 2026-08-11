import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { ReminderConfigService } from '../../collections/reminder-config.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';
import { OrchestrationLogger } from '../../ai/orchestrator/orchestration-logger.service';
import { shouldSendReminder, hasBecomeOverdue } from '../schedulers/reminder-rules';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Un ciclo diario: revisa TODAS las cuotas PENDING/OVERDUE y decide, con las
 * reglas puras de reminder-rules.ts, a cuáles corresponde recordarles hoy.
 * Nunca envía texto libre — siempre plantilla (research.md §2), y nunca si
 * la plantilla no está aprobada (bloqueo explícito, no falla en silencio).
 */
@Processor('reminders', { concurrency: 1 })
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminderConfig: ReminderConfigService,
    private readonly sender: WhatsappSenderService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const config = await this.reminderConfig.get();

    if (!config.templateApproved) {
      this.logger.warn(
        'Ciclo de recordatorios bloqueado: la plantilla de WhatsApp no está aprobada por Meta.',
      );
      await this.orchestrationLogger.logEvent({
        eventType: 'reminder_cycle_blocked',
        payload: { reason: 'template_not_approved' },
      });
      return;
    }

    const maxDaysBefore = Math.max(0, ...config.daysBefore);
    const now = new Date();
    const windowStart = new Date(now.getTime() - MS_PER_DAY); // margen para OVERDUE
    const windowEnd = new Date(now.getTime() + (maxDaysBefore + 1) * MS_PER_DAY);

    const candidates = await this.prisma.quota.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { gte: windowStart, lte: windowEnd },
      },
      include: { client: true },
    });

    for (const quota of candidates) {
      if (hasBecomeOverdue(quota, config, now)) {
        await this.prisma.quota.update({
          where: { id: quota.id },
          data: { status: 'OVERDUE' },
        });
        continue;
      }

      if (!shouldSendReminder(quota, config, now)) {
        continue;
      }

      await this.sender.sendTemplate(quota.client.phone, config.templateName, [
        quota.client.name,
        quota.amount.toString(),
      ]);

      await this.prisma.quota.update({
        where: { id: quota.id },
        data: {
          reminderAttempts: quota.reminderAttempts + 1,
          lastReminderAt: now,
        },
      });

      await this.orchestrationLogger.logEvent({
        eventType: 'quota_reminder_sent',
        payload: { quotaId: quota.id, attempt: quota.reminderAttempts + 1 },
      });
    }
  }
}
