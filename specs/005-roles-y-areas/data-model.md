# Data Model — El asistente sabe con quién habla

**Fase 1** · **Spec**: [spec.md](./spec.md) · **Decisiones**: [research.md](./research.md)

Un cambio persistido (una relación), un tipo nuevo en memoria y un campo agregado a
un tipo existente. **Ninguna entidad nueva.**

---

## 1. Persistido: `Employee` ↔ `Sector`, responsabilidad N:M

```text
Employee                                Sector
├── sectorId ────────────────────────►  (dónde trabaja — 1:N, YA EXISTE)
└── areasSupervisadas ◄──────────────►  (de qué es responsable — N:M, NUEVA)
```

**La relación nueva necesita nombre.** Ya hay una relación entre estos dos modelos, así
que Prisma no puede inferir cuál es cuál: las dos van con `@relation("...")` explícito.
Es un requisito del ORM, no una preferencia de estilo, y sin él el `prisma db push`
falla.

| Quién | `sectorId` | `areasSupervisadas` |
|---|---|---|
| Empleado de un área | su sector | **vacío** |
| Supervisor de un área | su sector | 1 |
| Supervisor de dos áreas | su sector | 2 |
| Diego (gerente) | Ventas | **las 5** |

**No hay un flag de gerente.** Ser gerente se **deriva** de tener todas las áreas
(research §3): guardarlo además de la lista crearía dos fuentes de verdad que pueden
contradecirse, y el día que existan seis áreas quien tenga cinco dejaría de ser
gerente solo, que es lo correcto.

**Migración**: `prisma db push`, como todo el proyecto. La tabla de unión la crea
Prisma. **El seed tiene que asignarle las cinco áreas a Diego**: sin eso queda como un
supervisor común y la mitad de la feature no se puede probar.

**Sin cambios en `EmployeeRole`.** Sigue siendo `EMPLEADO | SUPERVISOR`. Es lo que
deja intactos los 23 decoradores `@Roles(...)` y el guard.

---

## 2. En memoria: `Caller` — quién habla

No se persiste. Se arma por turno en `MessageProcessor` y viaja en el estado del
orquestador hasta el prompt y hasta el router de confianza.

| Campo | Tipo | De dónde sale | Para qué |
|---|---|---|---|
| `userType` | `EMPLEADO` \| `CLIENTE` | Presencia del teléfono en la whitelist (**ya se calcula así**) | Audiencia del RAG y agentes permitidos — **no cambia** |
| `role` | `EMPLEADO` \| `SUPERVISOR` | `Employee.role` (**ya lo devuelve `findByPhone`**) | Trato del asistente y ruteo de baja confianza |
| `areas` | `Sector[]` | La relación N:M | Qué puede modificar; y de qué se lo trata como responsable |
| `esGerente` | `boolean` | **Derivado**: `areas` = todas | Trato del asistente |

**Reglas de consistencia:**

- Un `CLIENTE` tiene siempre `role` y `areas` vacíos: no está en la whitelist, así que
  no hay de dónde sacarlos. Si alguna vez llegaran con valor, es un error de
  construcción del objeto, no un permiso.
- Un `EMPLEADO` con `role = SUPERVISOR` y `areas` vacío es un estado **detectable, no
  un permiso implícito** (CL-10): se lo trata como responsable para el trato y el
  escalado, y no puede modificar ningún documento porque no tiene áreas.
- `esGerente` **nunca** se toma de un campo persistido: se calcula en un solo lugar.

---

## 3. Modificado: `RetrievedDoc` gana el título

```text
RetrievedDoc {
  documentId   uuid
  score        0-100       // como lo guarda KnowledgeRetrieval
  rank         0 = mejor
  title        string      // ← NUEVO
}
```

Hace falta porque el aviso de baja confianza tiene que decir **qué** se consultó, y
"documento a3f2b8c1" no le sirve a nadie. El dato ya existe —`SearchHit` trae `title`—
y hoy se descarta al mapear al estado.

**Es solo en memoria**: no cambia lo que se persiste en `KnowledgeRetrieval` para
auditoría, que sigue guardando el id y el score.

---

## 4. Lo que NO cambia

| | Por qué importa decirlo |
|---|---|
| `EmployeeRole` | Sin rol nuevo, el guard y los 23 decoradores quedan intactos |
| El filtro de audiencia (`INTERNO`/`PUBLICO`) | Se sigue decidiendo por `userType`, en el mismo lugar |
| `allowedAgentsFor()` | La lectura **no** se restringe por área (FR-015) |
| `KnowledgeDocument` | Ya tiene el `agentType` que dice de qué área es |
| `Sector.agentType` | Ya mapea área ↔ agente. Es lo que hace barata la regla de escritura |
| `Escalation` | La derivación a otra persona ya existe con su `delegatedToId` |

---

## 5. Cómo se decide si alguien puede escribir un documento

No es una entidad, pero es la regla que da sentido a la relación, y conviene que esté
escrita en un solo lado:

```text
puedeEscribir(caller, documento):
    si documento.agentType es GENERAL  →  caller.esGerente
    si no                              →  documento.agentType ∈ agentes(caller.areas)
```

donde `agentes(areas)` sale de `Sector.agentType`, que **ya existe**.

Los `GENERAL` necesitan su propia línea: responden para todos los agentes, así que con
la regla general quedarían sin nadie que pueda tocarlos (CL-6).
