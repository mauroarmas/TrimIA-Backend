import { ScenarioDefinition } from '../types';

export const consultaFinanciacionScenario: ScenarioDefinition = {
  id: 'ESC-06',
  title: 'Pregunta por financiación',
  description: 'Responde sobre plazos, cuotas y requisitos financieros; no deriva por stock en depósito.',
  context: {
    senderPhone: '5491144444444',
    userType: 'CLIENTE',
    initialAgent: 'ADMIN',
  },
  userMessage: '¿Qué planes de financiación o cuotas tienen disponibles?',
  assertions: {
    mustContain: [
      /cuotas|financiación|planes|interés|tasa|requisitos/i,
    ],
    mustNotContain: [
      /stock en depósito/i,
      /pallets y retiro coordinado con grúa/i,
      /bultos pesados en depósito/i,
    ],
  },
};
