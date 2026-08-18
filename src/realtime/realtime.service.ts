import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  Observable,
  ReplaySubject,
  Subject,
  concat,
  concatMap,
  defer,
  filter,
  interval,
  map,
  merge,
  takeUntil,
  takeWhile,
  tap,
} from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { RealtimeEvent, conversationChannel } from './realtime.types';

/** Lo que `@Sse()` sabe serializar. `data: ''` produce solo una línea vacía. */
interface SseMessage {
  data: string | object;
  type?: string;
}

/**
 * Un evento de dominio, en la forma que sale por el cable. Lo usan **el vivo y la
 * reanudación**: si difirieran, el cliente tendría que parsear dos formatos según
 * de dónde vino el mensaje.
 */
const toSseMessage = (event: RealtimeEvent): SseMessage => ({
  type: event.type,
  data: event,
});

/**
 * ¿Este mensaje avisa que la conversación se terminó?
 *
 * Una conversación cerrada **no vuelve a recibir un mensaje** —los siguientes van a
 * la conversación nueva—, así que un stream que siguiera abierto ahí es una conexión
 * que por definición no va a entregar nada más (CL-15).
 */
const cierraLaConversacion = (message: SseMessage): boolean =>
  message.type === 'status' &&
  (message.data as RealtimeEvent).type === 'status' &&
  (message.data as Extract<RealtimeEvent, { type: 'status' }>).data.status ===
    'CLOSED';

export interface StreamOptions {
  /**
   * Se ejecuta en cada keepalive para confirmar que quien abrió el stream
   * TODAVÍA puede leer esta conversación (RF-021, CL-9). Devolver `false`
   * cierra el stream. Cada endpoint pasa su propio criterio: el chat propio
   * mira pertenencia, el del supervisor mira el rol — la regla no se duplica
   * acá.
   */
  revalidate?: () => Promise<boolean>;
  /**
   * `exp` del token que abrió el stream, en segundos epoch. Un stream no puede
   * sobrevivir a la sesión que lo autorizó (RF-022).
   */
  expiresAt?: number;
  /**
   * Devuelve los mensajes que el cliente se perdió, para emitirlos **antes** del
   * flujo en vivo (RF-006). Es una función y no un array porque se ejecuta
   * DESPUÉS de conectarse al vivo — ver `sseStreamFor()`.
   */
  replay?: () => Promise<RealtimeEvent[]>;
}

