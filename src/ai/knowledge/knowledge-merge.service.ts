import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { KnowledgeChangeOrigin } from '@prisma/client';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../llm/llm.service';
import { KnowledgeService } from './knowledge.service';
import { EditPreview } from './knowledge-ai-edit.service';

/** ⚠️ `.optional()` y NO `.nullable()`: Gemini devuelve 400 con `.nullable()`. */
const mergeProposalSchema = z.object({
  proposedContent: z
    .string()
    .describe(
      'El documento fusionado COMPLETO, con lo que aportan los dos documentos de ' +
        'entrada. Si no se puede fusionar con criterio, devolver el contenido del ' +
        'documento que sobrevive, sin tocar.',
    ),
  summary: z
    .string()
    .describe(
      'Una o dos frases explicando qué se incorporó del documento absorbido',
    ),
  changedSections: z
    .array(
      z.object({
        before: z
          .string()
          .describe('El fragmento tal como estaba en el que sobrevive'),
        after: z.string().describe('El mismo fragmento ya fusionado'),
      }),
    )
    .describe(
      'Los fragmentos concretos que cambian. Vacío si no se pudo fusionar.',
    ),
  confident: z
    .boolean()
    .describe(
      'false si los dos documentos se contradicen, o si uno no aporta nada que el ' +
        'otro no diga ya. Ante la duda, false.',
    ),
});

const MERGE_PROMPT =
  'Sos un asistente que ayuda a un supervisor a fusionar dos documentos internos de ' +
  'una empresa comercial argentina que compiten entre sí en la base de conocimiento ' +
  '(cubren el mismo tema y se reparten la señal de búsqueda).\n\n' +
  'Recibís el contenido del documento que va a SOBREVIVIR y el del documento que va a ' +
  'quedar ABSORBIDO (desactivado), y devolvés un documento fusionado.\n\n' +
  'Reglas:\n' +
  '- El resultado tiene que incluir todo lo que aporta el documento absorbido y que el ' +
  'que sobrevive no tenía.\n' +
  '- No repitas información: si los dos dicen lo mismo, quedate con la redacción del ' +
  'que sobrevive.\n' +
  '- No inventes cifras, plazos ni condiciones que no estén en ninguno de los dos.\n' +
  '- Si los dos documentos se contradicen entre sí (por ejemplo, dan plazos distintos ' +
  'para lo mismo), o si el absorbido no aporta nada nuevo, devolvé `confident: false`, ' +
  'el contenido del que sobrevive SIN TOCAR y `changedSections` vacío. Explicá el ' +
  'problema en `summary`.\n' +
  '- Ante la duda, `confident: false`. Es preferible que una persona decida a mano ' +
  'antes que fusionar de una forma que nadie pidió.';

export interface MergePreview extends EditPreview {
  keepDocumentId: string;
  absorbDocumentId: string;
}

/**
 * Fusión con aprobación humana (spec 008, US1). Mismo patrón que
 * `KnowledgeAiEditService`: `preview` no persiste nada, `apply` guarda lo que
 * la persona confirmó. Que sean dos endpoints es lo que hace FR-010
 * ("nunca fusiona sola") imposible de violar por descuido.
 *
 * No tiene ruta de escritura propia: `apply` termina en
 * `KnowledgeService.update()` + `KnowledgeService.setActive()`, que ya
 * aplican `assertPuedeEscribir` (Principio I, sin réplica de la regla).
 */
