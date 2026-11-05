export function financingNoticeBody(decision: 'APPROVED' | 'REJECTED') {
  return decision === 'APPROVED'
    ? 'Tu solicitud de financiación fue aprobada por un supervisor. Coordiná con nuestro equipo los próximos pasos para continuar con la compra.'
    : 'Tu solicitud de financiación no fue aprobada. Podés consultar con nuestro equipo las alternativas disponibles.';
}
