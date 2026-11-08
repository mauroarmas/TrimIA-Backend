import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { FOLLOWUP_REASON_LABELS } from './commercial-followup.template';

export type IncomingOptOutClassification =
  | 'OPT_OUT'
  | 'PRODUCT_REJECTION'
  | 'AMBIGUOUS_OPT_OUT'
  | 'NONE';

export interface ContactPreferenceHistoryEntry {
  action: 'OPT_OUT' | 'REACTIVATED';
  at: string;
  reason: string;
  sourceMessageId: string | null;
  sourceConversationId: string | null;
  actorId: string | null;
}

export const OPT_OUT_CONFIRMATION_MESSAGE =
  'Registramos tu solicitud de baja. A partir de ahora detuvimos todos los avisos y seguimientos automáticos para tu número. Si en algún momento necesitás hacernos una consulta, podés escribirnos por este medio.';

export const AMBIGUOUS_OPT_OUT_CLARIFICATION_MESSAGE =
  'Para no equivocarnos: ¿querés dejar de recibir todos los avisos automáticos de Credimisión (respondé BAJA) o solo desestimar el producto o consulta actual?';

export function phoneVariants(phone: string): string[] {
  const trimmed = (phone || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  const set = new Set<string>();
  if (trimmed) set.add(trimmed);
  if (digits) {
    set.add(digits);
    set.add(`+${digits}`);
  }
  return [...set];
}

export function normalizeTextForOptOut(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¡!¿?.,;:"'()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyIncomingOptOutText(
  text: string,
  callerPhone?: string,
): IncomingOptOutClassification {
  const norm = normalizeTextForOptOut(text);
  if (!norm) return 'NONE';

  // 1. Distinguir rechazo de un producto/propuesta comercial (US1.4, FR-002)
  if (
    /\b(no quiero|no me interesa|no busco|descarto|rechazo|no voy a llevar)\s+(ese|esa|este|esta|aquel|aquella|el|la|los|las|esos|esas|estos|estas|un|una)?\s*(producto|articulo|equipo|modelo|heladera|horno|cocina|freidora|amasadora|cortadora|balanza|smart\s*tv|televisor|oferta|cuota|plan|financiacion)\b/.test(
      norm,
    )
  ) {
    return 'PRODUCT_REJECTION';
  }

  // Si menciona explícitamente un teléfono de terceros distinto al del hilo, no aplicar baja automática (Edge Cases)
  const mentionedDigits = (text.match(/\+?\d[\d\s-]{6,14}\d/g) || []).map((m) =>
    m.replace(/\D/g, ''),
  );
  const callerDigits = (callerPhone || '').replace(/\D/g, '');
  const mentionsThirdPartyPhone =
    mentionedDigits.length > 0 &&
    callerDigits.length > 0 &&
    mentionedDigits.some((d) => d !== callerDigits);

  // 2. Expresiones explícitas de baja general (US1.1, FR-002)
  const isExplicitOptOut =
    norm === 'baja' ||
    norm === 'dar de baja' ||
    norm === 'darme de baja' ||
    norm === 'stop' ||
    /^baja\s+(de\s+)?(mensajes|avisos|contacto|comunicaciones|notificaciones)$/.test(
      norm,
    ) ||
    norm.includes('no me contacten mas') ||
    norm.includes('no me contactes mas') ||
    norm.includes('no quiero recibir mas mensajes') ||
    norm.includes('no quiero recibir mas avisos') ||
    norm.includes('no quiero mas mensajes') ||
    norm.includes('dejen de escribirme') ||
    norm.includes('dejen de contactarme') ||
    norm.includes('no me escriban mas') ||
    norm.includes('no me manden mas mensajes');

  if (isExplicitOptOut) {
    if (mentionsThirdPartyPhone) {
      return 'AMBIGUOUS_OPT_OUT';
    }
    return 'OPT_OUT';
  }

  // 3. Pedido ambiguo (US1.4): p. ej. "baja eso", "baja el pedido", "no quiero saber mas nada"
  if (
    /^baja\b/.test(norm) ||
    norm === 'no quiero mas nada' ||
    norm === 'no quiero saber mas nada' ||
    norm === 'no me interesa mas nada'
  ) {
    return 'AMBIGUOUS_OPT_OUT';
  }

  return 'NONE';
}

@Injectable()
export class ContactPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  classifyIncomingText(
    text: string,
    callerPhone?: string,
  ): IncomingOptOutClassification {
    return classifyIncomingOptOutText(text, callerPhone);
  }

  async findRowByPhone(phone: string, tx: any = this.prisma) {
    const variants = phoneVariants(phone);
    if (variants.length === 0) return null;
    const rows = await tx.contactPreference.findMany({
      where: { phone: { in: variants } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.find((r: any) => r.optOut) ?? rows[0] ?? null;
  }

  async isOptedOut(phone: string, tx: any = this.prisma): Promise<boolean> {
    const row = await this.findRowByPhone(phone, tx);
    return Boolean(row?.optOut);
  }

  async getByPhone(phone: string) {
    const trimmed = (phone || '').trim();
    const row = await this.findRowByPhone(trimmed);
    if (!row) {
      return {
        phone: trimmed,
        optOut: false,
        reason: null,
        sourceMessageId: null,
        sourceConversationId: null,
        optOutAt: null,
        reactivatedAt: null,
        updatedById: null,
        history: [] as ContactPreferenceHistoryEntry[],
      };
    }
    return this.formatRow(row);
  }

  async recordOptOut(params: {
    phone: string;
    reason: string;
    sourceMessageId?: string | null;
    sourceConversationId?: string | null;
    actorId?: string | null;
  }) {
    const trimmed = (params.phone || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Teléfono requerido para registrar baja');
    }
    const variants = phoneVariants(trimmed);
    const now = new Date();
    const entry: ContactPreferenceHistoryEntry = {
      action: 'OPT_OUT',
      at: now.toISOString(),
      reason: params.reason.trim(),
      sourceMessageId: params.sourceMessageId ?? null,
      sourceConversationId: params.sourceConversationId ?? null,
      actorId: params.actorId ?? null,
    };

    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findRowByPhone(trimmed, tx);
      const targetPhone = existing?.phone ?? trimmed;
      const prevHistory = Array.isArray(existing?.history)
        ? (existing.history as unknown as ContactPreferenceHistoryEntry[])
        : [];
      const nextHistory = [...prevHistory, entry];

      const row = await tx.contactPreference.upsert({
        where: { phone: targetPhone },
        create: {
          phone: targetPhone,
          optOut: true,
          reason: entry.reason,
          sourceMessageId: entry.sourceMessageId,
          sourceConversationId: entry.sourceConversationId,
          optOutAt: now,
          updatedById: entry.actorId,
          history: nextHistory as any,
        },
        update: {
          optOut: true,
          reason: entry.reason,
          sourceMessageId: entry.sourceMessageId,
          sourceConversationId: entry.sourceConversationId,
          optOutAt: now,
          updatedById: entry.actorId,
          history: nextHistory as any,
        },
      });

      // Bloquear seguimientos comerciales aún no enviados de ese teléfono (021 / 022 SC-001)
      const prospects = await tx.prospect.findMany({
        where: { phone: { in: variants } },
        select: { id: true },
      });
      if (prospects.length > 0) {
        await tx.commercialFollowUp.updateMany({
          where: {
            prospectId: { in: prospects.map((p: any) => p.id) },
            status: { in: ['SCHEDULED', 'BLOCKED'] },
          },
          data: {
            status: 'BLOCKED',
            reasonCode: 'CONTACT_OPT_OUT',
            reasonLabel: FOLLOWUP_REASON_LABELS.CONTACT_OPT_OUT,
            scheduledFor: null,
            version: { increment: 1 },
          },
        });
      }

      // Detener avisos automáticos pendientes aún no enviados hacia ese teléfono (020 / 022 SC-001)
      const convs = await tx.conversation.findMany({
        where: { externalId: { in: variants } },
        select: { id: true },
      });
      if (convs.length > 0) {
        await tx.outboundCommunication.updateMany({
          where: {
            conversationId: { in: convs.map((c: any) => c.id) },
            status: 'PENDING',
          },
          data: {
            status: 'FAILED',
            lastErrorCode: 'CONTACT_OPT_OUT',
            version: { increment: 1 },
          },
        });
      }

      return row;
    });

    return this.formatRow(saved);
  }

  async reactivate(params: {
    phone: string;
    reason: string;
    sourceMessageId?: string | null;
    sourceConversationId?: string | null;
    actorId: string;
  }) {
    const trimmed = (params.phone || '').trim();
    const reason = (params.reason || '').trim();
    if (!trimmed || reason.length < 3) {
      throw new BadRequestException(
        'Se requiere evidencia explícita del contacto para reactivar avisos automáticos.',
      );
    }
    const now = new Date();
    const entry: ContactPreferenceHistoryEntry = {
      action: 'REACTIVATED',
      at: now.toISOString(),
      reason,
      sourceMessageId: params.sourceMessageId ?? null,
      sourceConversationId: params.sourceConversationId ?? null,
      actorId: params.actorId,
    };

    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findRowByPhone(trimmed, tx);
      const targetPhone = existing?.phone ?? trimmed;
      const prevHistory = Array.isArray(existing?.history)
        ? (existing.history as unknown as ContactPreferenceHistoryEntry[])
        : [];
      const nextHistory = [...prevHistory, entry];

      return tx.contactPreference.upsert({
        where: { phone: targetPhone },
        create: {
          phone: targetPhone,
          optOut: false,
          reason,
          sourceMessageId: entry.sourceMessageId,
          sourceConversationId: entry.sourceConversationId,
          reactivatedAt: now,
          updatedById: params.actorId,
          history: nextHistory as any,
        },
        update: {
          optOut: false,
          reason,
          sourceMessageId: entry.sourceMessageId,
          sourceConversationId: entry.sourceConversationId,
          reactivatedAt: now,
          updatedById: params.actorId,
          history: nextHistory as any,
        },
      });
    });

    return this.formatRow(saved);
  }

  private formatRow(row: any) {
    return {
      phone: row.phone,
      optOut: Boolean(row.optOut),
      reason: row.reason ?? null,
      sourceMessageId: row.sourceMessageId ?? null,
      sourceConversationId: row.sourceConversationId ?? null,
      optOutAt: row.optOutAt ? new Date(row.optOutAt).toISOString() : null,
      reactivatedAt: row.reactivatedAt
        ? new Date(row.reactivatedAt).toISOString()
        : null,
      updatedById: row.updatedById ?? null,
      history: Array.isArray(row.history)
        ? (row.history as ContactPreferenceHistoryEntry[])
        : [],
    };
  }
}
