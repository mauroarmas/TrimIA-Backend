# «Proponer respuesta» busca el mensaje equivocado

**Anotado** 2026-08-26, probando el panel a mano.
**Tipo** **defecto** de lo ya entregado (spec 003, US3). Se arregla directo con test de
regresión, sin spec — no cambia el modelo de datos ni el alcance.
**RESUELTO** — commit `ca6bf12`, ya en `dev`, con test de regresión en
[`escalation-suggestion.service.spec.ts`](../../src/escalations/escalation-suggestion.service.spec.ts)
(*«con mensajes posteriores al escalado, busca el que lo originó»*). La búsqueda se acota
por `createdAt <= escalation.createdAt` y el porqué quedó escrito en el código, no solo acá.

> ⚠️ **El defecto está cerrado; la parte de producto NO.** Lo de abajo —"los mensajes que
> llegan después del escalado no los atiende nadie"— sigue abierto y **va como pre-spec**.
> Está anotado al final de este archivo para no perder el contexto de cómo se descubrió,
> pero el prefijo `RESUELTO-` se refiere **solo al defecto de búsqueda**.

## El síntoma

«Proponer respuesta con la base de conocimiento» contesta casi siempre *"No hay con qué
redactar una propuesta"*, aun cuando el corpus **sí** tiene material para la consulta
que escaló. Reportado como *"nunca me funcionó"*.

## La causa

[`escalation-suggestion.service.ts:151-161`](../../src/escalations/escalation-suggestion.service.ts#L151-L161)
busca con **el último mensaje del usuario**:

```ts
const lastUserMessage = await this.prisma.message.findFirst({
  where: { conversationId, role: 'USER' },
  orderBy: { createdAt: 'desc' },   // ← el ÚLTIMO de toda la conversación
});
```

Pero el caso se escaló por **otro** mensaje: el del turno que no alcanzó el umbral. El
cliente sigue escribiendo después del escalado —la conversación queda en
`WAITING_HUMAN`, no cerrada— así que para cuando el supervisor abre el caso, el "último
mensaje" ya es otra cosa.

## La evidencia

Caso `c2f91f34` (CLIENTE, COLLECTIONS, escalado con confianza 0.63):

| hora | mensaje | |
|---|---|---|
| 01:01:55 | «me pueden reenviar la factura por mail» | ← **el que escaló** |
| 01:02:50 | «cuantas veces reintentan la entrega si no estoy» | |
| 01:02:54 | «cuanto tarda el cambio de un producto con falla» | |
| 01:02:58 | «atienden los feriados» | ← **el que se buscaba** |

Medido contra ChromaDB real, con el umbral en 65%:

| consulta | mejor score | resultado |
|---|---|---|
| «me pueden reenviar la factura por mail» | **71.2%** «Comprobantes de pago» | ✅ redacta |
| «atienden los feriados» | 62.4% «Horarios de atención y contacto» | ❌ "no hay con qué redactar" |

Se descartó por medición que fuera un problema de **audiencia**: con `PUBLICO`,
`INTERNO`, con filtro de área y sin él, la consulta correcta da 71.2% en los cuatro
casos. La audiencia no interviene.

## Por qué es sistemático y no ocasional

No es mala suerte: **cuanto más tarda en atenderse un caso, más lejos queda el último
mensaje del que lo originó.** Y el fallo es silencioso — el mensaje equivocado suele dar
"casi" (62.4% contra un umbral de 65%), nunca tan bajo como para parecer un bug. La
pantalla dice "no hay información cargada sobre este tema" y eso es **falso**: la hay,
se buscó otra cosa.

Agravante: el dato correcto ya estaba guardado. `Escalation.reason` contiene la consulta
que escaló (se ve en la nota interna del caso: *«Consulta del cliente: "me pueden
reenviar la factura por mail"»*), y el código lo usaba solo como fallback para cuando no
hay ningún mensaje.

## El arreglo

Buscar el último mensaje `USER` **anterior o igual a `escalation.createdAt`**, que es
exactamente el turno que escaló. Acotar por fecha y no leer `reason` porque `reason` es
un texto redactado por el agente que *incluye* la consulta entre otras cosas; el mensaje
original es el dato limpio.

---

## Lo que quedaba abierto — resuelto por la opción mínima

**Los mensajes que llegan después del escalado no los atendía nadie.** En el caso de
arriba, el cliente hizo **tres** consultas más mientras esperaba: sobre reintentos de
entrega, cambio por falla y feriados. Ninguna generaba su propio caso ni aparecía en
ningún lado más que en el historial de la conversación.

Arreglar la búsqueda hizo que la propuesta responda **la consulta correcta** — y con eso
dejó más visible que las otras tres seguían sin respuesta.

Se evaluaron tres opciones:

- ✅ **Mostrarlas en el caso**, para que el supervisor las vea al responder y las conteste
  todas juntas. **Es la que se implementó.**
- **Que generen su propio caso** si vuelven a caer bajo el umbral. Descartada por ahora:
  multiplica la cola con casos de la misma conversación, y eso choca de frente con lo
  que la spec 013 acaba de ordenar.
- **Dejarlo así** y asumir que el supervisor lee la conversación entera. Es lo que pasaba,
  y nada se lo señalaba.

**RESUELTO** — `findById` devuelve `consultasPosteriores` (`ConversationsService.getMessagesAfter`).
Verificado contra la API con el caso `c2f91f34`: devuelve las **tres** consultas perdidas.

No hizo falta pre-spec: la opción elegida no toca el modelo de datos ni agrega endpoints
—es un campo más en un detalle que ya se consultaba—, así que entra en la regla de
"defecto de lo ya entregado, se arregla directo con test de regresión". Las otras dos
opciones sí habrían necesitado spec, y por eso se anotaron acá antes de elegir.

### Dos decisiones del arreglo que conviene recordar

1. **`gt` y no `gte`.** El mensaje que escaló puede compartir timestamp con la creación
   del caso, y con `gte` aparecería listado como "sin atender" siendo justamente el que
   se está respondiendo.
2. **Un fallo al traerlas no rompe el detalle del caso.** Son información de más: si la
   consulta falla, el caso igual se tiene que poder abrir y responder. Mismo criterio que
   los candidatos de conocimiento de la spec 007. Hay test.

### Lo que sigue abierto, ahora sí como pre-spec

Que el supervisor **las vea** no es que el sistema **las atienda**. Sigue sin haber una
forma de decir "contesté ésta pero no aquélla", ni de que una consulta posterior que
nadie respondió reclame atención. Eso sí es una decisión de producto con alcance propio.
