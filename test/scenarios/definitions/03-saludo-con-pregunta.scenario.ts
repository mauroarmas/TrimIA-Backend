import { ScenarioDefinition } from '../types';

export const saludoConPreguntaScenario: ScenarioDefinition = {
  id: 'ESC-03',
  title: 'Hola! ¿Qué venden?',
  description: 'Contesta la pregunta comercial y no solo el saludo.',
  context: {
    senderPhone: '5491144444444',
    userType: 'CLIENTE',
    initialAgent: 'SALES',
  },
  userMessage: 'hola! ¿qué venden?',
  assertions: {
    mustContain: [
      /maquinaria|herramientas|tornillos|compresores|equipamiento/i,
    ],
    customCheck: (resp) => {
      // Debe responder la duda y no solo decir "¡Hola! ¿En qué te ayudo?"
      const onlyGreeting = /^(¡?hola!?\s*¿?en qué (te|puedo)\s*ayudarte\??)$/i.test(resp.text.trim());
      if (onlyGreeting) {
        return { passed: false, reason: 'Respondió un saludo puro sin describir los productos' };
      }
      return { passed: true };
    },
  },
};
