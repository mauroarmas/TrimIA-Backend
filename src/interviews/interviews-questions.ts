import { AgentType, CoverageBand, CoverageCause } from '@prisma/client';
import { overlap } from '../ai/knowledge/knowledge-coverage-identity';

/**
 * Qué se le pregunta al responsable, elegido puramente a partir del material
 * (spec 010, D1/D6). Sin Nest ni Prisma: es donde vive SC-001 y tiene que
 * poder testearse con datos inventados, sin levantar nada.
 */

export type InterviewQuestionKind =
  | 'PEDIR_NUEVO'
  | 'CORREGIR'
  | 'GENERALIZAR'
  | 'ABIERTA';

export interface MaterialDocumento {
  id: string;
  title: string;
  version: number;
  isActive: boolean;
}

/** Un tema del resumen de cobertura (spec 009), o un escalado, normalizados. */
export type MaterialDePregunta =
  | {
      origin: 'TEMA_COBERTURA';
      themeId: string;
      label: string;
      agentType: AgentType | null;
      band: CoverageBand;
      cause: CoverageCause | null;
      queryEventIds: string[];
      quotes: string[];
      queryCount: number;
      documents: MaterialDocumento[];
    }
  | {
      origin: 'ESCALADO_SIN_CAPITALIZAR';
      escalationId: string;
      resolutionText: string;
    }
  | {
      origin: 'ESCALADO_PENDIENTE';
      escalationId: string;
      quotes: string[];
    };

/**
 * FR-009/FR-010/FR-010a. La regla completa es esta única línea: si hay un
 * documento cerca, se corrige; si no, se pide contenido nuevo. **Nunca** se
 * mira banda ni causa para decidir entre las dos — eso es justo lo que la
 * Fase 0 (D1) rompía: un tema `AL_LIMITE` no trae causa, pero sí trae
 * documento, así que esta regla ya lo manda por `CORREGIR` sin necesitar un
 * caso especial. Es la tarea de SC-001: `kind === 'PEDIR_NUEVO'` implica,
 * siempre, que no hay ningún documento en el material.
 */
export function elegirForma(
  material: MaterialDePregunta,
): InterviewQuestionKind {
  switch (material.origin) {
    case 'TEMA_COBERTURA':
      return material.documents.length > 0 ? 'CORREGIR' : 'PEDIR_NUEVO';
    case 'ESCALADO_SIN_CAPITALIZAR':
      return 'GENERALIZAR';
    case 'ESCALADO_PENDIENTE':
      return 'ABIERTA';
  }
}

/**
 * FR-008: un tema donde dos documentos compiten, o que no era del corpus, no
 * se pregunta. Preguntar donde dos documentos ya pelean agrega un tercero —
 * eso se resuelve fusionando (spec 008), no con más conocimiento.
 */
export function excluirPorCausa(material: MaterialDePregunta): boolean {
  if (material.origin !== 'TEMA_COBERTURA') return false;
  return (
    material.cause === 'SE_COMPITEN' || material.cause === 'NO_ES_DEL_CORPUS'
  );
}

/** Lo que hace falta de una pregunta ya existente para reconocer un repetido. */
export interface PreguntaPrevia {
  themeQueryEventIds: string[];
  escalationId: string | null;
}

/**
 * FR-006b/c (C1, `/speckit-analyze`). Un tema se identifica por solapamiento
 * de sus consultas —la etiqueta la regenera distinta cada corrida, spec
 * 009 D6— reusando `overlap()` sin modificarlo. Un escalado se identifica
 * por su id, que es estable.
 */
export function yaPreguntado(
  material: MaterialDePregunta,
  previos: readonly PreguntaPrevia[],
  overlapCut: number,
): boolean {
  if (material.origin === 'TEMA_COBERTURA') {
    return previos.some(
      (p) =>
        p.themeQueryEventIds.length > 0 &&
        overlap(material.queryEventIds, p.themeQueryEventIds) >= overlapCut,
    );
  }
  return previos.some((p) => p.escalationId === material.escalationId);
}
