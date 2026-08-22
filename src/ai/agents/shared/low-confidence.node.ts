import { Logger } from '@nestjs/common';
import {
  OrchestratorStateType,
  RetrievedDoc,
} from '../../orchestrator/orchestrator.state';
import { Caller, interlocutorDe } from '../../caller/caller.types';
import { SpecializedAgent } from '../agents.service';

/**
 * Nodo `report_low_confidence` (spec 005, US2).
 *
 * Cuando el RAG no alcanza el umbral, hay DOS desenlaces según quién preguntó:
 *
 *   - cliente o empleado → `escalate_to_human`, **igual que siempre**: se le crea
 *     el caso y una persona lo resuelve.
 *   - supervisor o gerente → este nodo: se le informa qué se consultó y con cuánta
 *     confianza, y **no se crea ninguna `Escalation`**.
 *
 * El defecto que arregla: el sistema le abría un caso a la persona que iba a tener
 * que resolverlo. Diego (dueño, responsable de las cinco áreas) preguntaba algo y el
 * sistema se lo escalaba a sí mismo, a la cola de la que él es responsable.
 *
 * Y el informe dice qué encontró, **no** que el dato no exista. Es la diferencia
 * entre las dos situaciones que desde afuera se ven iguales: si el documento estaba
 * y quedó apenas corto, la acción correcta es corregirlo; si le dijéramos "no está",
 * cargaría un duplicado, y dos chunks parecidos compiten y se bajan el score
 * mutuamente — degradando las respuestas para todos (Principio II).
 */

/** Cuántos documentos consultados se listan. Con `k = 4`, todos. */
const MAX_DOCS_EN_INFORME = 4;

/**
 * Un documento por línea, con su mejor chunk.
 *
 * `retrievedDocs` trae **chunks**, no documentos, y un documento largo puede ocupar
 * dos o tres lugares del top-k. Sin esto el informe repite el mismo título con
 * scores distintos, y eso es peor que feo: quien lo lee concluye que hay documentos
 * duplicados cargados y sale a "arreglar" algo que no está roto — justo el error que
 * este aviso existe para evitar. Se conserva el mejor score de cada documento, que
 * es el que dice cuán cerca estuvo de responder.
 */
function mejoresPorDocumento(docs: RetrievedDoc[]): RetrievedDoc[] {
  const mejor = new Map<string, RetrievedDoc>();
  for (const doc of docs) {
    const previo = mejor.get(doc.documentId);
    if (!previo || doc.rank < previo.rank) mejor.set(doc.documentId, doc);
  }
  return [...mejor.values()].sort((a, b) => a.rank - b.rank);
}

/** Las dos acciones que tiene a mano quien lee el informe (FR-010, CL-2). */
const CIERRE =
  'Si el tema es de un área tuya podés cargarlo o corregirlo; si es de otra, ' +
  'decime a quién le paso la consulta y le llega con el contexto.';

/**
 * ¿A esta persona le corresponde el informe en vez del escalado?
 *
 * Supervisor y gerente sí; cliente y empleado no. Sin `caller` tampoco: se cae al
 * camino de siempre, que es el conservador — un informe con títulos de documentos
 * internos no puede escaparse por no haber podido identificar a alguien (FR-009).
 */
export function esResponsableDeArea(caller: Caller | null): boolean {
  if (!caller) return false;
  const quien = interlocutorDe(caller);
  return quien === 'SUPERVISOR' || quien === 'GERENTE';
}

/**
 * Arma el texto del informe **sin pasar por el LLM**.
 *
 * No es una optimización de costo: `STYLE_RULES` le prohíbe explícitamente al agente
 * decir "base de conocimiento" o "no lo tengo cargado" —jerga interna que no debe
 * llegarle a un cliente— y este aviso necesita exactamente ese vocabulario. Son dos
 * audiencias distintas, así que son dos caminos distintos. El nodo de escalado ya
 * hace lo mismo con su mensaje fijo.
 *
 * @param confidence confianza del mejor hit, 0-1 (como la deja `retrieve_context`)
 * @param threshold  umbral configurado, 0-1
 * @param docs       candidatos con su score 0-100
 */
export function buildLowConfidenceReport(
  confidence: number,
  threshold: number,
  docs: RetrievedDoc[],
): string {
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const umbral = pct(threshold * 100);

  const encabezado =
    `No llegué a la confianza que necesito para contestar esto por mi cuenta ` +
    `(${pct(confidence * 100)} sobre un umbral de ${umbral}).`;

  // Sin candidatos el informe se queda en el hecho: la búsqueda no devolvió nada
  // parecido. No concluye que el dato no exista — no es algo que se pueda saber
  // desde acá.
  if (docs.length === 0) {
    return (
      `${encabezado}\n\n` +
      `La búsqueda no devolvió ningún documento parecido.\n\n` +
      `${CIERRE}`
    );
  }

  const lista = mejoresPorDocumento(docs)
    .slice(0, MAX_DOCS_EN_INFORME)
    .map((d, i) => `${i + 1}. «${d.title}» — ${pct(d.score)}`)
    .join('\n');

  return (
    `${encabezado}\n\n` +
    `Esto es lo que consulté, de lo más parecido a lo menos:\n${lista}\n\n` +
    `Si alguno de esos es el tema y quedó corto, lo que conviene es corregir ` +
    `ese documento, no cargar otro: dos documentos parecidos se compiten entre ` +
    `sí y las respuestas salen peor.\n\n` +
    `${CIERRE}`
  );
}

/** Dependencias del nodo. Nada de LLM: este mensaje no se genera, se arma. */
export interface LowConfidenceNodeDeps {
  agentType: SpecializedAgent;
  confidenceThreshold: number;
  logger: Logger;
}

/**
 * Fábrica del nodo. Devuelve la respuesta y **no** marca `escalated`: no se derivó
 * nada, y marcarlo haría que el Panel del Supervisor contara escalaciones que no
 * existen en la cola.
 */
export function buildLowConfidenceNode(deps: LowConfidenceNodeDeps) {
  const { agentType, confidenceThreshold, logger } = deps;
  const tag = `[${agentType}]`;

  return (state: OrchestratorStateType) => {
    const confidence = state.confidence ?? 0;
    const docs = state.retrievedDocs ?? [];

    logger.log(
      `${tag} confianza baja (${confidence.toFixed(2)}) → informe al responsable ` +
        `(${docs.length} candidatos), sin escalar`,
    );

    return {
      response: buildLowConfidenceReport(confidence, confidenceThreshold, docs),
      escalated: false,
    };
  };
}
