# Data Model: Cola de escalados por área

**Fase 1** · Spec: [spec.md](./spec.md) · Research: [research.md](./research.md)

> **Sin migración.** Ningún modelo de Prisma cambia (Decisión 4). Lo que sigue describe
> cómo se **componen** datos que ya existen, y define los conceptos nuevos que viven solo
> en la respuesta de la cola y en el registro de auditoría.

## Lo que ya existe y se usa tal cual

| Entidad | Campo | Rol en esta spec |
|---|---|---|
| `Escalation` | `id`, `status`, `createdAt` | La cola y su orden por antigüedad |
| `Escalation` | `delegatedToId` | Un caso derivado es propio de quien lo recibió (FR-010, FR-011) |
| `Conversation` | `currentAgent` (`AgentType?`) | **El área del caso.** `null` = sin área |
| `Employee` | `areasSupervisadas` (N:M `Sector`) | Las áreas de quien consulta |
| `Sector` | `agentType` (`AgentType?`) | Traduce área → agente. `null` = no habilita ninguna |

## Concepto nuevo: la pertenencia de un caso

Es el concepto central de la spec y **no se persiste**: se calcula al consultar, contra las
responsabilidades del momento (FR-006). Tiene **tres** valores, no dos:

| Valor | Cuándo | Prioridad en la cola |
|---|---|---|
| `PROPIA` | El área del caso está entre los agentes propios, **o** el caso está derivado a quien consulta | 1º |
| `SIN_AREA` | El caso no tiene área (`currentAgent = null`) | 2º |
| `AJENA` | Tiene área, y no es de quien consulta | 3º |

**Que sean tres y no dos es el punto entero.** Con dos valores, un caso sin área cae en
"ajena" y se hunde al fondo de todas las colas a la vez — nadie lo ve nunca, que es
justo lo que FR-008 prohíbe. `SIN_AREA` va segundo, no primero: no le toca a nadie en
particular, pero tampoco puede quedar detrás de casos que sí tienen dueño y no son de quien
mira.

**Cómo se decide `PROPIA`** (mismo criterio que la escritura, consultado y no replicado —
FR-021):

```
esPropia(caso, quienConsulta) =
     caso.delegatedToId === quienConsulta.id           // derivado a mí (FR-010)
  || (caso.area !== null
      && agentesPropios(quienConsulta).includes(caso.area))
```

Detalles que se derivan y no son casos especiales:

- **Responsable de todas las áreas** → `agentesPropios` contiene todos los agentes que
  tengan área asociada → todo lo que tiene área es `PROPIA` → la cola queda en el orden de
  hoy (FR-005). Sale solo; no hay rama para el gerente.
- **Sin áreas asignadas** → `agentesPropios` vacío → nada `PROPIA`, la cola completa en
  orden de antigüedad. Estado detectable, no permiso implícito.
- **Área sin `agentType`** → no aporta nada a `agentesPropios`, igual que en la escritura.
- **Dos áreas con el mismo `agentType`** → el agente aparece una vez en el conjunto; ser
  responsable de cualquiera de las dos alcanza. Sale solo de usar un conjunto.
- **Derivado a otro** → no aparece en la fórmula, así que no vuelve `PROPIA` para terceros.
  Pero **tampoco lo quita de su área**: FR-011 dice que no cuenta como propio de quien
  consulta *si está derivado a otro*. Ver Nota abierta.

### Nota abierta para la implementación

FR-010 y FR-011 juntos admiten dos lecturas cuando el caso **es de mi área pero está
derivado a otra persona**:

- (a) sigue siendo `PROPIA` (es de mi área) — la fórmula de arriba, tal cual.
- (b) deja de serlo (tiene dueño, y no soy yo) — lectura literal de FR-011.

La spec pide (b): "un caso derivado a otra persona NO DEBE contar como propio de quien
consulta, aunque sea de un área suya". La fórmula queda entonces:

```
esPropia = caso.delegatedToId === yo.id
        || (caso.delegatedToId === null && areaEsMia(caso))
```

Se deja anotado porque la fórmula corta es la que uno escribe por reflejo, y la diferencia
solo se nota con un caso derivado — que es exactamente el escenario 2 de US3.

## Concepto nuevo: el registro de respuesta ajena

Atributo del evento `escalation_resolved` que ya se emite (Decisión 3). Tres estados, por
el mismo motivo que arriba: FR-017 exige distinguir "sin área" de "área ajena".

| Qué se asienta | Por qué |
|---|---|
| La pertenencia del caso para quien respondió (`PROPIA`/`AJENA`/`SIN_AREA`) | Es la pregunta que SC-009 quiere contar |
| El área del caso | Para poder mirar *qué* área quedó descubierta, no solo cuántas veces |

Quién respondió ya está en el evento (`resolvedById`), y no se duplica.

**Un caso `SIN_AREA` respondido no es una respuesta ajena.** Si el registro no distingue,
cada caso escalado antes de rutearse aparece como excepción y el registro se llena de ruido
justo en lo que existe para medir.

## Invariantes

Verificables como tests, y cada una atada a lo que rompe:

1. **Conservación.** El conjunto de casos que devuelve la cola sin restringir es
   independiente de quién consulta; solo cambia el orden y la marca (FR-002, SC-002).
2. **Orden estable.** Entre dos casos de la misma pertenencia, gana el más antiguo (FR-003).
3. **Neutralidad para el responsable de todas.** Misma secuencia exacta que antes de esta
   spec (FR-005, SC-003).
4. **Inmediatez.** Cambiar `areasSupervisadas` cambia la cola en la consulta siguiente, sin
   tocar ningún caso (FR-006, SC-005).
5. **La escritura no se mueve.** `assertPuedeEscribir` se comporta igual antes y después
   (FR-020, SC-010).
