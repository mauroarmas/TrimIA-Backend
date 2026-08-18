import { ConfigService } from '@nestjs/config';
import { firstValueFrom, take, toArray } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { RedisService } from '../redis/redis.service';
import { RealtimeEvent, conversationChannel } from './realtime.types';

/**
 * Tests del bus de eventos (spec 004).
 *
 * El más importante es el del `duplicate()`: es el riesgo concreto de esta
 * feature. `RedisService` extiende `Redis` y es la conexión compartida del
 * proceso; una conexión en modo subscriber no puede ejecutar comandos normales,
 * así que suscribirse sobre la instancia inyectada rompería BullMQ.
 */
describe('RealtimeService', () => {
  let service: RealtimeService;
  let redis: { publish: jest.Mock; duplicate: jest.Mock };
  let subscriber: {
    subscribe: jest.Mock;
    unsubscribe: jest.Mock;
    on: jest.Mock;
    quit: jest.Mock;
  };
  /** Handler que el servicio registra con `subscriber.on('message', ...)`. */
  let onMessage: (channel: string, payload: string) => void;

  const evento: RealtimeEvent = {
    type: 'message',
    conversationId: 'conv-1',
    data: {
      id: 'msg-1',
      role: 'ASSISTANT',
      content: 'hola',
      agentType: null,
      createdAt: '2026-08-18T14:00:00.000Z',
    },
  };

  beforeEach(() => {
    subscriber = {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn((event: string, handler: never) => {
        if (event === 'message') {
          onMessage = handler as unknown as typeof onMessage;
        }
      }),
      quit: jest.fn().mockResolvedValue('OK'),
    };
    redis = {
      publish: jest.fn().mockResolvedValue(1),
      duplicate: jest.fn().mockReturnValue(subscriber),
    };

    service = new RealtimeService(
      redis as unknown as RedisService,
      { get: () => 15000 } as unknown as ConfigService,
    );
  });

  describe('publish', () => {
    it('publica en el canal de la conversación', async () => {
      await service.publish('conv-1', evento);

      expect(redis.publish).toHaveBeenCalledWith(
        conversationChannel('conv-1'),
        JSON.stringify(evento),
      );
    });

    // CL-10 — el más importante de este bloque. addMessage() corre DENTRO del
    // request de POST /messaging/web, así que un publish que propagara su error
    // dejaría de poder enviarse mensajes con Redis caído.
    it('NO propaga el error si el bus falla: el envío no puede depender de la entrega', async () => {
      redis.publish.mockRejectedValue(new Error('Redis caído'));

      await expect(service.publish('conv-1', evento)).resolves.toBeUndefined();
    });
  });

  describe('streamFor — fan-out y conteo de referencias', () => {
    it('un evento publicado llega a un stream abierto', async () => {
      const recibido = firstValueFrom(
        service.streamFor('conv-1').pipe(take(1)),
      );

      onMessage(conversationChannel('conv-1'), JSON.stringify(evento));

      expect(await recibido).toEqual(evento);
    });

    it('el suscriptor es un duplicate(), NUNCA la conexión inyectada', () => {
      service.streamFor('conv-1').subscribe();

      expect(redis.duplicate).toHaveBeenCalledTimes(1);
      expect(subscriber.subscribe).toHaveBeenCalledWith(
        conversationChannel('conv-1'),
      );
    });

    it('dos streams de la misma conversación producen UNA sola suscripción', () => {
      const a = service.streamFor('conv-1').subscribe();
      const b = service.streamFor('conv-1').subscribe();

      expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
      a.unsubscribe();
      b.unsubscribe();
    });

    it('cerrar uno de dos NO desuscribe', () => {
      const a = service.streamFor('conv-1').subscribe();
      service.streamFor('conv-1').subscribe();

      a.unsubscribe();

      expect(subscriber.unsubscribe).not.toHaveBeenCalled();
    });

    it('cerrar el último desuscribe y libera el canal (RF-009)', () => {
      const a = service.streamFor('conv-1').subscribe();
      const b = service.streamFor('conv-1').subscribe();

      a.unsubscribe();
      b.unsubscribe();

      expect(subscriber.unsubscribe).toHaveBeenCalledWith(
        conversationChannel('conv-1'),
      );
    });

    it('abrir y cerrar repetidamente no acumula suscripciones', () => {
      for (let i = 0; i < 20; i++) {
        service.streamFor('conv-1').subscribe().unsubscribe();
      }

      expect(subscriber.subscribe).toHaveBeenCalledTimes(20);
      expect(subscriber.unsubscribe).toHaveBeenCalledTimes(20);
    });

    it('los eventos de una conversación no llegan al stream de otra', async () => {
      const recibidos = firstValueFrom(
        service.streamFor('conv-2').pipe(take(1), toArray()),
      );

      onMessage(conversationChannel('conv-1'), JSON.stringify(evento));
      const otro: RealtimeEvent = { ...evento, conversationId: 'conv-2' };
      onMessage(conversationChannel('conv-2'), JSON.stringify(otro));

      expect(await recibidos).toEqual([otro]);
    });

    it('un payload ilegible se descarta sin romper el stream', async () => {
      const recibido = firstValueFrom(
        service.streamFor('conv-1').pipe(take(1)),
      );

      onMessage(conversationChannel('conv-1'), 'no-es-json');
      onMessage(conversationChannel('conv-1'), JSON.stringify(evento));

      expect(await recibido).toEqual(evento);
    });
  });

  describe('sseStreamFor — revalidación y expiración', () => {
    it('cierra el stream cuando el permiso se perdió (RF-021, CL-9)', async () => {
      jest.useFakeTimers();
      const revalidate = jest.fn().mockResolvedValue(false);
      const emitidos: unknown[] = [];
      let cerrado = false;

      service.sseStreamFor('conv-1', { revalidate }).subscribe({
        next: (m) => emitidos.push(m),
        complete: () => (cerrado = true),
      });

      await jest.advanceTimersByTimeAsync(15000);
      jest.useRealTimers();

      expect(revalidate).toHaveBeenCalled();
      expect(cerrado).toBe(true);
      expect(emitidos).toHaveLength(0);
    });

    it('mantiene el stream mientras el permiso siga vigente', async () => {
      jest.useFakeTimers();
      const emitidos: unknown[] = [];
      let cerrado = false;

      service
        .sseStreamFor('conv-1', { revalidate: () => Promise.resolve(true) })
        .subscribe({
          next: (m) => emitidos.push(m),
          complete: () => (cerrado = true),
        });

      await jest.advanceTimersByTimeAsync(30000);
      jest.useRealTimers();

      expect(cerrado).toBe(false);
      // Dos keepalives, sin ningún evento de dominio.
      expect(emitidos).toEqual([{ data: '' }, { data: '' }]);
    });

    // Fail-closed: ante la duda sobre un permiso, no se sigue entregando.
    it('si la revalidación lanza, cierra el stream', async () => {
      jest.useFakeTimers();
      let cerrado = false;

      service
        .sseStreamFor('conv-1', {
          revalidate: () => Promise.reject(new Error('DB caída')),
        })
        .subscribe({ complete: () => (cerrado = true) });

      await jest.advanceTimersByTimeAsync(15000);
      jest.useRealTimers();

      expect(cerrado).toBe(true);
    });

    // RF-022 + CL-16: gana la expiración incluso sobre "mantener vivo el turno en
    // curso". No se entrega sobre una credencial vencida.
    it('cierra el stream cuando venció el token que lo abrió (RF-022, CL-16)', async () => {
      jest.useFakeTimers();
      const revalidate = jest.fn().mockResolvedValue(true);
      let cerrado = false;

      service
        .sseStreamFor('conv-1', {
          revalidate,
          expiresAt: Math.floor(Date.now() / 1000) - 1, // ya vencido
        })
        .subscribe({ complete: () => (cerrado = true) });

      await jest.advanceTimersByTimeAsync(15000);
      jest.useRealTimers();

      expect(cerrado).toBe(true);
      // Ni siquiera se molesta en revalidar: sin sesión no hay nada que revalidar.
      expect(revalidate).not.toHaveBeenCalled();
    });

    it('los eventos de dominio salen con su type para que @Sse() los nombre', async () => {
      const recibido = firstValueFrom(
        service.sseStreamFor('conv-1', {}).pipe(take(1)),
      );

      onMessage(conversationChannel('conv-1'), JSON.stringify(evento));

      expect(await recibido).toEqual({ type: 'message', data: evento });
    });
  });

  it('onModuleDestroy cierra la conexión suscriptora', async () => {
    service.streamFor('conv-1').subscribe();

    await service.onModuleDestroy();

    expect(subscriber.quit).toHaveBeenCalled();
  });

  it('sin ningún stream abierto, nunca se crea la conexión suscriptora', async () => {
    await service.publish('conv-1', evento);

    expect(redis.duplicate).not.toHaveBeenCalled();
  });
});
