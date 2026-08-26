import { AgentType } from '@prisma/client';

/**
 * A quién le toca un caso escalado (spec 013).
 *
 * La spec 005 cerró la **escritura** del corpus por área, pero la cola de casos
 * escalados le seguía mostrando a todos los supervisores todos los casos, sin
 * distinguir nada. Esto es la otra mitad: la **lectura**.
 *
 * Vive en su propio archivo y como función pura a propósito. Es la regla de esta
 * spec, y así se lee entera de una sentada y se testea sin Prisma, en vez de
 * quedar diluida en las ~900 líneas de `escalations.service.ts`.
 */

/**
 * Tres estados, no un booleano.
 *
 * `SIN_AREA` no es "no es mío": un caso que se escaló antes de que el turno se
 * ruteara no le toca a nadie en particular. Con dos valores caería en `AJENA` y
 * se hundiría al fondo de **todas** las colas a la vez — nadie lo miraría nunca,
 * que es justo lo que FR-008 prohíbe.
 */
export type Pertenencia = 'PROPIA' | 'AJENA' | 'SIN_AREA';

/**
 * El orden de la cola: lo propio, después lo que no es de nadie, después lo
 * ajeno (FR-003, FR-008).
 *
 * Se exporta como número porque es lo que la consulta usa para ordenar antes de
 * paginar. Ordenar en memoria lo ya traído ordenaría solo la página, y un caso
 * propio que cayó en la página 3 seguiría en la página 3.
 */
export const RANGO_PERTENENCIA: Record<Pertenencia, number> = {
  PROPIA: 1,
  SIN_AREA: 2,
  AJENA: 3,
};

export interface CasoParaPertenencia {
  /** Área del caso: el agente que venía atendiendo. `null` = sin rutear. */
  area: AgentType | null;
  /** A quién se derivó, si se derivó (spec 001, ampliada en la 005 US4). */
  delegatedToId: string | null;
}

export interface QuienConsulta {
  empleadoId: string;
  /**
   * Los agentes de las áreas que supervisa. Se resuelve **una vez por request**
   * consultando el criterio que ya existe (`KnowledgeService`), nunca
   * reimplementando el mapeo `areasSupervisadas → agentType` acá: la regla vive
   * en un solo lugar (Principio I, FR-021).
   */
  agentesPropios: AgentType[];
}

/**
 * Decide la pertenencia de un caso para quien está mirando la cola.
 *
 * La derivación gana sobre el área, en los dos sentidos:
 *
 *  - un caso de otra área **derivado a mí** es mío, porque para eso se derivó
 *    (FR-010);
 *  - un caso **de mi área derivado a otro** deja de ser mío: ya tiene dueño, y
 *    no soy yo (FR-011).
 *
 * Ese segundo caso es el que se olvida la versión corta de esta función —la que
 * solo pregunta por el área— y la diferencia únicamente se nota con un caso
 * derivado.
 */
export function resolverPertenencia(
  caso: CasoParaPertenencia,
  quien: QuienConsulta,
): Pertenencia {
  if (caso.delegatedToId !== null) {
    return caso.delegatedToId === quien.empleadoId ? 'PROPIA' : 'AJENA';
  }

  if (caso.area === null) return 'SIN_AREA';

  return quien.agentesPropios.includes(caso.area) ? 'PROPIA' : 'AJENA';
}
