// Identidades inventadas, sin vínculo con datos del despliegue compartido.
export const financingCustomerFixture = {
  name: 'Cliente Ficticio',
  dni: '30000008',
  productSummary: 'Producto prueba',
} as const;
export const financingVerdictFixtures = [
  ['30000008', 'APPROVED'],
  ['30000004', 'APPROVED_WITH_CONDITIONS'],
  ['30000001', 'REJECTED'],
  ['00000000', 'UNAVAILABLE'],
] as const;

export const commercialFollowUpFixtures = {
  phone: '+5493764000211',
  altPhone: '+5493764000212',
  customerName: 'Comercio Demo Seguimiento',
  productInterest: 'Cortadora de Fiambre Berkley 300',
  locality: 'Posadas',
} as const;
