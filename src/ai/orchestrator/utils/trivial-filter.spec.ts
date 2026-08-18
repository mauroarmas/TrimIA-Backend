import {
  isTrivial,
  isUntranscribableAudio,
  cannedReply,
  UNTRANSCRIBABLE_AUDIO_MARKER,
  TRANSCRIPTION_FAILED_REPLY,
} from './trivial-filter';

describe('isTrivial', () => {
  // Saludos que deben ser capturados (sin LLM)
  it.each([
    'hola',
    'Hola!',
    'buenas',
    'buenas tardes',
    'buenos días',
    'hey',
    'holis',
    'qué tal',
    'que tal',
  ])('detecta saludo: "%s"', (msg) => {
    expect(isTrivial(msg)).toBe(true);
  });

  // Cierres que deben ser capturados
  it.each([
    'gracias',
    'muchas gracias',
    'ok',
    'dale',
    'listo',
    'perfecto',
    'chau',
    'hasta luego',
    '👍',
  ])('detecta cierre: "%s"', (msg) => {
    expect(isTrivial(msg)).toBe(true);
  });

  // Consultas reales que NO deben ser capturadas
  it.each([
    'hola, cuánto sale la heladera?',
    'hola quiero comprar algo',
    'buen día, tengo una deuda',
    'quiero pagar la cuota',
    'cuántas cuotas tiene?',
    'ok pero cuánto cuesta?',
  ])('NO captura consulta con contenido: "%s"', (msg) => {
    expect(isTrivial(msg)).toBe(false);
  });
});

describe('cannedReply', () => {
  it('responde a saludo con bienvenida', () => {
    expect(cannedReply('hola')).toContain('Hola');
  });

  it('responde a cierre con despedida', () => {
    expect(cannedReply('gracias')).toContain('Gracias');
  });
});

/**
 * Audio de WhatsApp que n8n no pudo transcribir — Sprint 5A (US5, FR-009).
 *
 * El marcador es un contrato entre el Workflow A de n8n y este backend
 * (documentado en `n8n/README.md`): si acá cambia el literal sin cambiarlo
 * allá, el usuario recibe el centinela crudo como si fuera una respuesta.
 */
describe('isUntranscribableAudio (FR-009)', () => {
  it('reconoce el marcador que manda n8n', () => {
    expect(isUntranscribableAudio(UNTRANSCRIBABLE_AUDIO_MARKER)).toBe(true);
  });

  it('tolera espacios alrededor', () => {
    expect(isUntranscribableAudio(`  ${UNTRANSCRIBABLE_AUDIO_MARKER}\n`)).toBe(
      true,
    );
  });

  it('NO se dispara si el marcador viene embebido en una frase', () => {
    // Un mensaje más largo no es el aviso de n8n: es texto de un usuario que
    // (por la razón que sea) escribió el centinela. Cortocircuitar ahí sería
    // dejarlo sin respuesta real a lo que preguntó.
    expect(
      isUntranscribableAudio(`hola ${UNTRANSCRIBABLE_AUDIO_MARKER} che`),
    ).toBe(false);
  });

  it('un mensaje normal no lo activa', () => {
    expect(isUntranscribableAudio('quiero pagar la cuota')).toBe(false);
    expect(isUntranscribableAudio('')).toBe(false);
  });

  it('el marcador NO cuenta como saludo trivial', () => {
    // Son dos rutas distintas: el saludo se atajaba solo sin agente sticky,
    // el audio fallido tiene que atajarse SIEMPRE (ver entryRouter).
    expect(isTrivial(UNTRANSCRIBABLE_AUDIO_MARKER)).toBe(false);
  });
});

describe('cannedReply con el marcador de audio', () => {
  it('pide reformulación en vez de responder un saludo', () => {
    expect(cannedReply(UNTRANSCRIBABLE_AUDIO_MARKER)).toBe(
      TRANSCRIPTION_FAILED_REPLY,
    );
  });

  it('no filtra el centinela crudo al usuario', () => {
    // Lo que se manda por WhatsApp sale de acá: si el marcador se colara, el
    // cliente vería "__AUDIO_NO_TRANSCRIBIBLE__" como respuesta del asistente.
    expect(cannedReply(UNTRANSCRIBABLE_AUDIO_MARKER)).not.toContain(
      UNTRANSCRIBABLE_AUDIO_MARKER,
    );
  });

  it('ofrece la salida por texto, no solo repetir el audio', () => {
    // Si el problema es el micrófono o el ruido, repetir hablado da lo mismo.
    expect(TRANSCRIPTION_FAILED_REPLY).toMatch(/escrito/i);
  });
});
