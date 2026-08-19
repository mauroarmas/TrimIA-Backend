/**
 * Puerto de extracción de texto — Sprint 5A (US1, Principio V).
 *
 * Cada formato que el panel acepta se resuelve detrás de esta interfaz, no con
 * un `switch` en el processor. Sumar un formato nuevo (planillas, por ejemplo)
 * es agregar una clase y registrarla; nada más cambia.
 */

/**
 * El archivo se recibió, pero no hay texto que ingestar.
 *
 * Existe como error propio —y no como un `return ''`— porque FR-005 exige que
 * ese caso termine el archivo en `FAILED` **con motivo legible**. Devolver
 * vacío crearía un documento sin contenido que el agente recuperaría como
 * ruido, que es justo lo que la spec prohíbe.
 *
 * El `message` se le muestra tal cual al supervisor: sin jerga, y diciendo qué
 * puede hacer al respecto.
 */
export class ExtractionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionFailedError';
  }
}

export interface TextExtractor {
  /** Nombre para logs y para el motivo de fallo. */
  readonly name: string;

  /** ¿Este extractor sabe manejar ese MIME? */
  supports(mimeType: string): boolean;

  /**
   * Devuelve el texto plano del archivo.
   *
   * `sourcePath` es la ruta del original en disco. Casi todos los extractores
   * la ignoran —les alcanza el buffer—, pero el de audio la necesita: FR-004
   * lo obliga a borrar el archivo apenas termina de transcribir, salga bien o
   * mal. El binario tiene que estar en disco igual, porque un job de BullMQ
   * viaja como JSON y no puede llevar el buffer hasta el worker.
   *
   * @throws {ExtractionFailedError} si el archivo no tiene texto aprovechable.
   */
  extract(
    buffer: Buffer,
    mimeType: string,
    sourcePath?: string,
  ): Promise<string>;
}

/**
 * Token de inyección de la lista de extractores.
 *
 * Es un `Symbol` y no un string para que no colisione con otro provider, y
 * permite que el processor reciba `TextExtractor[]` sin conocer las clases
 * concretas.
 */
export const TEXT_EXTRACTORS = Symbol('TEXT_EXTRACTORS');
