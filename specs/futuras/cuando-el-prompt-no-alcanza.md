# Cuando el prompt no alcanza — insumo para una spec futura

**Detectado**: a lo largo del 2026-08-20 al 2026-08-22, probando el panel a mano.
**Estado**: anotado, **sin implementar**. No hay rama ni tareas.

> Esto **no es una spec**: es el registro de un patrón que apareció cuatro veces en
> tres días. Sigue el criterio de [higiene-base-de-conocimiento.md](higiene-base-de-conocimiento.md).

---

## El problema, en una frase

El comportamiento del asistente se define en prompts, y **no hay ninguna forma de
saber si un prompt se está cumpliendo** salvo abrir el panel y conversar a mano.

## La evidencia: cuatro defectos, tres días

Ninguno fue un error de código. En los cuatro, el prompt decía lo correcto o no decía
nada, y solo se supo probando.

| Qué pasó | Qué decía el prompt | Cómo terminó |
|---|---|---|
| Le vendía al dueño de la empresa | El bloque de interlocutor decía "a quien trabaja acá no se le vende"… contra **quince** menciones de "el cliente" que daban por sentado que quien escribe es un comprador | Se neutralizó el supuesto en los tres archivos (`a3dc8e8`) |
| "hola! ¿qué venden?" se contestaba como saludo puro y la pregunta se perdía | `scope_check` tenía la regla; `classify_intent` **no**, y los dos casos eran primeros mensajes | Se agregó la regla con ejemplos (`e963d17`) |
| Pedía permiso para derivar mientras ya derivaba | **Tres** instrucciones explícitas lo prohibían, una con la frase textual como ejemplo de lo prohibido | Control determinístico en código (`2c7788a`) |
| Volvía a saludar en el cuarto mensaje | Nada lo prohibía | Se agregó la regla (`a19bdd3`) |

Dos patrones que vale separar, porque piden remedios distintos:

- **Faltaba la regla** (casos 2 y 4): se agrega y listo. Barato.
- **La regla estaba y se ignoró** (casos 1 y 3): agregar una cuarta instrucción no
  cambia nada. El caso 1 se arregló sacando las instrucciones que competían; el 3,
  detectando la contradicción en código. **Cuando el prompt no alcanza, el remedio no
  es más prompt.**

## Por qué esto importa más de lo que parece

- **Los tests actuales no lo cubren, y no pueden.** Lo que verifican es que la
  instrucción **esté** en el prompt (`expect(prompt).toMatch(...)`), no que el modelo
  la **cumpla**. Es lo correcto para un test unitario —la decisión la toma Gemini—
  pero significa que la suite puede estar en verde con el asistente comportándose mal.
- **Los cuatro los encontró una persona conversando.** No hay ninguna otra red.
- **Cada cambio de prompt puede romper algo que andaba** y no hay forma de saberlo:
  al neutralizar "el cliente" para arreglar el tono se pudo haber degradado el trato
  al cliente real, y lo único que lo descartó fue volver a probarlo a mano.
- Es una tesis: "el asistente responde bien" es una afirmación que en algún momento
  hay que **sostener con números**, no con capturas de pantalla.

---

## Qué haría falta

Un **banco de escenarios**: conversaciones fijas con lo que tiene que pasar, que se
puedan correr contra el sistema real y digan cuántas pasaron.

No es un test unitario ni reemplaza a los que hay. Es otra cosa: mide **el
comportamiento del modelo**, que es no determinístico, así que la unidad de medida no
es "pasa/falla" sino "pasó N de M veces".

Escenarios que ya existen escritos, sacados de los defectos reales:

| Escenario | Qué tiene que pasar |
|---|---|
| El dueño pregunta por el proceso de venta | Describe el procedimiento; **no** le ofrece asesorarlo como comprador |
| El mismo mensaje desde un teléfono fuera de la whitelist | Trato de cliente. Si las dos respuestas son iguales, el rol no está llegando |
| "hola! ¿qué venden?" | Contesta la pregunta, no solo el saludo |
| "hola" solo | Saluda, y nada más |
| Cuarto mensaje de una conversación en curso | No vuelve a saludar |
| Pregunta por financiación | No deriva por el stock, que nadie preguntó |
| Cualquier mensaje con `needsHuman: true` | No termina preguntando |
| Supervisor con consulta sin respuesta confiable | Informe con documentos y score; **cero** casos nuevos en la cola |

Los ocho salieron de romperse en producción. Son el mejor punto de partida que hay.

## Decisiones a tomar al escribir la spec

**1. Cuántas corridas por escenario.** Una sola no dice nada: el mismo escenario dio
respuestas distintas en corridas seguidas —en una tanda de cuatro, tres ofrecieron
consultar y una perdió el hilo—. Sin repetición no se distingue "se rompió" de "esta
vez salió distinto".

**2. Cómo se evalúa cada respuesta.** Tres caminos con costos muy distintos:
por patrones (barato y frágil), con un modelo de juez (caro y hay que validarlo), o
a mano sobre una muestra (no escala pero es el único fiable de entrada). Se puede
empezar por patrones sobre las cosas que **no** pueden aparecer —"¿querés que lo
consulte?" con la conversación congelada es detectable con una expresión regular—,
que es donde estuvieron los defectos reales.

**3. Cuánto cuesta correrlo.** Cada escenario son varias llamadas a Gemini. Ocho
escenarios por cinco corridas es un número que hay que mirar antes de prometer que
corre en cada commit.

**4. Contra qué corpus.** Los resultados dependen de qué documentos hay cargados. Con
la base cambiando todo el tiempo, dos corridas no son comparables. Hace falta un
corpus fijo de prueba, y eso choca con que hoy los tests corren contra la base real.

**5. Dónde vive.** No puede ser `npm test`: eso corre en cada cambio, no puede
depender de la red ni gastar tokens. Es otro comando, otro momento.

---

## Lo que NO debería hacer

- **Bloquear el desarrollo.** Un escenario que falla 1 de 5 veces es información, no
  un semáforo rojo.
- **Reemplazar la prueba a mano.** Los cuatro defectos los encontró alguien
  conversando y notando algo raro; ningún banco de escenarios habría anticipado
  "esto suena a que me está vendiendo".
- **Medir lo que ya miden los tests unitarios.** Autorización, ruteo y audiencia se
  fijan mejor y más barato ahí.

## Pendiente suelto, del mismo tema

**El seguimiento del ofrecimiento no está verificado.** Cuando el agente ofrece
consultar y le dicen que sí, en la prueba en vivo la derivación se disparó por la
**red de seguridad de baja confianza**, no porque el agente entendiera la
confirmación. El resultado fue el correcto y el mensaje coherente, pero si esa
confirmación hubiera superado el umbral, no está comprobado que hubiera derivado
igual. Es exactamente el tipo de cosa que un banco de escenarios contestaría.
