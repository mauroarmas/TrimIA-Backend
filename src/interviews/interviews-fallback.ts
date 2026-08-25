import { MaterialDePregunta } from './interviews-questions';

/**
 * Las señales de respaldo (spec 010, US3/FR-013): un escalado, ya resuelto
 * con las tres verificaciones de "sin capitalizar" hechas por el llamador
 * (FR-013e), listo para normalizar. **No hay tercera pierna de higiene**
 * (FR-013d): el tipo de entrada de esta función no admite una — es el mismo
 * caso que FR-008 excluye de los temas de cobertura, satisfecho por
 * construcción, no por un filtro en tiempo de ejecución.
 */
export interface EscaladoParaMaterial {
  id: string;
  status: 'RESOLVED' | 'PENDING';
  /** Solo para `RESOLVED`. Sin esto no hay nada que generalizar. */
  resolution: string | null;
  /**
   * FR-013e, calculado por el llamador con acceso a Prisma: `true` si ya se
   * capitalizó por cualquiera de las tres vías (corrección existente,
   * documento nuevo por `sourceType: ESCALADO`, o candidato de entrevista
   * aprobado). Esta función es pura — no vuelve a consultar nada.
   */
  yaCapitalizado: boolean;
  /** Solo para `PENDING`: la consulta que nadie contestó todavía. */
  consultaOriginal: string | null;
}

/** FR-013/FR-013c/FR-013e — sin Prisma, sin llamadas. */
export function materialDeEscalados(
  escalados: readonly EscaladoParaMaterial[],
): MaterialDePregunta[] {
  const material: MaterialDePregunta[] = [];

  for (const e of escalados) {
    if (e.status === 'RESOLVED') {
      if (e.yaCapitalizado) continue;
      if (!e.resolution) continue;
      material.push({
        origin: 'ESCALADO_SIN_CAPITALIZAR',
        escalationId: e.id,
        resolutionText: e.resolution,
      });
    } else {
      if (!e.consultaOriginal) continue;
      material.push({
        origin: 'ESCALADO_PENDIENTE',
        escalationId: e.id,
        quotes: [e.consultaOriginal],
      });
    }
  }

  return material;
}
