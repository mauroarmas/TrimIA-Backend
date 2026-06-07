# Guía de Estudio — TrimIA (backend)

> Guía para entender el código y las tecnologías de TrimIA, organizada para
> estudiar a fondo y para preparar la demo. Cada módulo sigue el mismo loop:
> **idea → qué hace y por qué → código → tecnología → preguntas de refuerzo →
> guion de demo**.

## El hilo conductor: "el viaje de un mensaje"

Todo el sistema se entiende siguiendo un mensaje de WhatsApp desde que entra
hasta que el cliente recibe la respuesta:

```
WhatsApp → n8n → [1]webhook → [2]cola → [3]worker → [4]orquestador
                                                          ↓
        cliente ← n8n ← respuesta ← [6]agente ← [5]RAG (conocimiento)
```

## Índice de módulos

0. Panorama — qué es TrimIA y el stack
1. **La puerta de entrada** ← *este módulo*
2. El trabajador (worker)
3. El cerebro (orquestador)
4. Los especialistas (agentes)
5. La memoria de conocimiento (RAG)
6. Persistencia y auditoría
7. Lo transversal (config, errores, tests)

---

# Módulo 1 — La puerta de entrada

**Archivos:** `src/messaging/` (controller, dto, service, module),
`src/common/guards/webhook-secret.guard.ts`, y la config de cola en
`src/app.module.ts` y `src/queue/queue.module.ts`.

## 1.1 🎯 La idea en una frase

> Cuando un cliente escribe por WhatsApp, n8n nos manda ese mensaje a una
> dirección HTTP nuestra (`POST /messaging/webhook`). Nosotros lo **validamos**,
> verificamos que **venga de quien dice venir**, lo **anotamos en una lista de
> tareas pendientes** y respondemos al instante "lo recibí". El procesamiento
> pesado (la IA) ocurre después, por detrás.

## 1.2 🔍 Qué hace y por qué

El punto de entrada tiene **una sola responsabilidad**: recibir el mensaje de
forma rápida y segura, y delegarlo. No piensa, no llama a la IA. ¿Por qué?

- **Un webhook tiene que responder rápido.** n8n (y WhatsApp por detrás) espera
  una respuesta en pocos segundos. Si nos pusiéramos a llamar a Gemini + ChromaDB
  (que tardan 3-7 segundos) *antes* de responder, el webhook daría timeout.
- **Solución: desacoplar.** Recibimos → encolamos → respondemos `202 Accepted`
  ("aceptado, lo proceso después") en milisegundos. El trabajo lento corre en un
  worker separado (Módulo 2).

Esto se llama **procesamiento asíncrono con cola de mensajes** y es el patrón
clave de esta capa.

## 1.3 💻 El código, paso a paso

### a) El Controller — define la URL

`src/messaging/messaging.controller.ts`

```ts
@Controller('messaging')                      // prefijo de ruta → /messaging
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}  // inyección

  @Post('webhook')                            // POST /messaging/webhook
  @HttpCode(202)                              // responde 202 Accepted (no 201)
  @UseGuards(WebhookSecretGuard)             // verifica el secreto ANTES de entrar
  @Throttle({ default: { limit: 30, ttl: 60000 } })  // máx 30 req/min
  async webhook(@Body() dto: WebhookMessageDto) {     // valida el body con el DTO
    await this.messagingService.enqueue(dto);
    return { queued: true };
  }
}
```

Conceptos clave:
- **Decoradores** (`@Controller`, `@Post`, etc.): metadatos que NestJS lee para
  saber qué método maneja qué ruta. No ejecutan lógica; *describen*.
- **Inyección de dependencias** (`constructor(...messagingService)`): no hacemos
  `new MessagingService()`. NestJS lo crea y nos lo "inyecta". Esto permite
  testear (podés inyectar una versión falsa) y reusar una sola instancia.
- **`@HttpCode(202)`**: 202 = "Accepted" = "lo recibí, lo proceso después".
  Es el código honesto para un webhook que encola.

### b) El orden de ejecución de un request

Cuando llega el `POST`, NestJS ejecuta las capas en este orden:

```
request → Guard (¿secreto válido?) → Throttler (¿no pasó el límite?)
        → ValidationPipe (¿el body cumple el DTO?) → método webhook()
```

Si cualquiera falla, corta ahí y devuelve un error (401, 429, 400) sin llegar al
método. **El método solo se ejecuta si todo lo anterior pasó.**

### c) El DTO — el "molde" del mensaje

`src/messaging/dto/webhook-message.dto.ts`

```ts
export class WebhookMessageDto {
  @IsString() @IsNotEmpty()  phone: string;
  @IsString() @IsNotEmpty()  message: string;
  @IsEnum(Channel) @IsOptional() channel?: Channel;
}
```

El DTO (Data Transfer Object) define **qué forma tiene que tener el body**. Los
decoradores `@IsString`, etc., son reglas de validación. El `ValidationPipe`
global (configurado en `src/main.ts`) las aplica con tres opciones importantes:

