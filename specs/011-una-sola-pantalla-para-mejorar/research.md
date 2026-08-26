# Fase 0 — Una sola pantalla para mejorar el conocimiento

**Plan**: [plan.md](./plan.md) · **Spec**: [spec.md](./spec.md)

Todo medido contra el corpus real (75 documentos activos) el 2026-08-25, con el modelo
pinneado por `GEMINI_MODEL` y `temperature: 0`. **Dos requisitos de la spec quedaron
falsificados por la medición** y hay que corregirlos antes de implementar.

## D1 — La confianza no corta nada: FR-016 no sirve como está

La spec apostaba a filtrar por confianza alta (FR-016), con la sonda de 12 documentos como
evidencia. Sobre el corpus entero:

| | |
|---|---|
| Documentos analizados | 75 |
| Señalados inconclusos | **53 (71%)** |
| Confianza `ALTA` | **53** |
| Confianza `MEDIA` | **0** |
| Confianza `BAJA` | **0** |

**El modelo nunca usa `MEDIA` ni `BAJA`.** Preguntado "¿está inconcluso?" con una
confianza de tres niveles, contesta sí con confianza alta para todo lo que marca. Filtrar
por confianza deja 53 de 75 ítems — más ruido que las dos pantallas que esta spec
reemplaza, que es exactamente el riesgo que la pre-spec declaró principal.

**La causa no es el modelo, es la pregunta.** Casi todo documento *está* incompleto en
algún sentido; preguntarlo como sí/no obtiene un sí honesto y sin valor. Lo que hace falta
no es cuán seguro está el modelo, sino **cuánto duele la carencia**.

**Decisión**: `estaInconcluso` + `confianza` se reemplazan por **una severidad 0-100**, con
una barra explícita en el prompt ("la mayoría de los documentos razonables caen bajo 60";
"reservá 80+ para contradicciones o para cuando el título promete algo que el cuerpo no
cubre"). FR-016 pasa a cortar por severidad, no por confianza.

**Alternativa descartada**: mostrar solo los documentos que además tienen tráfico detrás.
Cortaría bien, pero reintroduce la dependencia del tráfico reciente — lo único que esta
spec existe para sacar.

## D2 — La severidad sí discrimina

Misma pregunta reformulada, sobre 25 documentos:

| Banda | Documentos | |
|---|---|---|
| 81-100 | **3** | 12% |
| 61-80 | 10 | 40% |
| 31-60 | 8 | 32% |
| 0-30 | 4 | 16% |

Un corte en **80** deja 3 de 25 (~12%): sobre 75 documentos, del orden de **9 ítems** —
una lista que se puede mirar de una sentada. El corte en 75 dejaría 12 de 25 (48%), que ya
no sirve.

Los tres de 85 son casos reales y distintos entre sí, no ruido: `Productos con cobranza
especial`, `E2E reintegros (editado)` y `tarjetas y transferencia`. Y en el extremo bajo,
`Protocolo de atención por WhatsApp` (15) y `Significado y ubicación de la línea Arbol`
(15) son documentos chicos que cubren bien su tema — el modelo no los castiga por cortos,
que era el riesgo del criterio.

⚠️ **La severidad viene cuantizada**: el modelo devuelve 85, 75, 65, 55, 45, 20, 15 — casi
nunca valores intermedios. En la práctica cualquier umbral entre 76 y 85 se comporta igual.
El valor va por variable de entorno igual, pero no esperar que moverlo de 80 a 78 cambie
algo.

## D3 — El paralelismo no ayuda; lo que ayuda es no rehacer el trabajo

| Modo | Documentos | Tiempo | Por documento |
|---|---|---|---|
| Secuencial | 75 | 279 s | 3,7 s |
| Lotes de 5 en paralelo | 25 | 142 s | **5,7 s** |

En paralelo tardó **más** por documento. Con una sola medición de cada uno no se puede
afirmar la causa —lo más probable es el límite de tasa del nivel gratuito de Gemini (100
RPM)— pero alcanza para descartar el paralelismo como forma de llegar al objetivo de
tiempo.

**Decisión**: análisis **secuencial** e **incremental**. Solo se analiza un documento si
nunca se analizó, o si su versión cambió desde el último análisis. La primera corrida de un
área paga el costo completo; las siguientes son casi instantáneas, y en el uso real las
siguientes son la mayoría.

**Consecuencia**: `SC-008` ("menos de 60 segundos para el área más grande") **no se cumple
en la primera corrida**: Ventas son 22 documentos × 3,7 s ≈ **81 s**. Hay que corregir el
criterio, no forzar el diseño para alcanzar un número inventado. Como el análisis no
bloquea a quien lo pide (FR-013), 81 s de espera con aviso es aceptable; lo que sí importa
es que la segunda corrida no vuelva a pagarlo.

## D4 — Las preguntas sin responder llegan solas

**2,8 preguntas por documento señalado**, y **ningún** señalamiento vino con la lista
vacía. FR-014 (registrar qué preguntas concretas deja abiertas) no necesita red de
contención: el modelo las da sin que haya que insistirle. Igual se valida al persistir —
un señalamiento sin preguntas no habilita ninguna acción y no debería guardarse.

## D5 — El detector encuentra cosas que el tráfico no

El caso que justifica la feature, ya visto en la sonda chica y sostenido en la grande: sobre
*"Situación: producto dañado detectado al momento de la entrega"* el modelo señaló que **el
título habla de daños y el cuerpo solo cubre retrasos**. Es una contradicción interna que
ninguna consulta había revelado, y que el barrido de higiene (spec 008) tampoco puede ver:
aquel compara documentos **entre sí**, éste mira **uno solo** y pregunta si se basta.

## D6 — Qué hacer con lo ya marcado como atendido

Hay marcas de "atendido" puestas con la pantalla anterior. FR-024b pide que sigan valiendo
como descarte. No hace falta migrar datos: alcanza con que el descarte nuevo **lea también**
las marcas viejas al filtrar. Un modelo nuevo que ignore el anterior obligaría a la gente a
volver a descartar lo que ya descartó.

## Lo que NO se investigó, a propósito

- **Si el modelo acierta.** "¿Este documento está realmente incompleto?" no tiene verdad
  objetiva contra la cual medir. Lo que sí se midió es que **discrimina** (D2) y que
  encuentra cosas que otros mecanismos no (D5).
- **El costo en tokens.** Es una llamada por documento y solo la primera vez que se analiza
  cada versión; con 75 documentos no hay presión que estudiar.
