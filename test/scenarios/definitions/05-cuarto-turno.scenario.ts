import { ScenarioDefinition } from '../types';

export const cuartoTurnoScenario: ScenarioDefinition = {
  id: 'ESC-05',
  title: 'Cuarto mensaje de una conversación en curso',
  description: 'No vuelve a saludar con bienvenida inicial en medio de una conversación activa.',
  context: {
    senderPhone: '5491144444444',
    userType: 'CLIENTE',
    initialAgent: 'SALES',
    conversationHistory: [
      { sender: 'USER', content: 'Hola, buenas tardes' },
      { sender: 'ASSISTANT', content: '¡Hola! Buenas tardes, ¿en qué puedo ayudarte hoy?' },
      { sender: 'USER', content: 'Quería saber si tienen compresores de aire' },
      { sender: 'ASSISTANT', content: 'Sí, comercializamos compresores de aire para talleres mecánicos e industrias.' },
      { sender: 'USER', content: '¿Y qué potencia tienen?' },
      { sender: 'ASSISTANT', content: 'Tenemos modelos desde 2 HP hasta 15 HP para uso pesado.' },
    ],
  },
  userMessage: '¿Tienen garantía los motores?',
  assertions: {
    mustNotContain: [
      /¡hola!/i,
      /¡bienvenido a trimia!/i,
      /hola de nuevo/i,
      /buenos días!/i,
    ],
  },
};
