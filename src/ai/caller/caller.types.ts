import { AgentType, EmployeeRole, UserType } from '@prisma/client';

/**
 * Quién está hablando con el asistente (spec 005).
 *
 * **Transporta identidad; NO decide accesos.** Qué agentes se alcanzan lo sigue
 * decidiendo `allowedAgentsFor()` y qué audiencia se recupera lo sigue decidiendo
 * `knowledge.search()` — los dos puntos que nombra el Principio I. Este objeto
 * existe para que el asistente sepa a quién le habla y para el ruteo de baja
 * confianza, no para agregar un tercer criterio de acceso.
 *
 * ⚠️ En particular, `areas` **no** debe usarse para filtrar la recuperación: eso se
 * evaluó y se descartó (FR-015). Un empleado de un área tiene que poder consultar
 * temas de otra — es de lo que depende la capacitación del Sprint 5B.
 */

/** Un área de la que alguien es responsable. */
export interface CallerArea {
  id: string;
  name: string;
  /** Agente que atiende el área. Es lo que permite saber "de qué área es este documento". */
  agentType: AgentType | null;
}

export interface Caller {
  /** Lo que ya existía: define audiencia del RAG y agentes permitidos. */
  userType: UserType;
  /** `null` para un CLIENTE: no está en la whitelist, no hay de dónde sacarlo. */
  role: EmployeeRole | null;
  /** Vacío si no supervisa nada. */
  areas: CallerArea[];
  /**
   * **Derivado** de ser responsable de todas las áreas — nunca leído de un campo
   * persistido. Guardar el flag además de la lista crearía dos fuentes de verdad
   * que pueden contradecirse.
   */
  esGerente: boolean;
}

/** Cómo se le habla a cada uno. Lo consume el prompt (US1). */
export type Interlocutor = 'CLIENTE' | 'EMPLEADO' | 'SUPERVISOR' | 'GERENTE';

/**
 * Los cuatro interlocutores de FR-001, en un solo lugar.
 *
 * El orden importa: gerente antes que supervisor, porque un gerente **es** un
 * supervisor con todas las áreas y la comprobación más específica va primero.
 */
export function interlocutorDe(caller: Caller): Interlocutor {
  if (caller.userType === 'CLIENTE') return 'CLIENTE';
  if (caller.esGerente) return 'GERENTE';
  if (caller.role === 'SUPERVISOR') return 'SUPERVISOR';
  return 'EMPLEADO';
}

/**
 * Cómo se le describe al modelo quién le está hablando (spec 005, US1).
 *
 * Se arma desde el `Caller` y en un solo lugar: si esta descripción se construyera
 * en cada prompt, cada agente terminaría tratando distinto a la misma persona.
 */
export function descriptorDe(caller: Caller): string {
  switch (interlocutorDe(caller)) {
    case 'CLIENTE':
      return 'un CLIENTE (o alguien que todavía no es cliente). No trabaja en la empresa.';
    case 'GERENTE':
      return 'el GERENTE: el dueño de la empresa, responsable de TODAS las áreas.';
    case 'SUPERVISOR': {
      const areas = caller.areas.map((a) => a.name).join(' y ');
      return areas
        ? `un SUPERVISOR de la empresa, responsable de ${areas}.`
        : 'un SUPERVISOR de la empresa.';
    }
    default:
      return 'un EMPLEADO de la empresa.';
  }
}
