# Pre-spec 9 — Cola de escalados por área

**Sprint** 5B · **Orden** 9 de 9, **última** · **Tareas del plan** 5B.15
**Depende de** — (usa la spec 005, ya implementada) · **Estado** ✅ **implementada** · **Spec** [013-cola-de-escalados-por-area](../../specs/013-cola-de-escalados-por-area/)
**Origen** futura del 2026-08-22, especificando la spec 007

> **Renumerada de 6 a 9** el 2026-08-25. No cambió nada de su contenido: se movió al
> final porque el sprint creció con pre-specs que sí encadenan con el corpus, y ésta no
> depende de ninguna. Es la única que no es sobre conocimiento — va última porque puede
> ir en cualquier momento, no porque importe menos.

## Qué se quiere

La spec 005 hizo que cada responsable escriba solo en sus áreas, pero la cola de casos
escalados le sigue mostrando a **todos** los supervisores **todos** los casos, sin
importar el área. Que la cola muestre — o al menos distinga — lo que le toca a cada
quien.

## Alcance

- **Entra:** que `listPending` (o el frontend, según lo que se decida al especificar)
  tenga en cuenta el área del caso frente a las áreas del supervisor que consulta.
- **Entra:** decidir si "responder" al cliente también se restringe, no solo "enseñarle
  a la IA" (que ya está resuelto desde la 005).
- **No entra:** tocar `assertPuedeEscribir` ni la regla de escritura ya implementada —
  esta pre-spec es sobre **lectura/visibilidad** de la cola, un permiso que hoy no
  existe en ningún lado.

## Lo que ya existe y hay que reusar

| Qué | Dónde |
|---|---|
| Áreas de una persona | `EmployeesService.findById` → `areasSupervisadas` (spec 005) |
| La regla de "es responsable de", como molde (aunque sea de escritura) | `KnowledgeService.assertPuedeEscribir` |
| Derivar un caso a quien corresponde | `delegate()` (spec 001, ampliado en la 005 US4) |
| El área del caso, ya en el listado | `Conversation.currentAgent` |
| Filtro actual, solo por estado | [`escalations.service.ts:117`](../../src/escalations/escalations.service.ts#L117) — `listPending` no recibe área ni empleado; [`supervisor.controller.ts:342`](../../src/supervisor/supervisor.controller.ts#L342) no se lo pasa |

## Decisiones al especificar

1. **¿Filtrar u ordenar/marcar?** Ocultar del todo los casos ajenos deja sin cobertura
   las áreas sin responsable activo; marcarlos y priorizar los propios puede ser mejor
   que esconderlos.
2. **El gerente no puede perder nada.** Quien es responsable de las cinco áreas (hoy,
   Diego Bazán) tiene que seguir viendo todo — se deriva de tener todas las áreas, no
   de un caso especial a mantener aparte. **Probar con alguien de una sola área**
   (Laura, Ventas): con Diego "no cambia nada" es exactamente lo esperado y no prueba
   nada.
3. **Casos sin área.** `currentAgent` puede ser `null` si el turno no llegó a rutearse.
   No le tocan a nadie en particular y no pueden quedar huérfanos de la cola.
4. **¿Responder también se restringe?** Es la mitad de la regla que hoy falta.
   Restringirlo es coherente con la 005, pero puede dejar clientes esperando si el
   responsable no está — a decidir contra ese costo.

## Riesgo principal

Implementarlo y probarlo solo con Diego (el único supervisor que se usa hoy para
probar el panel) no prueba nada: con él "no cambia nada" es el resultado correcto y
el defecto queda igual de invisible que ahora.

---

## Material de respaldo

### Cómo se ve hoy, en la práctica

| Acción | ¿Restringida por área hoy? |
|---|---|
| **Ver** un caso de otra área | ❌ No |
| **Responderle** al cliente | ❌ No |
| **Enseñarle a la IA** sobre ese caso | ✅ Sí — `assertPuedeEscribir`, solo si `teachAgent` |

Un supervisor de Ventas puede hoy contestarle a un cliente de Cobranzas, pero no puede
capitalizar esa respuesta enseñándosela a la IA. La mitad de la regla está puesta.

### Por qué importa

- Quien contesta puede no saber del tema — el riesgo que la 005 redujo en la escritura
  y que quedó abierto en la lectura/respuesta.
- La cola no es accionable: con más volumen, cada responsable revisa casos que no le
  tocan para encontrar los suyos.
- Se descubrió especificando la 007, dando por sentado que ya funcionaba así — vale
  cerrarlo antes de que otra spec se apoye en la misma asunción.
