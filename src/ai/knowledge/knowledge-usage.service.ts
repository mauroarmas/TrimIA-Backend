import { Injectable } from '@nestjs/common';
import { RetrievalOutcome } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Uso real de un documento del corpus (Sprint 5A, US7, FR-047).
 *
 * `hasData` NO es redundante con `retrievedCount === 0`: es lo que separa
 * "este documento nunca sirvió" de "todavía no hay con qué juzgarlo". Sin esa
 * distinción, la pantalla mostraría `avgScore: 0` para un documento recién
 * cargado, y un supervisor lo daría de baja por inútil cuando en realidad
 * nadie preguntó nunca sobre el tema (FR-028).
 */
export interface DocumentUsage {
  /** Cuántas veces el RAG lo devolvió como candidato. */
  retrievedCount: number;
  /** De esas, cuántas terminaron en una respuesta y no en un escalamiento. */
  answeredCount: number;
  /** Promedio de similitud 0-100. `null` si nunca se recuperó. */
  avgScore: number | null;
  /** false = sin recuperaciones todavía; no confundir con "anduvo mal". */
  hasData: boolean;
}

const EMPTY: DocumentUsage = {
  retrievedCount: 0,
  answeredCount: 0,
  avgScore: null,
  hasData: false,
};

@Injectable()
export class KnowledgeUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async forDocument(documentId: string): Promise<DocumentUsage> {
    const usage = await this.forDocuments([documentId]);
    return usage.get(documentId) ?? EMPTY;
  }

  /**
   * Versión por lote para el listado del panel.
   *
   * Existe para no disparar una query por fila: el listado muestra hasta 100
   * documentos y una consulta por cada uno sería el N+1 clásico, en la
   * pantalla que más se abre del módulo.
   */
  async forDocuments(
    documentIds: string[],
  ): Promise<Map<string, DocumentUsage>> {
    const result = new Map<string, DocumentUsage>();
    if (documentIds.length === 0) return result;

    // Se agrupa por (documento, outcome) para sacar en UNA query tanto el
    // total como cuántas de esas veces sirvió.
    const rows = await this.prisma.knowledgeRetrieval.groupBy({
      by: ['documentId', 'outcome'],
      where: { documentId: { in: documentIds } },
      _count: { _all: true },
      _sum: { score: true },
    });

    for (const id of documentIds) {
      const own = rows.filter((r) => r.documentId === id);
      if (own.length === 0) {
        result.set(id, EMPTY);
        continue;
      }

      const retrievedCount = own.reduce((n, r) => n + r._count._all, 0);
      const answeredCount =
        own.find((r) => r.outcome === RetrievalOutcome.ANSWERED)?._count._all ??
        0;
      // El promedio se calcula sobre la SUMA de scores de todos los grupos, no
      // promediando promedios: los grupos tienen distinta cantidad de filas y
      // el promedio de promedios daría un número que no es el real.
      const totalScore = own.reduce((n, r) => n + (r._sum.score ?? 0), 0);

      result.set(id, {
        retrievedCount,
        answeredCount,
        avgScore: Number((totalScore / retrievedCount).toFixed(1)),
        hasData: true,
      });
    }

    return result;
  }
}