@Injectable()
export class KnowledgeMergeService {
  private readonly logger = new Logger(KnowledgeMergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** Redacta la fusión. **No persiste absolutamente nada.** */
  async preview(
    pairId: string,
    keepDocumentId: string,
    employeeId: string,
  ): Promise<MergePreview> {
    const pair = await this.prisma.hygienePair.findUnique({
      where: { id: pairId },
      include: { documentA: true, documentB: true },
    });
    if (!pair) throw new NotFoundException('Pareja no encontrada');

    if (![pair.documentAId, pair.documentBId].includes(keepDocumentId)) {
      throw new BadRequestException(
        'keepDocumentId tiene que ser uno de los dos documentos de la pareja',
      );
    }

    const keep =
      pair.documentAId === keepDocumentId ? pair.documentA : pair.documentB;
    const absorb =
      pair.documentAId === keepDocumentId ? pair.documentB : pair.documentA;

    // 404 antes que nada más: no proponer contra un documento fantasma (el
    // edge case de "documento ya desactivado por otra fusión").
    if (!keep.isActive || !absorb.isActive) {
      throw new NotFoundException(
        'Uno de los dos documentos ya no está activo — otra fusión lo absorbió mientras tanto',
      );
    }

    // 403 ANTES de llamar al modelo: no gastar tokens en una propuesta que no
    // se va a poder aprobar (FR-011).
    await this.knowledge.assertPuedeEscribir(employeeId, keep.agentType);

    const structured = this.llm.chat.withStructuredOutput(mergeProposalSchema, {
      name: 'merge_proposal',
    });

    let parsed: z.infer<typeof mergeProposalSchema>;
    try {
      parsed = (await structured.invoke([
        new SystemMessage(MERGE_PROMPT),
        new HumanMessage(
          `Documento que SOBREVIVE — "${keep.title}":\n\n${keep.content}`,
        ),
        new HumanMessage(
          `Documento ABSORBIDO — "${absorb.title}":\n\n${absorb.content}`,
        ),
      ])) as z.infer<typeof mergeProposalSchema>;
    } catch (err) {
      this.logger.error(
        `Falló la propuesta de fusión para la pareja ${pairId}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return this.notConfident(
        keep,
        absorb,
        'No se pudo generar la propuesta en este momento. Probá de nuevo, o fusioná a mano.',
      );
    }

    const sinCambioReal =
      !parsed.proposedContent?.trim() ||
      parsed.proposedContent.trim() === keep.content.trim();

    if (!parsed.confident || sinCambioReal) {
      return this.notConfident(
        keep,
        absorb,
        parsed.summary ||
          'No se pudo fusionar con criterio: los documentos se contradicen o no hay nada nuevo que incorporar.',
      );
    }

    return {
      keepDocumentId: keep.id,
      absorbDocumentId: absorb.id,
      baseVersion: keep.version,
      proposedContent: parsed.proposedContent,
      summary: parsed.summary,
      changedSections: (parsed.changedSections ?? []).map((s) => ({
        before: s.before ?? '',
        after: s.after ?? '',
      })),
      confident: true,
    };
  }

  /**
   * Aplica lo que la persona confirmó (FR-008, FR-009).
   *
   * Se guarda `content`, el texto del body — nunca uno regenerado. El orden
   * importa: primero `update()`, después `setActive(false)`. Al revés, un
   * fallo del update dejaría un documento desactivado *y* su contenido sin
   * incorporar a ninguna parte — conocimiento perdido en silencio.
   *
   * Si el `setActive` falla después de un `update` exitoso, NO se revierte:
   * quedan dos documentos activos, uno ya con la info fusionada, y la
   * próxima corrida vuelve a proponer la pareja. Es feo pero no pierde nada;
   * la alternativa (una transacción que abarque Postgres y Chroma) no existe.
   */
  async apply(
    pairId: string,
    input: { keepDocumentId: string; baseVersion: number; content: string },
    employeeId: string,
  ) {
    const pair = await this.prisma.hygienePair.findUnique({
      where: { id: pairId },
      include: { documentA: true, documentB: true },
    });
    if (!pair) throw new NotFoundException('Pareja no encontrada');

    if (![pair.documentAId, pair.documentBId].includes(input.keepDocumentId)) {
      throw new BadRequestException(
        'keepDocumentId tiene que ser uno de los dos documentos de la pareja',
      );
    }

    const keep =
      pair.documentAId === input.keepDocumentId
        ? pair.documentA
        : pair.documentB;
    const absorb =
      pair.documentAId === input.keepDocumentId
        ? pair.documentB
        : pair.documentA;

    if (!keep.isActive || !absorb.isActive) {
      throw new NotFoundException(
        'Uno de los dos documentos ya no está activo — otra fusión lo absorbió mientras tanto',
      );
    }

    // assertPuedeEscribir sobre LOS DOS. Por el prefiltro son del mismo área,
    // así que en la práctica es el mismo chequeo — pero no depende de esa
    // coincidencia para ser correcto.
    await this.knowledge.assertPuedeEscribir(employeeId, keep.agentType);
    await this.knowledge.assertPuedeEscribir(employeeId, absorb.agentType);

    const updated = await this.knowledge.update(
      keep.id,
      {
        content: input.content,
        origin: KnowledgeChangeOrigin.AI_ACCEPTED,
        aiInstruction: `Fusión con «${absorb.title}»`,
        expectedVersion: input.baseVersion,
        mergedFromDocumentId: absorb.id,
      },
      employeeId,
    );

    await this.knowledge.setActive(absorb.id, false, employeeId);

    this.logger.log(
      `Fusión aplicada: ${keep.id} absorbió ${absorb.id} (pareja ${pairId})`,
    );

    return {
      keptDocumentId: keep.id,
      newVersion: updated.version,
      absorbedDocumentId: absorb.id,
      absorbedIsActive: false,
    };
  }

  private notConfident(
    keep: { id: string; content: string; version: number },
    absorb: { id: string },
    summary: string,
  ): MergePreview {
    return {
      keepDocumentId: keep.id,
      absorbDocumentId: absorb.id,
      baseVersion: keep.version,
      proposedContent: keep.content,
      summary,
      changedSections: [],
      confident: false,
    };
  }
}
