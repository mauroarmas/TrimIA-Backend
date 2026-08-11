const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Días calendario entre hoy y el vencimiento (puede ser negativo si ya venció). */
export function daysUntilDue(dueDate: Date, now: Date): number {
  return Math.round((startOfUtcDay(dueDate) - startOfUtcDay(now)) / MS_PER_DAY);
}

export interface ReminderCandidate {
  status: string;
  dueDate: Date;
  reminderAttempts: number;
}

export interface ReminderRulesConfig {
  daysBefore: number[];
  maxAttempts: number;
}

/**
 * Decide si hoy corresponde enviar un recordatorio para esta cuota.
 * Función pura — sin acceso a DB/red, fácil de testear exhaustivamente.
 */
export function shouldSendReminder(
  quota: ReminderCandidate,
  config: ReminderRulesConfig,
  now: Date,
): boolean {
  if (quota.status !== 'PENDING' && quota.status !== 'OVERDUE') {
    return false;
  }
  if (quota.reminderAttempts >= config.maxAttempts) {
    return false;
  }
  return config.daysBefore.includes(daysUntilDue(quota.dueDate, now));
}

/** Ya venció Y agotó los intentos configurados → pasa a OVERDUE. */
export function hasBecomeOverdue(
  quota: ReminderCandidate,
  config: ReminderRulesConfig,
  now: Date,
): boolean {
  return (
    quota.status === 'PENDING' &&
    daysUntilDue(quota.dueDate, now) < 0 &&
    quota.reminderAttempts >= config.maxAttempts
  );
}
