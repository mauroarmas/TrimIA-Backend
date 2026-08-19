/**
 * Test de WhatsappSenderService — Sprint 5A (US4).
 *
 * El chat web (Channel.WEB) usa como `externalId` el teléfono real del
 * empleado (research §8). Sin el corte por canal, cada respuesta del chat
 * web dispararía un WhatsApp real a ese número — algo que nadie pidió, y que
 * además fallaría si ese número no tiene sesión de WhatsApp Business abierta
 * con n8n. `MessageProcessor`, `ConversationsService.replyManually()` y el
 * acuse de `WAITING_HUMAN` comparten este único punto de salida, así que el
 * corte va acá y no repetido en cada llamador.
 */
import { ConfigService } from '@nestjs/config';
import { WhatsappSenderService } from './whatsapp-sender.service';

function buildService() {
  const config = {
    get: jest.fn().mockReturnValue('http://n8n:5678'),
  };
  const service = new WhatsappSenderService(config as unknown as ConfigService);
  return { service };
}

describe('WhatsappSenderService.send — el canal decide si sale por WhatsApp', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('un mensaje de un chat WEB no dispara ningún fetch a n8n', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { service } = buildService();

    await service.send('5493865505362', 'hola', 'WEB' as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un mensaje de WHATSAPP sí llama al webhook de n8n', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { service } = buildService();

    await service.send('5493865505362', 'hola', 'WHATSAPP' as never);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/webhook/send-whatsapp'),
      expect.any(Object),
    );
  });
});
