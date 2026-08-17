import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { readFile } from 'node:fs/promises';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { z } from 'zod';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../../ai/llm/llm.service';
import { WhatsappMediaService } from '../../messaging/whatsapp-media.service';
import { OrchestrationLogger } from '../../ai/orchestrator/orchestration-logger.service';

interface ReceiptExtractionJob {
  paymentProofId: string;
}

/**
 * Lectura tentativa de un comprobante — SIEMPRE sugerencia editable, nunca
 * verdad del sistema (Principio II/III de la constitución). Este processor
 * solo completa los campos extracted*; jamás toca PaymentProof.status.
 */
// OJO: Gemini structured output NO soporta z.nullable() (el converter de
// @langchain/google-genai genera un schema con "type" como lista, que la
// API rechaza — 400 "Proto field is not repeating, cannot start list").
// Se usa .optional() (campo ausente si no hay lectura confiable) en vez de
// null explícito — verificado en vivo contra la API real, no en un test con
// mocks (que no habría detectado esto).
const receiptSchema = z.object({
  amount: z
    .number()
    .optional()
    .describe(
      'Monto de la transferencia en pesos argentinos. Omitir el campo si no se puede leer con confianza',
    ),
  date: z
    .string()
    .optional()
    .describe(
      'Fecha de la operación en formato ISO 8601 (YYYY-MM-DD). Omitir el campo si no se puede leer',
    ),
  bank: z
    .string()
    .optional()
    .describe(
      'Nombre del banco o billetera de origen (ej. "Banco Nación", "Mercado Pago"). Omitir el campo si no se puede leer',
    ),
});

const EXTRACTION_PROMPT =
  'Sos un asistente que lee comprobantes de pago (transferencias bancarias o de billeteras virtuales) de Argentina. ' +
  'A partir de la imagen, extraé el monto, la fecha de la operación y el banco u origen de la transferencia. ' +
  'Si no podés leer alguno de los datos con confianza, devolvé null en ese campo — nunca inventes un valor.';

@Processor('receipt-extraction', { concurrency: 1 })
export class ReceiptExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ReceiptExtractionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly media: WhatsappMediaService,
    private readonly orchestrationLogger: OrchestrationLogger,
  ) {
    super();
  }

  async process(job: Job<ReceiptExtractionJob>): Promise<void> {
    const { paymentProofId } = job.data;

    const proof = await this.prisma.paymentProof.findUnique({
      where: { id: paymentProofId },
      include: { message: true },
    });
    if (!proof) {
      this.logger.warn(
        `PaymentProof ${paymentProofId} no existe — se descarta el job`,
      );
      return;
    }

    const startedAt = Date.now();
    try {
      const absolutePath = this.media.resolveAbsolutePath(proof.imagePath);
      const buffer = await readFile(absolutePath);
      const base64 = buffer.toString('base64');
      const mimeType = this.media.mimeTypeFromPath(proof.imagePath);

      const structured = this.llm.chat.withStructuredOutput(receiptSchema, {
        name: 'extract_receipt',
        includeRaw: true,
      });
      const result = await structured.invoke([
        new SystemMessage(EXTRACTION_PROMPT),
        new HumanMessage({
          content: [
            { type: 'text', text: 'Leé este comprobante de pago.' },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        }),
      ]);

      const parsed = result.parsed;
      await this.prisma.paymentProof.update({
        where: { id: paymentProofId },
        data: {
          extractedAmount: parsed.amount ?? null,
          extractedDate: parsed.date ? new Date(parsed.date) : null,
          extractedBank: parsed.bank ?? null,
        },
      });

      const usage = (result.raw as AIMessage).usage_metadata as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      await this.orchestrationLogger.trackTokens({
        conversationId: proof.message?.conversationId ?? null,
        agentType: 'COLLECTIONS',
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        durationMs: Date.now() - startedAt,
        model: this.llm.model,
      });

      this.logger.log(
        `Lectura tentativa completada para PaymentProof ${paymentProofId}`,
      );
    } catch (err) {
      this.logger.error(
        `Error leyendo comprobante ${paymentProofId}: ${err instanceof Error ? err.message : err}`,
      );
      throw err; // BullMQ reintenta; el comprobante sigue PENDING_REVIEW con extracted* en null.
    }
  }
}
