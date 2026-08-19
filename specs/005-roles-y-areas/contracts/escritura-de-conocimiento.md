# Contrato — Quién puede modificar el conocimiento

## La regla

Un responsable puede **escribir** un documento si el documento es de alguna de sus
áreas. Los **transversales** —los que responden para todos los agentes— los escribe
quien es responsable de **todas**.

```text
puedeEscribir(persona, documento):
    documento transversal  →  la persona es responsable de todas las áreas
    si no                  →  el área del documento ∈ áreas de la persona
```

## Ver ≠ editar

| Acción | ¿Se restringe por área? |
|---|---|
| Ver el listado de conocimiento | **No** |
| Ver un documento | **No** |
| Crear, editar, activar/desactivar, borrar, reindexar, aplicar edición asistida | **Sí** |
| Subir un archivo como documento | **Sí** |
| Guardar la respuesta de un caso resuelto como documento | **Sí** |

**La lectura no se restringe y es a propósito.** Hace falta ver lo de otras áreas para
no duplicarlo y para saber a quién derivar. La restricción existe para proteger la
calidad del corpus; filtrar la lectura la empeoraría. Es fácil filtrar el listado "por
consistencia" y sería un error.

## Las diez puertas

La escritura no entra solo por la pantalla de gestión. Entra por **diez** caminos, y
**dos están en otro módulo**:

| Dónde | Cuántos |
|---|---|
| Gestión de conocimiento (crear, subir, editar, activar, borrar, edición asistida, reindexar) | 8 |
| Resolver un caso "enseñándole al agente" | 1 |
| Guardar una respuesta sin enviarla — **ingesta siempre**, es su único efecto | 1 |

**Por eso la regla no vive en la pantalla ni en los permisos de ruta, sino donde se
escribe.** Restringir solo la gestión deja la puerta de atrás abierta: un responsable
de Ventas resuelve un caso de Cobranzas enseñándole al agente y mete un documento en
un área ajena, sin que nada lo delate.

## Casos límite

| Situación | Resultado |
|---|---|
| Responsable sin áreas asignadas | No puede escribir **nada**. Es un estado detectable, no un permiso implícito (CL-10) |
| Documento transversal, responsable de una sola área | No puede |
| Documento transversal, responsable de todas | Puede |
| Empleado sin rol de supervisor | Ya no llega: la gestión de conocimiento es de supervisores |
| Le quitan un área con documentos que él creó | Deja de poder editarlos. Lo que escribió queda; la autoría no da permiso permanente |
