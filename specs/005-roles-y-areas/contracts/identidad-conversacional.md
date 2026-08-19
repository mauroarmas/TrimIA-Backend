# Contrato — Identidad conversacional

Qué sabe el asistente sobre quién le habla, y qué cambia según eso.

## Los cuatro interlocutores

| Interlocutor | Cómo se determina | Trato esperado |
|---|---|---|
| **Cliente** | El teléfono **no** está en la whitelist de empleados | Como hoy: se lo asesora, se le ofrece avanzar |
| **Empleado** | En la whitelist, `role = EMPLEADO` | Como quien trabaja acá: se le responde el procedimiento, no se le explica el negocio |
| **Supervisor** | En la whitelist, `role = SUPERVISOR`, con áreas asignadas | Como responsable de sus áreas |
| **Gerente** | Responsable de **todas** las áreas | Como quien maneja el negocio |

**La determinación es por teléfono, no por sesión.** Por eso vale igual desde el panel
y desde WhatsApp (FR-017), y por eso un empleado dado de baja se degrada a cliente en
el mismo turno, como ya pasa hoy.

## Lo que NO cambia según el interlocutor

Esto es la mitad importante del contrato:

- **Qué agentes puede alcanzar.** Un cliente sigue llegando solo a ventas y cobranzas;
  un empleado, a los cinco. Ser supervisor o gerente **no** amplía ni restringe esto.
- **Qué audiencia se recupera.** Cliente `PUBLICO`, empleado `INTERNO` + `PUBLICO`.
  El rol no interviene.
- **De qué áreas se recupera.** De ninguna en particular: el área de quien pregunta
  **no** filtra el conocimiento (FR-015). Un vendedor pregunta de cobranzas y recibe
  respuesta.

Lo único que cambia por rol es **cómo se le habla** y **qué pasa cuando el sistema no
sabe** (ver [baja-confianza.md](./baja-confianza.md)).

## Asignar áreas de responsabilidad

Superficie nueva en la gestión de empleados. Detrás de `SUPERVISOR`, como el resto de
la gestión de empleados.

| Situación | Resultado |
|---|---|
| Asignar una o más áreas a un empleado | Queda como responsable de ellas |
| Asignar **todas** | Queda reconocido como gerente, **sin ningún campo extra** |
| Quitar áreas | Deja de ser responsable **de ahí en adelante**; los casos ya asignados no se reasignan solos (CL-7) |
| Asignar áreas a alguien con `role = EMPLEADO` | Debe rechazarse: responsable sin ser supervisor es un estado sin sentido |

**No hay endpoint de "hacer gerente".** Es la consecuencia de tener todas las áreas, y
esa es la única forma de llegar ahí.
