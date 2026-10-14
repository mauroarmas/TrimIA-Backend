import { ScenarioDefinition } from '../types';

export const duenoVentasScenario: ScenarioDefinition = {
  id: 'ESC-01',
  title: 'El dueño pregunta por el proceso de venta',
  description: 'Describe el procedimiento interno; no le ofrece asesorarlo como comprador ni venderle.',
  context: {
    senderPhone: '5491199999999',
    userType: 'EMPLEADO',
    employeeRole: 'SUPERVISOR',
    initialAgent: 'SALES',
  },
  userMessage: '¿Cómo es el proceso de venta de maquinaria en la empresa?',
  assertions: {
    mustContain: [
      /proceso|circuito|vendedor|orden|erp|administraci/i,
    ],
    mustNotContain: [
      /¿te gustaría comprar/i,
      /podemos ofrecerte comprar/i,
      /si querés adquirir/i,
      /asesorarte en tu compra/i,
      /¿te interesa algún modelo para vos\?/i,
    ],
  },
};
