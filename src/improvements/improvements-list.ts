import { ImprovementSource } from '@prisma/client';
import { resolveMark } from '../ai/knowledge/knowledge-coverage-identity';
import { MaterialDePregunta } from '../interviews/interviews-questions';

/**
 * El armado de la lista: unificar tres fuentes, ordenar, deduplicar, filtrar y
 * cortar.
 *
 * Puro a propósito — sin Nest ni Prisma — por el mismo motivo que en las specs
 * 009 y 010: acá vive lo determinista, y donde vive SC-002 (la lista acotada
 * sin importar cuántos documentos tenga el corpus). Testearlo no debe requerir
 * levantar un servicio ni mockear un LLM.
 */

/** Prefijo del id según la fuente. Es el mismo id que se manda a descartar. */
export const PREFIJO: Record<ImprovementSource, string> = {
  CONSULTA_FALLIDA: 'tema',
  ESCALADO: 'esc',
  DOCUMENTO_INCONCLUSO: 'doc',
};

export interface DocumentoDelItem {
  id: string;
  title: string;
  version: number;
  /** Transversal = no pertenece a ninguna área (`agentType` nulo). */
  esTransversal: boolean;
}

export interface ItemParaMejorar {
  /** `tema:<id>` / `esc:<id>` / `doc:<id>` */
  id: string;
  source: ImprovementSource;
  title: string;
  /** Frase corta que explica por qué está en la lista. La arma el backend. */
  evidence: string;
  document?: DocumentoDelItem;
  quotes?: string[];
  unansweredQuestions?: string[];
  /** Solo en DOCUMENTO_INCONCLUSO. No es comparable con las otras fuentes. */
  severity?: number;
  canInterview: boolean;
  canDismiss: boolean;

  // --- Campos internos, para ordenar y filtrar. No viajan al panel. ---
  /** Cuántas consultas sostienen el ítem (solo CONSULTA_FALLIDA). */
  queryCount?: number;
  /** Las consultas que forman el tema: su identidad estable (spec 009). */
  themeQueryEventIds?: string[];
  /** Fechas de esas consultas, para saber si hay tráfico posterior a un descarte. */
  queryDates?: Date[];
  escalationId?: string;
  /**
   * El material tal como la entrevista sabe preguntarlo, ya armado por la
   * fuente. Se guarda en vez de reconstruirse después: la fuente tiene el
   * dato completo (banda, causa, resolución) y el ítem de la lista solo la
   * parte que se muestra. Reconstruir desde lo mostrado perdería información
   * en silencio.
   *
   * Vacío para `DOCUMENTO_INCONCLUSO`, que se arma desde el propio ítem.
   */
  materialOriginal?: MaterialDePregunta;
}

/** El peso de cada fuente en el orden (FR-020). Menor va primero. */
const PESO_FUENTE: Record<ImprovementSource, number> = {
  CONSULTA_FALLIDA: 0,
  ESCALADO: 1,
  DOCUMENTO_INCONCLUSO: 2,
};

/**
 * FR-020/FR-021: primero lo que falló con gente preguntando —y dentro de eso,
 * lo que se preguntó más veces—, después los casos que alguien escaló, y
 * último lo que solo el modelo cree incompleto sin que nadie lo haya
 * preguntado. Que seis personas hayan preguntado algo pesa más que la opinión
 * del modelo sobre un documento que nadie consultó.
 */
export function ordenar(items: ItemParaMejorar[]): ItemParaMejorar[] {
  return [...items].sort((a, b) => {
    const porFuente = PESO_FUENTE[a.source] - PESO_FUENTE[b.source];
    if (porFuente !== 0) return porFuente;
    if (a.source === 'CONSULTA_FALLIDA') {
      return (b.queryCount ?? 0) - (a.queryCount ?? 0);
    }
    if (a.source === 'DOCUMENTO_INCONCLUSO') {
      return (b.severity ?? 0) - (a.severity ?? 0);
    }
    return 0;
  });
}

/**
 * FR-022: un documento aparece UNA sola vez aunque lo señalen dos fuentes.
 * Gana la de más evidencia, que por el orden de arriba es la que viene
 * primero — así que esto **exige recibir la lista ya ordenada**.
 */
export function deduplicar(ordenados: ItemParaMejorar[]): ItemParaMejorar[] {
  const vistos = new Set<string>();
  const salida: ItemParaMejorar[] = [];
  for (const item of ordenados) {
    const docId = item.document?.id;
    if (docId) {
      if (vistos.has(docId)) continue;
      vistos.add(docId);
    }
    salida.push(item);
  }
  return salida;
}

export interface DescarteVigente {
  source: ImprovementSource;
  themeQueryEventIds: string[];
  escalationId: string | null;
  documentId: string | null;
  documentVersion: number | null;
  dismissedAt: Date;
}

export interface PreguntaPrevia {
  themeQueryEventIds: string[];
  escalationId: string | null;
  documentId: string | null;
  documentVersion: number | null;
}

