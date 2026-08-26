import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentType, ImprovementSource } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { KnowledgeService } from '../ai/knowledge/knowledge.service';

/**
 * El descarte — "ya lo miré, está bien así" — para las **tres** fuentes
 * (FR-024/FR-024a).
 *
 * Absorbe el "marcar como atendido" que la spec 009 tenía solo para las
 * consultas fallidas: después de unificar la pantalla son el mismo gesto sobre
 * fuentes distintas, y sostener dos mecanismos que hacen lo mismo es el ruido
 * que esta spec vino a sacar.
 */
@Injectable()
export class ImprovementsDismissalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async dismiss(itemId: string, empleadoId: string, note?: string) {
    const { source, id } = this.parsear(itemId);
    const { sectorId, agentType } = await this.areaDelItem(source, id);

    // ⚠️ FR-027: **se revalida al descartar**, no se hereda de cuando se cargó
    // la lista. Es el caso que un test de mesa no encuentra: quitarle el área
    // a alguien con la lista ya en pantalla.
    const permitido = await this.knowledge.esResponsableDeAgente(
      empleadoId,
      agentType,
    );
    if (!permitido) {
      throw new ForbiddenException('No sos responsable del área de este ítem');
    }

    await this.prisma.improvementDismissal.create({
      data: {
        source,
        sectorId,
        dismissedById: empleadoId,
        note,
        ...(await this.aQuéApunta(source, id)),
      },
    });

    return { dismissed: true };
  }

  /**
   * El prefijo dice la fuente. Un id desconocido se **rechaza**: guardar una
   * fila que no apunta a nada sería un descarte invisible que nunca filtra.
   */
  private parsear(itemId: string): { source: ImprovementSource; id: string } {
    const sep = itemId.indexOf(':');
    const prefijo = sep === -1 ? '' : itemId.slice(0, sep);
    const id = itemId.slice(sep + 1);
    if (!id) throw new BadRequestException(`Ítem inválido: "${itemId}"`);

    switch (prefijo) {
      case 'tema':
        return { source: ImprovementSource.CONSULTA_FALLIDA, id };
      case 'esc':
        return { source: ImprovementSource.ESCALADO, id };
      case 'doc':
        return { source: ImprovementSource.DOCUMENTO_INCONCLUSO, id };
      default:
        throw new BadRequestException(
          `No sé de qué fuente es el ítem "${itemId}"`,
        );
    }
  }

  /**
   * Qué se guarda según la fuente (FR-026/FR-026a):
   *
   * - Documento → id **más versión**, así vuelve a aparecer si se edita.
   * - Tema → las consultas que lo forman, que son su identidad estable: la
   *   etiqueta la regenera distinta cada corrida.
   * - Escalado → su id, que es estable.
   *
   * Las dos últimas rigen hasta que aparezca evidencia nueva sobre lo mismo,
   * que es la regla que ya regía y no cambia.
   */
  private async aQuéApunta(source: ImprovementSource, id: string) {
    if (source === ImprovementSource.DOCUMENTO_INCONCLUSO) {
      const doc = await this.prisma.knowledgeDocument.findUnique({
        where: { id },
        select: { version: true },
      });
      if (!doc) throw new NotFoundException('El documento ya no existe');
      return { documentId: id, documentVersion: doc.version };
    }

    if (source === ImprovementSource.ESCALADO) {
      return { escalationId: id };
    }

    const tema = await this.prisma.coverageTheme.findUnique({
      where: { id },
      select: { queryEventIds: true },
    });
    if (!tema) throw new NotFoundException('Ese tema ya no está en la corrida');
    return { themeQueryEventIds: tema.queryEventIds };
  }

  /** De qué área es el ítem, para saber quién puede descartarlo. */
  private async areaDelItem(
    source: ImprovementSource,
    id: string,
  ): Promise<{ sectorId: string; agentType: AgentType | null }> {
    const agentType = await this.agentTypeDelItem(source, id);
    const sector = await this.prisma.sector.findFirst({
      where: { agentType },
      select: { id: true },
    });
    if (!sector) {
      throw new NotFoundException('No hay un área asociada a este ítem');
    }
    return { sectorId: sector.id, agentType };
  }

  private async agentTypeDelItem(
    source: ImprovementSource,
    id: string,
  ): Promise<AgentType | null> {
    if (source === ImprovementSource.DOCUMENTO_INCONCLUSO) {
      const doc = await this.prisma.knowledgeDocument.findUnique({
        where: { id },
        select: { agentType: true },
      });
      if (!doc) throw new NotFoundException('El documento ya no existe');
      return doc.agentType;
    }

    if (source === ImprovementSource.ESCALADO) {
      const esc = await this.prisma.escalation.findUnique({
        where: { id },
        select: { conversation: { select: { currentAgent: true } } },
      });
      if (!esc) throw new NotFoundException('Ese caso ya no existe');
      return esc.conversation.currentAgent;
    }

    const tema = await this.prisma.coverageTheme.findUnique({
      where: { id },
      select: { agentType: true },
    });
    if (!tema) throw new NotFoundException('Ese tema ya no está en la corrida');
    return tema.agentType;
  }
}
