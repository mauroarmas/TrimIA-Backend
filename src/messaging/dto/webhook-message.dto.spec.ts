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
});
