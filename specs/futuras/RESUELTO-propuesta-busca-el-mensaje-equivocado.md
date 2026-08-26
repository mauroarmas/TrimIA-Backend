# «Proponer respuesta» busca el mensaje equivocado

**Anotado** 2026-08-26, probando el panel a mano.
**Tipo** **defecto** de lo ya entregado (spec 003, US3). Se arregla directo con test de
regresión, sin spec — no cambia el modelo de datos ni el alcance.
**Estado** arreglado en `fix/propuesta-busca-el-mensaje-equivocado`.

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

## Lo que queda abierto (problema de producto, no este defecto)

**Los mensajes que llegan después del escalado no los atiende nadie.** En el caso de
arriba, el cliente hizo **tres** consultas más mientras esperaba: sobre reintentos de
entrega, cambio por falla y feriados. Ninguna generó su propio caso ni aparece en
ningún lado más que en el historial de la conversación.

Arreglar la búsqueda hace que la propuesta responda **la consulta correcta** — y con eso
deja más visible que las otras tres siguen sin respuesta.

Opciones cuando se toque:

- **Mostrarlas en el caso** como "consultas posteriores sin atender", para que el
  supervisor las vea al responder y las conteste todas juntas.
- **Que generen su propio caso** si vuelven a caer bajo el umbral. Riesgo: multiplica la
  cola con casos de la misma conversación.
- **Dejarlo así** y asumir que el supervisor lee la conversación entera. Es lo que pasa
  hoy, pero nada se lo señala.

Es una decisión de producto con alcance propio: **va como pre-spec**, no como defecto.
