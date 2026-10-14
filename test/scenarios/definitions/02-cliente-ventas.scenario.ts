import { ScenarioDefinition } from '../types';

export const clienteVentasScenario: ScenarioDefinition = {
  id: 'ESC-02',
  title: 'Cliente externo pregunta por el proceso de venta',
  description: 'Mismo mensaje desde un teléfono fuera de whitelist. Trato comercial de cliente.',
  context: {
    senderPhone: '5491144444444',
    userType: 'CLIENTE',
    initialAgent: 'SALES',
  },
  userMessage: '¿Cómo es el proceso de venta de maquinaria en la empresa?',
  assertions: {
    mustContain: [
      /maquinaria|asesor|venta|compra|directa|financiad/i,
    ],
    mustNotContain: [
      /carga la orden en el erp/i,
      /procedimiento interno para empleados/i,
      /validación crediticia interna/i,
    ],
  },
};
