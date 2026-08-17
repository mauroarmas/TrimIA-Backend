import { ReceiptExtractionProcessor } from './receipt-extraction.processor';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../../ai/llm/llm.service';
import { WhatsappMediaService } from '../../messaging/whatsapp-media.service';
import { OrchestrationLogger } from '../../ai/orchestrator/orchestration-logger.service';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('fake-image-bytes')),
}));

describe('ReceiptExtractionProcessor', () => {
  let processor: ReceiptExtractionProcessor;
  let prisma: { paymentProof: { findUnique: jest.Mock; update: jest.Mock } };
  let llm: { chat: { withStructuredOutput: jest.Mock }; model: string };
  let media: { resolveAbsolutePath: jest.Mock; mimeTypeFromPath: jest.Mock };
  let orchestrationLogger: { trackTokens: jest.Mock };
  let invoke: jest.Mock;

  const proof = {
    id: 'proof-1',
    imagePath: 'uuid.jpg',
    message: { conversationId: 'conv-1' },
  };

  beforeEach(() => {
    invoke = jest.fn().mockResolvedValue({
      parsed: { amount: 42000, date: '2026-08-04', bank: 'Banco Nación' },
      raw: { usage_metadata: { input_tokens: 300, output_tokens: 20 } },
    });
    prisma = {
      paymentProof: {
        findUnique: jest.fn().mockResolvedValue(proof),
        update: jest.fn(),
      },
    };
    llm = {
      chat: { withStructuredOutput: jest.fn().mockReturnValue({ invoke }) },
      model: 'gemini-3.5-flash-lite',
    };
    media = {
      resolveAbsolutePath: jest.fn().mockReturnValue('/tmp/uuid.jpg'),
      mimeTypeFromPath: jest.fn().mockReturnValue('image/jpeg'),
    };
    orchestrationLogger = { trackTokens: jest.fn() };

    processor = new ReceiptExtractionProcessor(
      prisma as unknown as PrismaService,
      llm as unknown as LlmService,
      media as unknown as WhatsappMediaService,
      orchestrationLogger as unknown as OrchestrationLogger,
    );
  });

  it('completa los campos extracted* del comprobante y trackea tokens', async () => {
    await processor.process({ data: { paymentProofId: 'proof-1' } } as any);

    expect(prisma.paymentProof.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'proof-1' },
        data: {
          extractedAmount: 42000,
          extractedDate: new Date('2026-08-04'),
          extractedBank: 'Banco Nación',
        },
      }),
    );
    expect(orchestrationLogger.trackTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        agentType: 'COLLECTIONS',
        inputTokens: 300,
        outputTokens: 20,
      }),
    );
  });

  it('guarda null en los campos que Gemini no pudo leer, sin inventar valores', async () => {
    invoke.mockResolvedValue({
      parsed: { amount: null, date: null, bank: null },
      raw: { usage_metadata: { input_tokens: 300, output_tokens: 10 } },
    });

    await processor.process({ data: { paymentProofId: 'proof-1' } } as any);

    expect(prisma.paymentProof.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          extractedAmount: null,
          extractedDate: null,
          extractedBank: null,
        },
      }),
    );
  });

  it('no hace nada si el PaymentProof ya no existe', async () => {
    prisma.paymentProof.findUnique.mockResolvedValue(null);

    await processor.process({ data: { paymentProofId: 'no-existe' } } as any);

    expect(prisma.paymentProof.update).not.toHaveBeenCalled();
    expect(llm.chat.withStructuredOutput).not.toHaveBeenCalled();
  });
});
