# Guiones para grabar los audios de prueba (Fase 4, US1)

Para probar de verdad el extractor de audio (T029/T032/T040) hace falta una voz
real, no el tono sintético del spike — ese sirvió para confirmar que la API
acepta el bloque `media`, pero "sonido de gárgaras" no prueba que la
transcripción sea usable como conocimiento.

Grabalos con el celular, en el tono con que hablaría un supervisor explicándole
algo a un empleado nuevo (no leyendo de corrido — tomate una pausa si te trabas,
mejor que suene natural). Formato indistinto: MP3, WAV, OGG (nota de voz de
WhatsApp) o AAC, todos van. Cuando los tengas, pasame la ruta.

---

## Audio 1 — "Adelanto de varias cuotas juntas" (~50-60 s)

Tema nuevo, no está en el corpus cargado hoy. Al ingestarlo debería quedar
disponible para el agente COLLECTIONS.

> A veces un cliente quiere adelantar el pago de varias cuotas juntas, no solo
> la que le vence. En esos casos, el cobrador tiene que confirmar primero
> cuántas cuotas quiere adelantar y calcular el monto total sumando cada una
> por separado — no se aplica ningún descuento por pago anticipado, salvo que
> haya una promoción vigente para ese cliente puntual.
>
> Una vez que el cliente manda el comprobante, hay que verificar que el monto
> coincida exactamente con la suma de las cuotas que dijo que iba a adelantar.
> Si el monto no cierra, no se acepta el comprobante todavía: se le explica al
> cliente la diferencia y se le pide que aclare para cuántas cuotas era la
> transferencia.
>
> Cuando el monto coincide, se marcan todas esas cuotas como pagadas al mismo
> tiempo, y se le manda al cliente un solo mensaje de confirmación con el
> detalle de qué cuotas quedaron canceladas y cuál es la próxima que le
> vence.

---

## Audio 2 — "Garantía extendida en electrodomésticos" (~45-55 s)

Tema nuevo, para el agente SALES o DEPOSITS.

> Los electrodomésticos grandes que vendemos —heladeras, lavarropas, aires
> acondicionados— tienen la garantía de fábrica de doce meses, pero algunos
> modelos también entran en el programa de garantía extendida del
> fabricante, que agrega hasta doce meses más sin costo adicional para el
> cliente.
>
> Para saber si un producto entra en el programa, hay que fijarse en la
> etiqueta del embalaje: si dice "garantía extendida incluida", el cliente ya
> queda registrado automáticamente al momento de la entrega, no hace falta
> ningún trámite extra de nuestra parte.
>
> Si el cliente pregunta por este beneficio y el producto no tiene la
> etiqueta, hay que aclararle que ese modelo en particular no entra en el
> programa, pero que igual tiene la garantía de fábrica estándar de doce
> meses cubierta por el fabricante.

---

## Audio 3 — el que tiene que FALLAR (para probar FR-009)

Este no es para que quede como conocimiento — es para probar que el sistema
pide reformulación en vez de responder cualquier cosa cuando no entiende. Elegí
**una** de estas dos formas de grabarlo:

- **Opción A (recomendada):** grabá 15-20 segundos de silencio, o tapando el
  micrófono del celular con el dedo mientras "hablás" bajito. No hace falta
  decir nada con sentido.
- **Opción B:** si querés que tenga algo de contenido, decí esta frase pero
  **muy rápido y en voz muy baja**, casi sin vocalizar, idealmente con la tele
  o música de fondo bien alta tapando tu voz:

  > "Eh... sí, quería preguntar por... no sé, lo de la cuota esa, viste, la
  > que... bueno, después te aviso."

Cualquiera de las dos debería hacer que Gemini no pueda transcribir nada útil
— que es justo lo que dispara el pedido de reformulación en vez de una
escalación o una respuesta inventada.

---

## Qué voy a hacer con cada uno

| Audio | Prueba qué | Resultado esperado |
|---|---|---|
| 1 y 2 | FR-002/003/004 — extracción y carga a la base de conocimiento | Queda como documento consultable; el audio original se elimina tras transcribir (FR-004) |
| 3 | FR-009 — audio no transcribible | El sistema informa que no pudo transcribir en vez de crear un documento vacío o inventar contenido |

---

## Resultado de la prueba (2026-08-17)

Los tres audios se grabaron en MP3 (64 kbps) y se subieron por
`POST /knowledge/upload`. Los tres binarios quedaron borrados del disco al
terminar: `storage/knowledge/` vacío (FR-004 ✅).

| Audio | Estado | Observación |
|---|---|---|
| 1 — adelanto de cuotas | `READY`, recuperable en `INTERNO` con score 0.79 | Transcripción fiel, incluidas las muletillas limpiadas |
| 2 — garantía extendida | `READY`, primer resultado en `PUBLICO` con score 0.81 | El filtro de audiencia aguanta: no aparece para `PUBLICO` el doc `INTERNO` del audio 1 |
| 3 — el que debía fallar | **Primero pasó como `READY`** ⚠️ | Ver abajo |

### Hallazgo: el audio 3 no falló como se esperaba

La grabación (Opción B) resultó **más audible de lo previsto** y Gemini la
transcribió sin problemas: `"Sí, quería preguntar por no sé, la cuota eh la
viste que bueno, después te aviso."` — 80 caracteres que entraron a la base de
conocimiento como si fueran una norma de la empresa.

No fue un fallo de la grabación sino del extractor: el marcador
`SIN_CONTENIDO` solo cubría **lo inaudible**, no *lo audible pero inservible*.
Un fragmento de conversación es lenguaje hablado perfectamente entendible, así
que el modelo no tenía por qué descartarlo.

Se corrigió en [audio.extractor.ts](../../src/ai/knowledge/extractors/audio.extractor.ts)
con dos cortes complementarios:

1. El prompt ahora pide `SIN_CONTENIDO` también cuando lo dicho es *"una frase
   suelta, un fragmento cortado o una charla informal, y no una explicación de
   cómo funciona algo en la empresa"*, con instrucción explícita de descartar
   ante la duda.
2. Un piso de 150 caracteres, como red de contención para cuando el modelo
   transcribe igual — el mismo criterio que ya usaban los extractores de PDF y
   Word.

Al resubirlo, el archivo terminó en `FAILED` con motivo legible y **sin crear
documento**, que es lo que FR-005/FR-009 pedían. El caso quedó fijado como test
en `audio.extractor.spec.ts` con el texto real de la transcripción.

**Por qué vale la pena anotarlo**: el audio "malo" no probó lo que se buscaba,
pero destapó un agujero que ningún audio bien grabado habría mostrado. El
prototipo estaba dispuesto a incorporar como conocimiento cualquier cosa que
alguien dijera en voz alta.