/**
 * Bus de eventos de los chats del panel (spec 004).
 *
 * Módulo propio y no parte de `conversations/` por dos razones: lo consumen tres
 * módulos (Conversations publica; Messaging y Supervisor sirven streams) y
 * aislarlo evita el ciclo que aparecería si Conversations dependiera de quien
 * sirve los streams. Es el mismo patrón de WhatsappSenderModule.
 *
 * El evento es una **notificación, no un almacén**: el mensaje ya está en
 * Postgres antes de publicarse, así que perder un evento no pierde nada
 * (RF-007). De ahí se sigue todo lo demás, incluida la resiliencia de publish().
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);

  /**
   * Suscripciones locales por conversación, con conteo de referencias: dos
   * pestañas sobre la misma conversación comparten UNA suscripción a Redis, y
   * al cerrarse la última se desuscribe (RF-009).
   *
   * Ojo con la confusión fácil: esto NO es el `Map` de locks de
   * MessageProcessor, que solo es correcto con una instancia. Este es correcto
   * con varias porque no coordina nada — solo cuenta conexiones **locales**, y
   * el fan-out entre procesos lo hace Redis.
   */
  private readonly channels = new Map<
    string,
    { subscribers: number; subject: Subject<RealtimeEvent> }
  >();

  private subscriber?: Redis;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleDestroy() {
    await this.subscriber?.quit();
  }

  /**
   * Avisa que hay algo nuevo en una conversación.
   *
   * **Nunca lanza, y eso es obligatorio, no una comodidad.** `addMessage()` corre
   * DENTRO del request de `POST /messaging/web` (MessagingService.prepareConversation
   * lo llama antes de encolar), así que un publish que propagara su error dejaría
   * de poder enviarse mensajes con Redis caído. La spec lo prohíbe explícitamente:
   * el envío no puede depender de que la entrega en tiempo real esté disponible
   * (CL-10). El registro en Postgres ya cerró; esto es solo el aviso.
   */
  async publish(conversationId: string, event: RealtimeEvent): Promise<void> {
    try {
      await this.redis.publish(
        conversationChannel(conversationId),
        JSON.stringify(event),
      );
    } catch (err) {
      this.logger.error(
        `No se pudo publicar el evento ${event.type} de [${conversationId}]: ${
          err instanceof Error ? err.message : err
        }. El mensaje quedó registrado igual; se recupera al recargar.`,
      );
    }
  }

  /** Eventos de dominio de una conversación, sin keepalive ni autorización. */
  streamFor(conversationId: string): Observable<RealtimeEvent> {
    return new Observable<RealtimeEvent>((subscriber) => {
      const entry = this.acquire(conversationId);
      const inner = entry.subject.subscribe(subscriber);
      return () => {
        inner.unsubscribe();
        this.release(conversationId);
      };
    });
  }

  /**
   * Stream listo para servir con `@Sse()`: eventos de dominio + keepalive, y el
   * keepalive hace de reloj para revalidar el permiso y detectar el token
   * vencido.
   *
   * Que las tres cosas vivan acá y no en cada controller es deliberado: los dos
   * endpoints de stream necesitan exactamente lo mismo, y duplicarlo era la
   * copia que el Principio V evita.
   */
  sseStreamFor(
    conversationId: string,
    options: StreamOptions = {},
  ): Observable<SseMessage> {
    const heartbeatMs = this.config.get<number>('SSE_HEARTBEAT_MS') ?? 15000;
    const idleMs = this.config.get<number>('SSE_IDLE_TIMEOUT_MS') ?? 1800000;
    const stop$ = new Subject<void>();

    // Estado de inactividad, por stream. No es compartido: cada conexión tiene su
    // propia noción de "hace cuánto que no pasa nada".
    let lastActivity = Date.now();
    let turnPending = false;

    const events$ = this.streamFor(conversationId).pipe(
      tap((event) => {
        lastActivity = Date.now();
        // Un mensaje del usuario abre un turno; la respuesta del asistente lo
        // cierra. Es lo que permite no cortar mientras el asistente trabaja
        // (CL-13) sin tener que consultar la base en cada tick.
        if (event.type === 'message') {
          turnPending = event.data.role === 'USER';
        }
      }),
      map(toSseMessage),
    );

    const keepalive$ = interval(heartbeatMs).pipe(
      concatMap(async (): Promise<SseMessage | null> => {
        if (!(await this.stillAllowed(conversationId, options))) {
          stop$.next();
          return null;
        }

        // Conexión ociosa (RF-023): una pestaña que nadie mira no debería retener
        // una suscripción. Cerrarla no pierde nada — la base es la fuente de verdad
        // y al volver el panel reanuda con `after`.
        //
        // Con un turno en curso NO se cierra (CL-13): cortar mientras el asistente
        // trabaja sería reintroducir por otra puerta el defecto que esta spec vino a
        // arreglar. Un caso que espera a una PERSONA sí se cierra, y la distinción
        // es deliberada: un turno dura segundos, una espera humana puede durar días.
        if (!turnPending && Date.now() - lastActivity >= idleMs) {
          this.logger.debug(
            `Stream de [${conversationId}] cerrado por inactividad. La conversación queda intacta.`,
          );
          stop$.next();
          return null;
        }
        // Keepalive: un evento SIN `data`. Pone bytes en el cable —que es lo que
        // evita que un intermediario corte la conexión por inactividad— y del
        // lado del cliente no despacha nada, porque sin `data` el buffer del
        // evento queda vacío.
        //
        // Se planeó como comentario SSE (`: keepalive`) y no se puede: @Sse() no
        // expone API para comentarios, y su writeMessage() le pone un `id`
        // incremental a todo mensaje que no traiga uno, así que en el cable esto
        // sale como `id: N` y una línea en blanco. El efecto es el mismo. Lo
        // único que consume son ids de evento SSE, que acá no se usan: la
        // reanudación va por `after` con el id del mensaje.
        return { data: '' };
      }),
      filter((message): message is SseMessage => message !== null),
    );

    const live$ = merge(events$, keepalive$).pipe(
      takeUntil(stop$),
      // `inclusive: true` emite el valor que falla el predicado y recién entonces
      // completa: el cliente **ve** el `status: CLOSED` y después el stream corta.
      // Al revés se enteraría de que se cerró sin saber por qué.
      takeWhile((message) => !cierraLaConversacion(message), true),
    );

    if (!options.replay) return live$;

    // Reanudación (RF-006) sin la ventana de CL-6.
    //
    // Lo obvio sería leer los mensajes perdidos y después conectarse al vivo, pero
    // eso deja un hueco: un mensaje publicado entre la lectura y la suscripción se
    // cae para siempre. Así que se hace al revés — **primero** se conecta al vivo
    // y se bufferea todo lo que llegue, después se leen los perdidos, y recién
    // entonces se vuelca el buffer. No puede existir un instante en el que nadie
    // esté escuchando.
    //
    // El empate por milisegundo entre el cursor y un mensaje buffereado lo cubre la
    // deduplicación por id del cliente, que hace falta igual para las dos pestañas.
    const replay = options.replay;
    return new Observable<SseMessage>((subscriber) => {
      const buffer = new ReplaySubject<SseMessage>();
      const liveSub = live$.subscribe(buffer);

      const missed$ = defer(replay).pipe(
        concatMap((events) => events.map(toSseMessage)),
      );
      const outSub = concat(missed$, buffer).subscribe(subscriber);

      return () => {
        outSub.unsubscribe();
        liveSub.unsubscribe();
      };
    });
  }

  /**
   * Dos motivos para cerrar un stream ya abierto, chequeados en cada keepalive.
   *
   * El orden importa poco, pero el criterio de falla sí: si la revalidación
   * lanza, se cierra el stream. Fail-closed — ante la duda sobre un permiso, no
   * se sigue entregando.
   */
  private async stillAllowed(
    conversationId: string,
    options: StreamOptions,
  ): Promise<boolean> {
    // RF-022: el token que abrió el stream no puede sobrevivirlo. Y esto gana
    // sobre "mantener vivo el turno en curso" (RF-008): no se entrega sobre una
    // credencial vencida ni para terminar una respuesta en camino (CL-16). No se
    // pierde nada — la respuesta se registra igual y aparece al reconectar.
    if (options.expiresAt && Date.now() >= options.expiresAt * 1000) {
      this.logger.debug(
        `Stream de [${conversationId}] cerrado: el token que lo abrió venció.`,
      );
      return false;
    }

    if (options.revalidate) {
      let allowed: boolean;
      try {
        allowed = await options.revalidate();
      } catch (err) {
        this.logger.error(
          `No se pudo revalidar el permiso del stream de [${conversationId}]: ${
            err instanceof Error ? err.message : err
          }. Se cierra por precaución.`,
        );
        return false;
      }
      if (!allowed) {
        this.logger.log(
          `Stream de [${conversationId}] cerrado: quien lo abrió ya no puede leer esta conversación.`,
        );
        return false;
      }
    }

    return true;
  }

  private acquire(conversationId: string) {
    const existing = this.channels.get(conversationId);
    if (existing) {
      existing.subscribers += 1;
      return existing;
    }

    const entry = { subscribers: 1, subject: new Subject<RealtimeEvent>() };
    this.channels.set(conversationId, entry);
    this.ensureSubscriber()
      .subscribe(conversationChannel(conversationId))
      .catch((err) =>
        this.logger.error(
          `No se pudo suscribir al canal de [${conversationId}]: ${err}`,
        ),
      );
    return entry;
  }

  private release(conversationId: string) {
    const entry = this.channels.get(conversationId);
    if (!entry) return;

    entry.subscribers -= 1;
    if (entry.subscribers > 0) return;

    entry.subject.complete();
    this.channels.delete(conversationId);
    this.subscriber
      ?.unsubscribe(conversationChannel(conversationId))
      .catch((err) =>
        this.logger.error(
          `No se pudo desuscribir del canal de [${conversationId}]: ${err}`,
        ),
      );
  }

  /**
   * Conexión suscriptora, creada al primer stream.
   *
   * **Tiene que ser un `duplicate()`.** `RedisService` extiende `Redis` y es la
   * conexión compartida de todo el proceso; una conexión ioredis en modo
   * subscriber no puede ejecutar comandos normales, así que suscribirse sobre la
   * instancia inyectada rompería BullMQ y todo lo demás que use Redis acá.
   */
  private ensureSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.redis.duplicate();
      this.subscriber.on('message', (channel, payload) =>
        this.dispatch(channel, payload),
      );
    }
    return this.subscriber;
  }

  private dispatch(channel: string, payload: string) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(payload) as RealtimeEvent;
    } catch {
      this.logger.warn(`Evento ilegible en ${channel}, se descarta.`);
      return;
    }

    const entry = this.channels.get(event.conversationId);
    // Puede no haber nadie escuchando localmente: el evento venía para otra
    // instancia, o la pestaña se cerró entre el publish y la entrega.
    entry?.subject.next(event);
  }
}
