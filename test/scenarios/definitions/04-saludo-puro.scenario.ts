import { ScenarioDefinition } from '../types';

export const saludoPuroScenario: ScenarioDefinition = {
  id: 'ESC-04',
  title: 'Hola solo',
  description: 'Saluda cordial y se pone a disposición sin volcar catálogos extensos ni asumir intenciones.',
  context: {
    senderPhone: '5491144444444',
    userType: 'CLIENTE',
    initialAgent: 'SALES',
  },
  userMessage: 'hola',
  assertions: {
    mustContain: [
      /hola|buenos días|buenas tardes|en qué te puedo ayudar|a disposición/i,
    ],
    mustNotContain: [
      /nuestro catálogo completo incluye tornillos de grado 8 y compresores trifásicos/i,
      /procedimiento de recupero de cheques/i,
    ],
  },
};