- `whitelist: true` → borra cualquier campo que no esté en el DTO.
- `forbidNonWhitelisted: true` → si mandan un campo de más, **rechaza** (400).
- `transform: true` → convierte el JSON plano en una instancia real del DTO.

> Por eso cuando probamos con `{"from": "...", "userType": "..."}` dio error 400:
> esos campos no están en el DTO y `forbidNonWhitelisted` los prohíbe.

### d) El Guard — la seguridad

`src/common/guards/webhook-secret.guard.ts`

```ts
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context): boolean {
    const provided = request.headers['x-n8n-secret'];
    const expected = this.config.get('N8N_WEBHOOK_SECRET');
    if (!provided || !this.safeEqual(provided, expected))
      throw new UnauthorizedException();   // → 401
    return true;                            // → deja pasar
  }
}
```

- **`CanActivate`**: interfaz de un guard. Devuelve `true` (pasa) o lanza error.
- **Secreto compartido**: n8n y nosotros conocemos el mismo secreto. n8n lo manda
  en el header `x-n8n-secret`. Así sabemos que el request viene de n8n y no de un
  atacante que descubrió nuestra URL.
- **Comparación de tiempo constante** (`timingSafeEqual`): comparar con `===`
  filtra información por *cuánto tarda* la comparación (un atacante puede deducir
  el secreto caracter por caracter midiendo tiempos). `timingSafeEqual` siempre
  tarda lo mismo. Es una defensa contra *timing attacks*.

### e) El Service — encola el trabajo

`src/messaging/messaging.service.ts`

```ts
async enqueue(dto: WebhookMessageDto): Promise<void> {
  const channel = dto.channel ?? Channel.WHATSAPP;
  const conversation = await this.conversations.getOrCreate(dto.phone, channel);
  await this.conversations.addMessage(conversation.id, 'USER', dto.message);

  await this.queue.add('process-message', {           // ← pone el job en la cola
    threadId: conversation.threadId,
    conversationId: conversation.id,
    externalId: dto.phone,
    channel,
    message: dto.message,
  }, {
    attempts: 3,                                       // reintenta 3 veces si falla
    backoff: { type: 'exponential', delay: 2000 },    // espera creciente entre intentos
    removeOnComplete: { count: 100 },                 // higiene: no acumular en Redis
    removeOnFail: { count: 500 },
  });
}
```

Pasos:
1. Busca o crea la **conversación** del cliente (por teléfono).
2. Guarda el mensaje del usuario en la base (tabla `Message`).
3. **Encola** un job `process-message` con todo lo que el worker va a necesitar.
   El método termina acá — no espera a que la IA responda.

## 1.4 🧠 La tecnología detrás

### NestJS
Framework de Node.js para backend, basado en módulos, controllers y servicios,
con **inyección de dependencias** de fábrica. Organiza el código por
responsabilidad. Todo se arma con decoradores.

### Colas de mensajes (BullMQ + Redis)
- **Redis**: base de datos en memoria, ultra rápida. Acá la usamos como el
  "pizarrón" donde se anotan los trabajos pendientes.
- **BullMQ**: librería que implementa una **cola de trabajos** sobre Redis. Tiene
  dos lados:
  - **Productor** (el `MessagingService`): pone jobs en la cola (`queue.add`).
  - **Consumidor/worker** (el `MessageProcessor`, Módulo 2): saca jobs y los
    procesa.
- **¿Por qué una cola y no procesar directo?**
  1. **Velocidad de respuesta**: el webhook responde en ms, no en segundos.
  2. **Resiliencia**: si la IA falla, BullMQ **reintenta** (3 veces, con backoff).
  3. **Control de carga**: si llegan 100 mensajes de golpe, no colapsa; se
     procesan ordenadamente.

### Rate limiting (Throttler)
Limita cuántas requests acepta por minuto (30 en el webhook). Protege contra
abuso o bucles de n8n que disparen miles de llamadas.

## 1.5 ❓ Preguntas de refuerzo

Respondé con tus palabras (después te corrijo y completo):

1. ¿Por qué el webhook responde `202` y encola, en vez de llamar a Gemini y
   responder la respuesta final directamente?
2. Si n8n manda un body con un campo extra que no está en el DTO, ¿qué pasa y por
   qué?
3. ¿Qué hace el `WebhookSecretGuard` y en qué momento del ciclo del request se
   ejecuta (antes o después de la validación del DTO)?
4. ¿Qué papeles cumplen Redis y BullMQ, y cuál es la diferencia entre el
   "productor" y el "consumidor"?
5. ¿Qué significa que `enqueue()` termine *sin esperar* a que la IA responda?
   ¿Dónde sigue el trabajo?
6. (Avanzada) ¿Por qué comparamos el secreto con `timingSafeEqual` y no con `===`?

## 1.6 🎤 Guion de demo (para después)

> "Cuando un cliente escribe, n8n nos pega a un webhook. Validamos el formato,
> verificamos un secreto compartido para asegurarnos de que viene de n8n, y
> guardamos el mensaje en una cola. Le respondemos a n8n al instante que lo
> recibimos. El procesamiento con IA ocurre por detrás, en un worker, así el
> webhook nunca se cuelga y si algo falla se reintenta solo."
