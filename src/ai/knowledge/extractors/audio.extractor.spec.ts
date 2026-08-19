/**
 * Tests del extractor de audio — Sprint 5A (US1, FR-004/FR-009).
 *
 * Lo que se fija acá no es la calidad de la transcripción (eso lo decide
 * Gemini), sino dos garantías que sí son nuestras: **el audio se borra pase lo
 * que pase**, y **un audio que no se entiende no genera conocimiento**.
 */
import { unlink } from 'node:fs/promises';
import { AudioExtractor } from './audio.extractor';
import { ExtractionFailedError } from './text-extractor.port';

jest.mock('node:fs/promises', () => ({ unlink: jest.fn() }));

const AUDIO_PATH = '/storage/knowledge/uuid.mp3';
const BUFFER = Buffer.from('audio-falso');

/** Una transcripción real supera el piso de longitud del extractor. */
const TRANSCRIPCION_VALIDA =
  'Cuando un cliente quiere adelantar varias cuotas juntas, el cobrador tiene que ' +
  'confirmar cuántas son y calcular el total sumando cada una por separado, sin aplicar ' +
  'ningún descuento salvo que haya una promoción vigente para ese cliente.';

function buildExtractor(response: string | Error) {
  const invoke = jest.fn();
  if (response instanceof Error) invoke.mockRejectedValue(response);
  else invoke.mockResolvedValue({ content: response });

  const extractor = new AudioExtractor({ chat: { invoke } } as never);
  Object.assign(extractor, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return { extractor, invoke };
}

beforeEach(() => jest.clearAllMocks());

describe('AudioExtractor — el original se elimina siempre (FR-004)', () => {
  it('lo borra cuando la transcripción sale bien', async () => {
    const { extractor } = buildExtractor(TRANSCRIPCION_VALIDA);

    await extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH);

    expect(unlink).toHaveBeenCalledWith(AUDIO_PATH);
  });

  it('lo borra TAMBIÉN cuando la transcripción falla', async () => {
    // Es el caso que importa: si el borrado viviera en el camino feliz, cada
    // fallo dejaría la voz de una persona en el disco del servidor.
    const { extractor } = buildExtractor(new Error('Gemini caído'));

    await expect(
      extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH),
    ).rejects.toBeInstanceOf(ExtractionFailedError);

    expect(unlink).toHaveBeenCalledWith(AUDIO_PATH);
  });

  it('lo borra cuando el audio no se entiende', async () => {
    const { extractor } = buildExtractor('SIN_CONTENIDO');

    await expect(
      extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH),
    ).rejects.toBeInstanceOf(ExtractionFailedError);

    expect(unlink).toHaveBeenCalledWith(AUDIO_PATH);
  });

  it('si el borrado falla, la transcripción igual se devuelve', async () => {
    // Un archivo huérfano es un problema; perder el conocimiento ya extraído,
    // otro peor. Se registra y se sigue.
    const { extractor } = buildExtractor(TRANSCRIPCION_VALIDA);
    (unlink as jest.Mock).mockRejectedValueOnce(new Error('EPERM'));

    await expect(
      extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH),
    ).resolves.toContain('adelantar varias cuotas');
  });
});

describe('AudioExtractor — audio no aprovechable (FR-009)', () => {
  it('el marcador SIN_CONTENIDO no se ingesta como texto', async () => {
    // Sin este corte, "SIN_CONTENIDO" sería un documento de conocimiento
    // perfectamente recuperable.
    const { extractor } = buildExtractor('SIN_CONTENIDO');

    await expect(
      extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH),
    ).rejects.toThrow(/no se entiende|fragmento suelto/);
  });

  it('una frase suelta que el modelo sí transcribió tampoco pasa', async () => {
    // Hallazgo de la prueba con audios reales (2026-08-17): el audio grabado
    // para "no entenderse" resultó igual audible, Gemini lo transcribió, y
    // "quería preguntar por la cuota esa… después te aviso" entró al RAG como
    // si fuera una norma de la empresa. El marcador solo cubre lo inaudible;
    // el piso de longitud cubre lo audible pero inservible.
    const { extractor } = buildExtractor(
      'Sí, quería preguntar por no sé, la cuota eh la viste que bueno, después te aviso.',
    );

    await expect(
      extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH),
    ).rejects.toThrow(/demasiado corto/);
  });

  it('un fallo de la API se traduce a un motivo legible, no al error crudo', async () => {
    const { extractor } = buildExtractor(
      new Error('400 Invalid media content'),
    );

    await expect(
      extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH),
    ).rejects.toThrow(/MP3, WAV, OGG, AAC o FLAC/);
  });
});

describe('AudioExtractor — formatos', () => {
  it('acepta los que acepta Gemini y rechaza el resto', () => {
    const { extractor } = buildExtractor(TRANSCRIPCION_VALIDA);

    for (const mime of ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac']) {
      expect(extractor.supports(mime)).toBe(true);
    }
    expect(extractor.supports('video/mp4')).toBe(false);
    expect(extractor.supports('application/pdf')).toBe(false);
  });

  it('manda el mimeType en camelCase — la snake_case la rechaza la API', async () => {
    // No es preferencia de estilo: el spike T004 confirmó contra la API real
    // que `mime_type` (la forma documentada para Python) devuelve "Invalid
    // media content" en JS. Un mock no lo detecta, pero sí puede fijar que la
    // clave no se cambie de vuelta sin querer.
    const { extractor, invoke } = buildExtractor(TRANSCRIPCION_VALIDA);

    await extractor.extract(BUFFER, 'audio/mpeg', AUDIO_PATH);

    const content = invoke.mock.calls[0][0][1].content as Record<
      string,
      unknown
    >[];
    const media = content.find((b) => b.type === 'media')!;
    expect(media.mimeType).toBe('audio/mpeg');
    expect(media.mime_type).toBeUndefined();
  });
});
