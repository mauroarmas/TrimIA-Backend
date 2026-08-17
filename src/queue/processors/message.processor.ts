import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Channel, UserType } from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';
import { OrchestratorService } from '../../ai/orchestrator/orchestrator.service';
import { EmployeesService } from '../../employees/employees.service';

interface MessageJob {
  conversationId: string;
  externalId: string;
  channel: Channel;
  message: string;
  /**
   * Id del Message ya persistido que dispara este job. Opcional porque los
   * jobs encolados antes de existir el campo no lo traen.
   */
  messageId?: string;
}

/**
 * concurrency: 5 — antes era 1, que serializaba TODOS los mensajes de TODAS
 * las conversaciones (un cliente esperaba a que terminara de procesarse el
 * mensaje de otro cliente sin ninguna relación). El único riesgo real de
 * paralelizar es procesar DOS mensajes de la MISMA conversación al mismo
 * tiempo (pisarse el currentAgent sticky, leer historial desactualizado);
 * conversaciones distintas no comparten estado y no necesitan serializarse
 * entre sí. runExclusive() (más abajo) resuelve exactamente eso: encadena
 * por conversationId con un lock en memoria del proceso.
 */
@Processor('message-processing', { concurrency: 5 })
export class MessageProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageProcessor.name);

  /**
   * Cola de ejecución por conversación (mutex en memoria, no distribuido).
   * Correcto mientras haya UNA sola instancia de este proceso — que es el
   * despliegue actual (un contenedor `nestjs` en docker-compose.yml). Si en
   * Cloud Run (Sprint 8) esto llega a correr en más de una instancia, hay que
   * reemplazar esto por un lock distribuido (Redis, ya es dependencia del
   * proyecto vía RedisService) — dos instancias no comparten este Map.
   */
  private readonly conversationLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly conversations: ConversationsService,
    private readonly sender: WhatsappSenderService,
    private readonly orchestrator: OrchestratorService,
    private readonly employees: EmployeesService,
  ) {
    super();
  }

  private static readonly FALLBACK =
    'Disculpá, tuve un problema para procesar tu mensaje. Por favor, intentá de nuevo en unos minutos. 🙏';

  /**
   * Acuse que se manda si el cliente sigue escribiendo mientras su caso
   * espera a una persona. Sin esto le hablaba a una pared: el agente está
   * pausado y no hay ninguna señal de que alguien lo va a atender.
   */
  private static readonly WAITING_HUMAN_ACK =
    'Ya le pasé tu consulta a un responsable 🙌 En cuanto tengamos novedades te escribimos por acá.';

  async process(job: Job<MessageJob>): Promise<void> {
    return this.runExclusive(job.data.conversationId, () =>
      this.processExclusive(job),
    );
  }

  /**
   * Encadena `fn` detrás de lo último encolado para esta conversación, sin
   * importar si ese turno anterior resolvió o rechazó (un fallo no debe
   * trabar los mensajes siguientes de la misma conversación). Limpia la
   * entrada del Map al terminar, salvo que alguien haya encolado un turno
   * más nuevo mientras tanto — si no, quedaría creciendo para siempre.
   */
  private async runExclusive<T>(
    conversationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.conversationLocks.get(conversationId) ?? Promise.resolve();
    const settled = previous.then(fn, fn);
    const tail = settled.then(
      () => undefined,
      () => undefined,
    );
    this.conversationLocks.set(conversationId, tail);
    try {
      return await settled;
    } finally {
      if (this.conversationLocks.get(conversationId) === tail) {
        this.conversationLocks.delete(conversationId);
      }
    }
  }

  private async processExclusive(job: Job<MessageJob>): Promise<void> {
    const { conversationId, externalId, message, channel, messageId } =
      job.data;

    this.logger.log(
      `Processing message [conv=${conversationId}]: "${message}"`,
    );

    try {
      // Sticky + historial: una sola query trae todo lo que necesita el orquestador.
      const conversation = await this.conversations.findById(conversationId);

      // Human-in-the-loop (Sprint 3): mientras un caso está pendiente de un
      // supervisor (WAITING_HUMAN) o alguien tiene el control manual
      // (HUMAN_HANDLING), el agente de IA no responde. El mensaje ya quedó
      // persistido por MessagingService.prepareConversation() antes de
      // encolar — el supervisor lo ve en el contexto sin acción adicional.
      if (conversation && conversation.status !== 'ACTIVE') {
        this.logger.log(
          `Conversación [${conversationId}] en estado ${conversation.status}: no se invoca al agente.`,
        );
        // Solo en WAITING_HUMAN: si un supervisor ya tomó el control
        // (HUMAN_HANDLING) está mirando la conversación y va a contestar él,
        // un aviso automático ahí sobra y confunde.
        if (conversation.status === 'WAITING_HUMAN') {
          await this.acknowledgeWaitingHuman(
            conversationId,
            externalId,
            channel,
          );
        }
        return;
      }

      const currentAgent = conversation?.currentAgent ?? null;
      // Sin el messageId, el mensaje actual vendría también dentro del
      // historial y el agente lo leería duplicado.
      const history = await this.conversations.getRecentHistory(
        conversationId,
        undefined,
        messageId,
      );

      // Determinar userType real: buscar el teléfono en la whitelist de
      // empleados (RF12), que ES la tabla Employee (phone único + isActive).
      //
      // Se consulta en CADA mensaje, no solo cuando la conversación figura
      // como CLIENTE. Antes se salteaba el lookup si ya era EMPLEADO "para no
      // buscar en cada mensaje", y eso volvía imposible la dirección de
      // bajada: a un empleado dado de baja se le seguía sirviendo
      // conocimiento INTERNO hasta que la conversación se cerrara
      // (OE-10 / RNF-02). El costo es un findUnique indexado al lado de una
      // llamada al LLM que tarda segundos.
      const employee = await this.employees.findByPhone(externalId);
      const userType: UserType =
        employee && employee.isActive ? 'EMPLEADO' : 'CLIENTE';

      // Solo se persiste cuando cambió, para no escribir en cada turno.
      if (userType !== conversation?.userType) {
        await this.conversations.setUserType(conversationId, userType);
        this.logger.log(
          `userType de ${externalId}: ${conversation?.userType ?? 'nuevo'} → ${userType}` +
            (employee?.isActive ? ` (${employee.sector.name})` : ''),
        );
      }

      // El orquestador clasifica (o saltea, si hay sticky), deriva y registra.
      const result = await this.orchestrator.invoke(
        message,
        conversationId,
        currentAgent,
        userType,
        history,
      );
      const response = result.response ?? MessageProcessor.FALLBACK;

      // Si se resolvió un agente, queda fijado como sticky de la conversación.
      // (saludos triviales y greeting no tienen agentType → no lo modifican.)
      if (result.agentType) {
        await this.conversations.setCurrentAgent(
          conversationId,
          result.agentType,
        );
      }

      await this.conversations.addMessage(
        conversationId,
        'ASSISTANT',
        response,
        result.agentType ?? undefined,
      );
      await this.sender.send(externalId, response, channel);

      this.logger.log(`Response sent to ${externalId}`);
    } catch (err) {
      // Cualquier fallo (Gemini, Chroma, DB) no debe dejar al usuario sin
      // respuesta. Logueamos y relanzamos para que BullMQ reintente; solo
      // avisamos al usuario en el ÚLTIMO intento, para no duplicar mensajes.
      this.logger.error(
        `Error procesando mensaje [conv=${conversationId}]: ${
          err instanceof Error ? err.message : err
        }`,
      );
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.sender
          .send(externalId, MessageProcessor.FALLBACK, channel)
          .catch((sendErr) =>
            this.logger.error(`No se pudo avisar al usuario: ${sendErr}`),
          );
      }
      throw err;
    }
  }

  /**
   * Le confirma al cliente que su caso está en manos de una persona, UNA sola
   * vez por espera: si vuelve a escribir, no se le repite el mismo mensaje.
   *
   * El "una sola vez" se resuelve mirando si el último mensaje del asistente
   * ya es este acuse, en vez de agregar una columna a Conversation para
   * llevar la cuenta. Cuando el supervisor responde, ese deja de ser el
   * último mensaje, así que una espera posterior vuelve a avisar.
   */
  private async acknowledgeWaitingHuman(
    conversationId: string,
    externalId: string,
    channel: Channel,
  ): Promise<void> {
    const last =
      await this.conversations.getLastAssistantMessage(conversationId);
    if (last?.content === MessageProcessor.WAITING_HUMAN_ACK) return;

    try {
      await this.sender.send(
        externalId,
        MessageProcessor.WAITING_HUMAN_ACK,
        channel,
      );
      await this.conversations.addMessage(
        conversationId,
        'ASSISTANT',
        MessageProcessor.WAITING_HUMAN_ACK,
      );
    } catch (err) {
      // No relanzar: el caso ya está escalado y el supervisor lo va a ver
      // igual. Reintentar el job solo para un acuse sería contraproducente.
      this.logger.error(`No se pudo enviar el acuse de espera: ${err}`);
    }
  }
}