/**
 * FR-025/FR-026/FR-026a: ¿este ítem ya se descartó, y el descarte sigue
 * valiendo?
 *
 * ⚠️ **Un descarte de tema no filtra para siempre**: filtra hasta que llegue
 * una consulta posterior a su fecha. Es la regla que `filterHandled` (spec
 * 009) ya implementa y lo que hace visible a un reincidente — leerlo como un
 * booleano lo suprimiría para siempre y rompería FR-026a **en silencio**,
 * porque nadie nota lo que no aparece.
 *
 * Para un documento la evidencia nueva es otra: la versión (FR-026). Un
 * documento que cambió merece volver a mirarse; uno que no cambió, no.
 *
 * `marcasViejas` son las `CoverageThemeMark` de la pantalla anterior (D6,
 * FR-024b): siguen valiendo como descarte, con la misma regla de reincidencia.
 */
export function estaDescartado(
  item: ItemParaMejorar,
  descartes: readonly DescarteVigente[],
  marcasViejas: readonly {
    themeId: string;
    queryEventIds: string[];
    markedAt: Date;
  }[],
  overlapCut: number,
): boolean {
  if (item.source === 'DOCUMENTO_INCONCLUSO') {
    const doc = item.document;
    if (!doc) return false;
    return descartes.some(
      (d) =>
        d.source === 'DOCUMENTO_INCONCLUSO' &&
        d.documentId === doc.id &&
        d.documentVersion === doc.version,
    );
  }

  if (item.source === 'ESCALADO') {
    return descartes.some(
      (d) => d.source === 'ESCALADO' && d.escalationId === item.escalationId,
    );
  }

  // CONSULTA_FALLIDA: identidad por solape, y vale hasta que haya tráfico
  // posterior. Se miran las dos tablas — las descartadas de esta spec y las
  // marcas de la pantalla anterior.
  const ids = item.themeQueryEventIds ?? [];
  if (ids.length === 0) return false;

  const candidatas = [
    ...descartes
      .filter((d) => d.source === 'CONSULTA_FALLIDA')
      .map((d, i) => ({
        themeId: `descarte-${i}`,
        queryEventIds: d.themeQueryEventIds,
        markedAt: d.dismissedAt,
      })),
    ...marcasViejas,
  ];

  const match = resolveMark(ids, candidatas, overlapCut);
  if (!match) return false;

  const hayTraficoNuevo = (item.queryDates ?? []).some(
    (fecha) => fecha > match.markedAt,
  );
  return !hayTraficoNuevo;
}

/**
 * FR-023: un ítem sobre el que ya se entrevistó no se vuelve a ofrecer, sin
 * que nadie tenga que descartarlo a mano.
 *
 * Para un documento se compara id **más versión**, por el mismo motivo que el
 * descarte: un documento editado después de entrevistarse puede volver a
 * preguntarse. Para un tema, por solape — la etiqueta se regenera distinta
 * cada corrida y no sirve como identidad.
 */
export function yaSeEntrevisto(
  item: ItemParaMejorar,
  previas: readonly PreguntaPrevia[],
  overlapCut: number,
): boolean {
  if (item.source === 'DOCUMENTO_INCONCLUSO') {
    const doc = item.document;
    if (!doc) return false;
    return previas.some(
      (p) => p.documentId === doc.id && p.documentVersion === doc.version,
    );
  }

  if (item.source === 'ESCALADO') {
    return previas.some((p) => p.escalationId === item.escalationId);
  }

  const ids = item.themeQueryEventIds ?? [];
  if (ids.length === 0) return false;
  return (
    resolveMark(
      ids,
      previas.map((p, i) => ({
        themeId: `previa-${i}`,
        queryEventIds: p.themeQueryEventIds,
        markedAt: new Date(0),
      })),
      overlapCut,
    ) !== null
  );
}

/**
 * El armado completo. **El corte va último**: ordenar → deduplicar → filtrar →
 * cortar. Cortar antes tiraría lo de más evidencia si vino desordenado.
 *
 * Acá vive SC-002: la lista nunca supera `maxItems`, sin importar cuántos
 * documentos tenga el corpus.
 */
export function armarLista(
  crudos: ItemParaMejorar[],
  opciones: {
    descartes: readonly DescarteVigente[];
    marcasViejas: readonly {
      themeId: string;
      queryEventIds: string[];
      markedAt: Date;
    }[];
    previas: readonly PreguntaPrevia[];
    overlapCut: number;
    maxItems: number;
  },
): ItemParaMejorar[] {
  const { descartes, marcasViejas, previas, overlapCut, maxItems } = opciones;
  return deduplicar(ordenar(crudos))
    .filter((it) => !estaDescartado(it, descartes, marcasViejas, overlapCut))
    .filter((it) => !yaSeEntrevisto(it, previas, overlapCut))
    .slice(0, maxItems);
}
