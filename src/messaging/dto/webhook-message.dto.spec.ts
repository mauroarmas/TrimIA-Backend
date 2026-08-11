import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { WebhookMessageDto } from './webhook-message.dto';

describe('WebhookMessageDto', () => {
  it('acepta un payload de texto normal sin media', async () => {
    const dto = plainToInstance(WebhookMessageDto, {
      phone: '5491112345678',
      message: 'Hola, quiero consultar por un producto',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('acepta un payload con mediaBase64 y mimeType válidos', async () => {
    const dto = plainToInstance(WebhookMessageDto, {
      phone: '5491112345678',
      message: '',
      mediaBase64: 'aGVsbG8=',
      mimeType: 'image/jpeg',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza un payload con mediaBase64 pero sin mimeType', async () => {
    const dto = plainToInstance(WebhookMessageDto, {
      phone: '5491112345678',
      message: '',
      mediaBase64: 'aGVsbG8=',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'mimeType')).toBe(true);
  });

  // 4096: límite de texto de WhatsApp — nunca debería llegar algo más largo
  // legítimamente. Evita textos arbitrariamente largos hacia el prompt del
  // LLM y hacia los regex de isTrivial.
  it('acepta un mensaje de exactamente 4096 caracteres', async () => {
    const dto = plainToInstance(WebhookMessageDto, {
      phone: '5491112345678',
      message: 'a'.repeat(4096),
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza un mensaje de más de 4096 caracteres', async () => {
    const dto = plainToInstance(WebhookMessageDto, {
      phone: '5491112345678',
      message: 'a'.repeat(4097),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'message')).toBe(true);
  });
});
