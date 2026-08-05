import { Queue } from 'bullmq';
import { MessagingService } from './messaging.service';
import { ConversationsService } from '../conversations/conversations.service';
import { ClientsService } from '../clients/clients.service';
import { WhatsappMediaService } from './whatsapp-media.service';
import { PaymentProofsService } from '../collections/payment-proofs.service';
import { Channel } from '@prisma/client';

describe('MessagingService', () => {
  let service: MessagingService;
  let queue: { add: jest.Mock };
  let conversations: { getOrCreate: jest.Mock; addMessage: jest.Mock };
  let media: { savePaymentProofImage: jest.Mock };
  let paymentProofs: { receiveFromWhatsapp: jest.Mock };

  const conversation = { id: 'conv-1' };
  const message = { id: 'msg-1' };

  beforeEach(() => {
    queue = { add: jest.fn() };
    conversations = {
      getOrCreate: jest.fn().mockResolvedValue(conversation),
      addMessage: jest.fn().mockResolvedValue(message),
    };
    media = { savePaymentProofImage: jest.fn().mockResolvedValue('uuid.jpg') };
    paymentProofs = { receiveFromWhatsapp: jest.fn() };

    service = new MessagingService(
      queue as unknown as Queue,
      conversations as unknown as ConversationsService,
      {} as ClientsService,
      media as unknown as WhatsappMediaService,
      paymentProofs as unknown as PaymentProofsService,
    );
  });

  it('con un mensaje de texto normal, encola process-message y no crea PaymentProof', async () => {
    await service.enqueue({
      phone: '5491100000000',
      message: 'Hola',
      channel: Channel.WHATSAPP,
    } as any);

    expect(queue.add).toHaveBeenCalledWith(
      'process-message',
      expect.objectContaining({ conversationId: 'conv-1', message: 'Hola' }),
      expect.any(Object),
    );
    expect(media.savePaymentProofImage).not.toHaveBeenCalled();
    expect(paymentProofs.receiveFromWhatsapp).not.toHaveBeenCalled();
  });

  it('con una imagen, guarda el binario, crea el PaymentProof y NO encola process-message', async () => {
    await service.enqueue({
      phone: '5491100000000',
      message: '',
      mediaBase64: 'aGVsbG8=',
      mimeType: 'image/jpeg',
      channel: Channel.WHATSAPP,
    } as any);

    expect(media.savePaymentProofImage).toHaveBeenCalledWith('aGVsbG8=', 'image/jpeg');
    expect(paymentProofs.receiveFromWhatsapp).toHaveBeenCalledWith({
      phone: '5491100000000',
      messageId: 'msg-1',
      imagePath: 'uuid.jpg',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
