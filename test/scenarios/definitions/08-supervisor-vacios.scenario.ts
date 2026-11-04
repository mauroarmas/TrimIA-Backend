import { ScenarioDefinition } from '../types';

export const supervisorVaciosScenario: ScenarioDefinition = {
  id: 'ESC-08',
  title: 'Supervisor con consulta sobre vacíos de conocimiento',
  description:
    'Informe con documentos y estado; no genera casos huérfanos en la cola de escalados.',
  context: {
    senderPhone: '5491188888888',
    userType: 'EMPLEADO',
    employeeRole: 'SUPERVISOR',
    initialAgent: 'ADMIN',
  },
  userMessage:
    '¿Cuáles son los temas de logística o envíos que tenemos registrados en el sistema?',
  assertions: {
    customCheck: (response) => ({
      passed: response.createdTicketsCount === 0,
      reason: 'No debe crear casos al responsable que consulta vacíos',
    }),
    mustContain: [/documento|confianza|logística|envíos|entregas/i],
    mustNotContain: [
      /abrí un ticket de soporte/i,
      /generé una escalación en la cola/i,
      /caso escalado pendiente de revisión/i,
    ],
  },
};
