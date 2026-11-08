export type FollowUpReasonCode =
  | 'SALE_CLOSED'
  | 'ORDER_CANCELLED'
  | 'PROSPECT_LOST'
  | 'SUPERSEDED_BY_NEWER_PROSPECT'
  | 'FINANCING_REJECTED_NO_CASH'
  | 'RULE_DISABLED'
  | 'CONTACT_OPT_OUT'
  | 'MISSING_VERIFIED_THREAD'
  | 'MISSING_PRODUCT_INTEREST'
  | 'HUMAN_HANDLING'
  | 'PENDING_ESCALATION'
  | 'ADMIN_REVIEW_PENDING'
  | 'FINANCING_EXPIRED'
  | 'CLOSING_READY_FOR_SALES';

export const FOLLOWUP_REASON_LABELS: Record<FollowUpReasonCode, string> = {
  SALE_CLOSED: 'Venta cerrada',
  ORDER_CANCELLED: 'Pedido cancelado',
  PROSPECT_LOST: 'Oportunidad marcada como perdida',
  SUPERSEDED_BY_NEWER_PROSPECT: 'Reemplazado por consulta más reciente',
  FINANCING_REJECTED_NO_CASH:
    'Financiación rechazada sin alternativa habilitada',
  RULE_DISABLED: 'Regla global de seguimiento desactivada',
  CONTACT_OPT_OUT: 'Baja de contacto solicitada por el cliente',
  MISSING_VERIFIED_THREAD: 'Sin teléfono o hilo de cliente verificable',
  MISSING_PRODUCT_INTEREST: 'Sin producto de interés identificado',
  HUMAN_HANDLING: 'Conversación bajo atención manual',
  PENDING_ESCALATION: 'Caso escalado pendiente de resolución',
  ADMIN_REVIEW_PENDING: 'En revisión de Administración',
  FINANCING_EXPIRED: 'Condiciones financieras vencidas pendientes de renovación',
  CLOSING_READY_FOR_SALES: 'Resumen aceptado pendiente de cierre por Ventas',
};

export function buildCommercialFollowUpBody(params: {
  name?: string | null;
  productInterest: string;
  hasActiveChoosingOffers?: boolean;
}): string {
  const safeName = params.name?.trim() || 'cliente';
  const safeProduct = params.productInterest.trim();
  if (params.hasActiveChoosingOffers) {
    return `Hola ${safeName}, te escribimos de Credimisión por tu consulta sobre ${safeProduct}. Seguimos a disposición por este mismo chat si querés continuar con la opción que prefieras dentro de su vigencia.`;
  }
  return `Hola ${safeName}, te escribimos de Credimisión por tu consulta sobre ${safeProduct}. Si querés que retomemos tu consulta o tenés alguna duda, respondé por este mismo chat y te asesoramos.`;
}
