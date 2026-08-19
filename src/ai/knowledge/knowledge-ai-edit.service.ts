import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KnowledgeChangeOrigin } from '@prisma/client';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../llm/llm.service';
import { KnowledgeService } from './knowledge.service';

/**
 * ⚠️ `.optional()` y NO `.nullable()`: Gemini devuelve 400 con `.nullable()`
 * (ya pasó con el schema de comprobantes en Sprint 4).
 */
const editProposalSchema = z.object({
  proposedContent: z
    .string()
    .describe(
      'El documento COMPLETO con el cambio aplicado, no solo el fragmento modificado. ' +
        'Si no se pudo resolver el pedido, devolver el contenido original sin tocar.',
    ),
  summary: z
    .string()
    .describe(
      'Una o dos frases explicando qué se cambió, para que el supervisor lo lea de un vistazo',
    ),
  changedSections: z
    .array(
      z.object({
        before: z.string().describe('El fragmento tal como estaba'),
        after: z.string().describe('El mismo fragmento ya modificado'),
      }),
    )
    .describe(
      'Los fragmentos concretos que cambian. Vacío si no se pudo resolver el pedido.',
    ),
  confident: z
    .boolean()
    .describe(
      'false si el pedido es ambiguo, contradice el documento, o no se sabe con certeza ' +
        'qué parte modificar. Ante la duda, false.',
    ),
});

const EDIT_PROMPT =
  'Sos un asistente que ayuda a un supervisor a editar documentos internos de una ' +
  'empresa comercial argentina. Recibís el contenido vigente de un documento y una ' +
  'instrucción en lenguaje natural, y devolvés el documento con ese cambio aplicado.\n\n' +
  'Reglas:\n' +
  '- Cambiá SOLO lo que la instrucción pide. El resto del texto se mantiene palabra por palabra.\n' +
  '- No agregues información que la instrucción no traiga: no inventes cifras, plazos ni condiciones.\n' +
  '- Respetá el tono y el formato del documento original.\n' +
  '- Si la instrucción es ambigua, contradice lo que dice el documento, o no podés ' +
  'determinar con certeza qué parte tocar, devolvé `confident: false`, el contenido ' +
  'ORIGINAL sin modificar y `changedSections` vacío. Explicá el problema en `summary`.\n' +
  '- Ante la duda, `confident: false`. Es preferible que una persona lo escriba a mano ' +
  'antes que devolver un documento alterado de una forma que nadie pidió.';

export interface EditPreview {
  baseVersion: number;
  proposedContent: string;
  summary: string;
  changedSections: { before: string; after: string }[];
  confident: boolean;
}

/**
 * "Editar con la IA" (US6, FR-030..FR-033).
 *
 * La propuesta y la aplicación viven en **dos endpoints distintos** y el
 * primero no escribe nada. No es una convención de estilo: es lo que hace que
 * "nunca se aplica sin aprobación" (FR-032) sea imposible de violar por
 * descuido, en vez de una regla que alguien tiene que acordarse de respetar
 * (Principio III).
 *
 * `preview` llama a Gemini dentro del request, contra la letra del Principio
 * IV. Es la excepción justificada en plan.md: el supervisor está mirando la
 * pantalla esperando el resultado, tarda 2-4 s y no se persiste nada.
 * Encolarlo obligaría a montar polling en el frontend para entregar un texto
 * efímero.
 */
@Injectable()
export class KnowledgeAiEditService {
  private readonly logger = new Logger(KnowledgeAiEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** Genera la propuesta. **No persiste absolutamente nada** (FR-032). */
  async preview(id: string, instruction: string): Promise<EditPreview> {
    const doc = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
      select: { id: true, title: true, content: true, version: true },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');

    const structured = this.llm.chat.withStructuredOutput(editProposalSchema, {
      name: 'edit_proposal',
    });

    let parsed: z.infer<typeof editProposalSchema>;
    try {
      parsed = (await structured.invoke([
        new SystemMessage(EDIT_PROMPT),
        // El documento y la instrucción van en mensajes separados por la
        // misma razón que en rag-agent.graph.ts: si se concatenaran, una
        // instrucción podría hacerse pasar por parte del documento.
        new HumanMessage(
          `Documento vigente — "${doc.title}":\n\n${doc.content}`,
        ),
        new HumanMessage(`Cambio pedido:\n${instruction}`),
      ])) as z.infer<typeof editProposalSchema>;
    } catch (err) {
      // Un fallo del modelo NO puede devolver una propuesta a medias: se
      // informa como "no pude" y el documento queda intacto.
      this.logger.error(
        `Falló la propuesta de edición para ${id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return this.notConfident(
        doc,
        'No se pudo generar la propuesta en este momento. Probá de nuevo, o editá el documento a mano.',
      );
    }

    // Red de contención sobre la palabra del modelo: si dice que está seguro
    // pero devolvió el texto igual —o vacío—, no hay propuesta que aprobar.
    // Mostrarla como válida haría que el supervisor apruebe un no-cambio.
    const sinCambioReal =
      !parsed.proposedContent?.trim() ||
      parsed.proposedContent.trim() === doc.content.trim();

    if (!parsed.confident || sinCambioReal) {
      return this.notConfident(
        doc,
        parsed.summary ||
          'No se pudo determinar con certeza qué parte del documento modificar.',
      );
    }

    return {
      baseVersion: doc.version,
      proposedContent: parsed.proposedContent,
      summary: parsed.summary,
      // El converter de Gemini afloja los campos a opcionales, así que se
      // normalizan acá en vez de dejar `undefined` viajando al frontend.
      changedSections: (parsed.changedSections ?? []).map((s) => ({
        before: s.before ?? '',
        after: s.after ?? '',
      })),
      confident: true,
    };
  }

  /**
   * Aplica el texto que el supervisor confirmó (FR-033, FR-049).
   *
   * Ojo: lo que se guarda es `content`, el texto del body — que puede venir
   * editado a mano después del preview. NUNCA se re-genera con el modelo acá:
   * eso volvería a meter contenido que nadie aprobó.
   */
  async apply(
    id: string,
    input: { baseVersion: number; content: string; instruction: string },
    employeeId: string,
  ) {
    // El chequeo de versión vive en KnowledgeService.update() para que valga
    // sin importar quién llame — ver `expectedVersion`.
    return this.knowledge.update(
      id,
      {
        content: input.content,
        origin: KnowledgeChangeOrigin.AI_ACCEPTED,
        aiInstruction: input.instruction,
        expectedVersion: input.baseVersion,
      },
      employeeId,
    );
  }

  /** Respuesta uniforme para "no pude": el documento vigente, sin tocar. */
  private notConfident(
    doc: { content: string; version: number },
    summary: string,
  ): EditPreview {
    return {
      baseVersion: doc.version,
      // Se devuelve el contenido ORIGINAL, no uno alterado a medias (FR-033):
      // si el frontend igual lo mostrara, muestra lo que ya había.
      proposedContent: doc.content,
      summary,
      changedSections: [],
      confident: false,
    };
  }
}
