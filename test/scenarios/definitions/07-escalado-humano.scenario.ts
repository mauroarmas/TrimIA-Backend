import { ScenarioDefinition } from '../types';

export const escaladoHumanoScenario: ScenarioDefinition = {
  id: 'ESC-07',
  title: 'Mensaje con requerimiento de escalado humano activo',
  description: 'Cuando la conversación está escalada a un supervisor, confirma la derivación y no termina preguntando ni reabriendo con el bot.',
  context: {
    senderPhone: '5491144444444',
    userType: 'CLIENTE',
    isEscalated: true,
    conversationHistory: [
      { sender: 'USER', content: 'Necesito una excepción en la tasa de interés por volumen especial' },
      { sender: 'ASSISTANT', content: 'Ese caso requiere autorización de un supervisor. Ya te comunico con el área comercial.' },
    ],
  },
  userMessage: 'Perfecto, quedo a la espera de que me escriban',
  assertions: {
    mustContain: [
      /asesor|supervisor|responsable|contacto|comunicar/i,
    ],
    mustNotContain: [
      /¿en qué más puedo ayudarte\?/i,
      /¿te puedo ayudar con algo más\?/i,
      /¿alguna otra consulta\?/i,
      /¿querés que te cotice otra cosa\?/i,
    ],
  },
};
