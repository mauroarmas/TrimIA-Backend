import { daysUntilDue, shouldSendReminder, hasBecomeOverdue } from './reminder-rules';

describe('reminder-rules', () => {
  const config = { daysBefore: [7, 3, 0], maxAttempts: 3 };
  const now = new Date('2026-08-10T12:00:00Z');

  describe('daysUntilDue', () => {
    it('calcula días completos, ignorando la hora del día', () => {
      expect(daysUntilDue(new Date('2026-08-17T23:00:00Z'), now)).toBe(7);
      expect(daysUntilDue(new Date('2026-08-10T00:00:00Z'), now)).toBe(0);
      expect(daysUntilDue(new Date('2026-08-05T00:00:00Z'), now)).toBe(-5);
    });
  });

  describe('shouldSendReminder', () => {
    it('envía cuando faltan exactamente 7, 3 o 0 días', () => {
      for (const days of [7, 3, 0]) {
        const dueDate = new Date(now.getTime() + days * 86400000);
        expect(
          shouldSendReminder({ status: 'PENDING', dueDate, reminderAttempts: 0 }, config, now),
        ).toBe(true);
      }
    });

    it('NO envía en un día fuera de daysBefore (ej. faltan 5 días)', () => {
      const dueDate = new Date(now.getTime() + 5 * 86400000);
      expect(
        shouldSendReminder({ status: 'PENDING', dueDate, reminderAttempts: 0 }, config, now),
      ).toBe(false);
    });

    it('NO envía si ya alcanzó el máximo de intentos', () => {
      const dueDate = new Date(now.getTime());
      expect(
        shouldSendReminder({ status: 'PENDING', dueDate, reminderAttempts: 3 }, config, now),
      ).toBe(false);
    });

    it('NO envía si la cuota está PAID, MANUAL o AWAITING_CONFIRMATION', () => {
      const dueDate = new Date(now.getTime());
      for (const status of ['PAID', 'MANUAL', 'AWAITING_CONFIRMATION']) {
        expect(
          shouldSendReminder({ status, dueDate, reminderAttempts: 0 }, config, now),
        ).toBe(false);
      }
    });

    it('SÍ puede reintentar sobre una cuota ya OVERDUE (el cliente respondió tarde)', () => {
      const dueDate = new Date(now.getTime() - 10 * 86400000);
      expect(
        shouldSendReminder(
          { status: 'OVERDUE', dueDate: new Date(now.getTime() + 0), reminderAttempts: 0 },
          config,
          now,
        ),
      ).toBe(true);
    });
  });

  describe('hasBecomeOverdue', () => {
    it('pasa a OVERDUE cuando ya venció y se agotaron los intentos', () => {
      const dueDate = new Date(now.getTime() - 86400000); // venció ayer
      expect(
        hasBecomeOverdue({ status: 'PENDING', dueDate, reminderAttempts: 3 }, config, now),
      ).toBe(true);
    });

    it('NO pasa a OVERDUE si todavía quedan intentos disponibles', () => {
      const dueDate = new Date(now.getTime() - 86400000);
      expect(
        hasBecomeOverdue({ status: 'PENDING', dueDate, reminderAttempts: 1 }, config, now),
      ).toBe(false);
    });

    it('NO pasa a OVERDUE si todavía no venció', () => {
      const dueDate = new Date(now.getTime() + 86400000);
      expect(
        hasBecomeOverdue({ status: 'PENDING', dueDate, reminderAttempts: 3 }, config, now),
      ).toBe(false);
    });
  });
});
