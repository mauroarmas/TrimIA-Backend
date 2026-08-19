# Contrato — Cuando el sistema no encuentra una respuesta confiable

Hoy hay **un** desenlace; pasa a haber **dos**, según quién pregunte.

## Los dos desenlaces

| Quién pregunta | Qué pasa | ¿Se crea un caso? |
|---|---|---|
| Cliente | Mensaje de derivación, como hoy | **Sí** |
| Empleado | Mensaje de derivación, como hoy | **Sí** |
| Supervisor | Aviso de falta de confianza **con lo consultado** | **No** |
| Gerente | Igual que el supervisor | **No** |

El camino de cliente y empleado **no se toca**. Es lo que protege contra una
regresión: si algo se rompe ahí, se rompió lo que ya funcionaba.

## Qué contiene el aviso a un responsable

Tres cosas, y las tres importan:

1. **Que no alcanzó la confianza necesaria** — no que "el dato no existe". Es una
   diferencia de fondo: el sistema informa lo que midió, no concluye lo que no sabe.
2. **Los documentos que consultó**, con su título.
3. **Qué tan cerca quedó cada uno** del umbral.

Con eso quien lee puede distinguir los dos casos que se ven iguales desde afuera:

| Lo que ve | Qué significa | Qué conviene hacer |
|---|---|---|
| Nada parecido, scores muy bajos | El dato probablemente falte | Cargarlo |
| Algo parecido apenas por debajo del umbral | El dato está, mal redactado o mal partido | **Corregirlo, no duplicarlo** |

Ese segundo caso es la razón de ser del contrato. Decirle "no está" lo llevaría a
escribir un duplicado, y los duplicados degradan las respuestas **para todos**: dos
chunks parecidos compiten y se bajan el score mutuamente.

## Lo que el aviso NO puede hacer

- **No se le muestra nunca a un cliente** (FR-009). Los títulos y fragmentos son
  conocimiento interno; exponerlos por acá sería una fuga por una puerta nueva.
- **No inventa un veredicto.** No dice "esto no está en la base": dice qué encontró y
  con cuánta confianza.
- **No crea una `Escalation`.** Si la creara, seguiríamos escalándole al responsable
  su propia consulta, que es el defecto que esto viene a arreglar.

## Qué puede hacer el responsable después

| Acción | Cuándo | Resultado |
|---|---|---|
| Cargar o corregir el documento | El tema es de **sus** áreas | Lo hace él |
| **Derivar** a otra persona | El tema es de **otra** área (CL-2) | A esa persona le entra un caso con el contexto |

El gerente no tiene a quién derivar por encima: en él **el circuito termina**, y eso
es correcto (CL-3).

## La otra vía de derivación no cambia

El asistente puede pedir una persona por dos motivos distintos: porque **no encontró**
conocimiento confiable —lo que cubre este contrato— o porque **sí lo encontró** pero
igual considera que hace falta alguien. El segundo queda **igual para todos**,
incluidos los responsables. Es la opción conservadora: no cambia comportamiento
existente y se revisa si en la práctica molesta.
