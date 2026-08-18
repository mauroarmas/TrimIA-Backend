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
      config(15000, 1800000),
    );
  });

  /** ConfigService con heartbeat e inactividad configurables. */
  function config(heartbeatMs: number, idleMs: number) {
    return {
      get: (key: string) =>
        key === 'SSE_IDLE_TIMEOUT_MS' ? idleMs : heartbeatMs,
    } as unknown as ConfigService;
  }

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

  /**
   * ⭐ El test que sostiene RF-006 y CL-6.
   *
   * Lo obvio sería leer los mensajes perdidos y después conectarse al vivo, pero eso
   * deja un hueco: un mensaje publicado entre la lectura y la suscripción se cae
   * para siempre. El servicio lo hace al revés —se conecta primero y bufferea—, y
   * esto es lo que lo prueba.
   */
  describe('sseStreamFor — reanudación (RF-006, CL-6)', () => {
    const perdido: RealtimeEvent = {
      type: 'message',
      conversationId: 'conv-1',
      data: {
        id: 'msg-perdido',
        role: 'ASSISTANT',
        content: 'me lo perdí',
        agentType: null,
        createdAt: '2026-08-18T13:59:00.000Z',
      },
    };

    /** Ids de los mensajes emitidos, en orden. `RealtimeEvent` es una unión. */
    const idsDe = (mensajes: { data: unknown }[]) =>
      mensajes.map(
        (m) => (m.data as Extract<RealtimeEvent, { type: 'message' }>).data.id,
      );

    it('emite primero los perdidos y después el vivo, en orden', async () => {
      const recibidos: any[] = [];
      const sub = service
        .sseStreamFor('conv-1', { replay: async () => [perdido] })
        .subscribe((m) => recibidos.push(m));

      await new Promise((r) => setImmediate(r));
      onMessage(conversationChannel('conv-1'), JSON.stringify(evento));
      await new Promise((r) => setImmediate(r));
      sub.unsubscribe();

      expect(idsDe(recibidos)).toEqual(['msg-perdido', 'msg-1']);
    });

    it('un mensaje publicado DURANTE la reanudación no se pierde', async () => {
      const recibidos: any[] = [];
      // La reanudación tarda: mientras se resuelve, llega un mensaje en vivo.
      const replay = () =>
        new Promise<RealtimeEvent[]>((resolve) => {
          onMessage(conversationChannel('conv-1'), JSON.stringify(evento));
          setImmediate(() => resolve([perdido]));
        });

      const sub = service
        .sseStreamFor('conv-1', { replay })
        .subscribe((m) => recibidos.push(m));

      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      sub.unsubscribe();

      // El que llegó durante la lectura quedó buffereado y sale DESPUÉS de los
      // perdidos, pero sale. Si el servicio leyera antes de suscribirse, este
      // mensaje no estaría.
      expect(idsDe(recibidos)).toEqual(['msg-perdido', 'msg-1']);
    });

    it('la forma del evento es la misma en la reanudación y en el vivo', async () => {
      const recibidos: any[] = [];
      const sub = service
        .sseStreamFor('conv-1', { replay: async () => [perdido] })
        .subscribe((m) => recibidos.push(m));

      await new Promise((r) => setImmediate(r));
      onMessage(conversationChannel('conv-1'), JSON.stringify(evento));
      await new Promise((r) => setImmediate(r));
      sub.unsubscribe();

      // Si difirieran, el cliente tendría que parsear dos formatos según de dónde
      // vino el mensaje.
      expect(recibidos[0]).toEqual({ type: 'message', data: perdido });
      expect(recibidos[1]).toEqual({ type: 'message', data: evento });
    });
  });

  /**
   * ⭐ CL-15 / T039 — una conversación terminada no vuelve a recibir mensajes: los
   * siguientes van a la conversación nueva. Un stream que siguiera abierto ahí es
   * una conexión que por definición no va a entregar nada más.
   */
  describe('sseStreamFor — la conversación se termina (CL-15)', () => {
    const cerrada: RealtimeEvent = {
      type: 'status',
      conversationId: 'conv-1',
      data: { status: 'CLOSED', currentAgent: null },
    };

    it('entrega el CLOSED y DESPUÉS cierra el stream', async () => {
      const recibidos: unknown[] = [];
      let cerrado = false;

      service.sseStreamFor('conv-1', {}).subscribe({
        next: (m) => recibidos.push(m),
        complete: () => (cerrado = true),
      });

      onMessage(conversationChannel('conv-1'), JSON.stringify(cerrada));
      await new Promise((r) => setImmediate(r));

      // El orden importa: si cortara antes de emitir, el cliente se enteraría de
      // que se cerró el stream sin saber por qué.
      expect(recibidos).toEqual([{ type: 'status', data: cerrada }]);
      expect(cerrado).toBe(true);
      // Acá no hace falta desuscribir: el propio CLOSED completó el stream, que es
      // justamente lo que se está probando.
    });

    it('libera la suscripción al cerrarse (RF-009)', async () => {
      const sub = service.sseStreamFor('conv-1', {}).subscribe();

      onMessage(conversationChannel('conv-1'), JSON.stringify(cerrada));
      await new Promise((r) => setImmediate(r));

      expect(subscriber.unsubscribe).toHaveBeenCalledWith(
        conversationChannel('conv-1'),
      );
      sub.unsubscribe();
    });

    it('otros cambios de estado NO cierran el stream', async () => {
      let cerrado = false;
      const sub = service
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      onMessage(
        conversationChannel('conv-1'),
        JSON.stringify({
          type: 'status',
          conversationId: 'conv-1',
          data: { status: 'WAITING_HUMAN', currentAgent: null },
        }),
      );
      await new Promise((r) => setImmediate(r));

      expect(cerrado).toBe(false);
      // Se cierra a mano: el keepalive es un interval y mantendría vivo el
      // proceso de Jest si el stream quedara abierto.
      sub.unsubscribe();
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

  /**
   * ⭐ RF-023 / SC-012 — una pestaña olvidada no debería retener una suscripción.
   *
   * El límite de esta capacidad es CL-13, y es la mitad importante: si cerrara
   * mientras el asistente está trabajando, sería el defecto que esta spec vino a
   * arreglar (rendirse antes de que llegue la respuesta) reintroducido por otra
   * puerta.
   */
  describe('sseStreamFor — conexión ociosa (RF-023, CL-13)', () => {
    /** Servicio con inactividad corta para no depender de timers largos. */
    const conIdle = (idleMs: number) =>
      new RealtimeService(
        redis as unknown as RedisService,
        config(1000, idleMs),
      );

    const mensajeDe = (role: 'USER' | 'ASSISTANT'): RealtimeEvent => ({
      type: 'message',
      conversationId: 'conv-1',
      data: {
        id: `msg-${role}`,
        role,
        content: 'x',
        agentType: null,
        createdAt: '2026-08-18T14:00:00.000Z',
      },
    });

    it('cierra un stream sin actividad pasado el umbral', async () => {
      jest.useFakeTimers();
      let cerrado = false;

      conIdle(3000)
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      await jest.advanceTimersByTimeAsync(3500);
      jest.useRealTimers();

      expect(cerrado).toBe(true);
    });

    it('no lo cierra antes del umbral', async () => {
      jest.useFakeTimers();
      let cerrado = false;

      conIdle(10000)
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      await jest.advanceTimersByTimeAsync(5000);
      jest.useRealTimers();

      expect(cerrado).toBe(false);
    });

    // ⭐ CL-13 — el límite de RF-023.
    it('NO lo cierra si el asistente está trabajando, por más quieto que esté el usuario', async () => {
      jest.useFakeTimers();
      const svc = conIdle(3000);
      let cerrado = false;

      svc
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      // Llega el mensaje del usuario: hay un turno en curso.
      await jest.advanceTimersByTimeAsync(500);
      onMessage(
        conversationChannel('conv-1'),
        JSON.stringify(mensajeDe('USER')),
      );
      // Pasa de largo el umbral sin que el usuario haga nada más.
      await jest.advanceTimersByTimeAsync(8000);
      jest.useRealTimers();

      expect(cerrado).toBe(false);
    });

    it('cuando llega la respuesta, el turno cierra y vuelve a contar la inactividad', async () => {
      jest.useFakeTimers();
      const svc = conIdle(3000);
      let cerrado = false;

      svc
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      await jest.advanceTimersByTimeAsync(500);
      onMessage(
        conversationChannel('conv-1'),
        JSON.stringify(mensajeDe('USER')),
      );
      await jest.advanceTimersByTimeAsync(5000);
      expect(cerrado).toBe(false); // seguía habiendo turno en curso

      onMessage(
        conversationChannel('conv-1'),
        JSON.stringify(mensajeDe('ASSISTANT')),
      );
      await jest.advanceTimersByTimeAsync(4000);
      jest.useRealTimers();

      expect(cerrado).toBe(true);
    });

    it('cualquier actividad reinicia el contador', async () => {
      jest.useFakeTimers();
      const svc = conIdle(3000);
      let cerrado = false;

      svc
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      // Dos respuestas espaciadas: ninguna deja turno pendiente, pero cada una
      // corre el reloj.
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(2000);
        onMessage(
          conversationChannel('conv-1'),
          JSON.stringify(mensajeDe('ASSISTANT')),
        );
      }
      expect(cerrado).toBe(false);

      await jest.advanceTimersByTimeAsync(4000);
      jest.useRealTimers();

      expect(cerrado).toBe(true);
    });

    // La distinción deliberada: un turno dura segundos, una espera humana puede
    // durar días. Mantener la conexión abierta todo ese tiempo es justo la fuga
    // que RF-023 tapa, y no cuesta nada — la respuesta del supervisor se registra
    // y aparece al reconectar.
    it('un caso que espera a una PERSONA sí se cierra por inactividad', async () => {
      jest.useFakeTimers();
      const svc = conIdle(3000);
      let cerrado = false;

      svc
        .sseStreamFor('conv-1', {})
        .subscribe({ complete: () => (cerrado = true) });

      await jest.advanceTimersByTimeAsync(500);
      onMessage(
        conversationChannel('conv-1'),
        JSON.stringify({
          type: 'status',
          conversationId: 'conv-1',
          data: { status: 'WAITING_HUMAN', currentAgent: null },
        }),
      );
      await jest.advanceTimersByTimeAsync(5000);
      jest.useRealTimers();

      expect(cerrado).toBe(true);
    });

    // CA-18 — la inactividad cierra la CONEXIÓN, nunca la conversación. Es
    // estructural: RealtimeService no conoce ConversationsService, así que no tiene
    // forma de cerrar una conversación. Esto lo deja verificado igual: al cerrarse
    // por inactividad no se publica ningún cambio de estado.
    it('cerrar por inactividad NO cambia el estado de la conversación', async () => {
      jest.useFakeTimers();

      conIdle(3000).sseStreamFor('conv-1', {}).subscribe();

      await jest.advanceTimersByTimeAsync(4000);
      jest.useRealTimers();

      expect(redis.publish).not.toHaveBeenCalled();
    });

    it('el cierre por inactividad libera la suscripción (RF-009)', async () => {
      jest.useFakeTimers();

      conIdle(3000).sseStreamFor('conv-1', {}).subscribe();

      await jest.advanceTimersByTimeAsync(4000);
      jest.useRealTimers();

      expect(subscriber.unsubscribe).toHaveBeenCalledWith(
        conversationChannel('conv-1'),
      );
    });
  });
});
