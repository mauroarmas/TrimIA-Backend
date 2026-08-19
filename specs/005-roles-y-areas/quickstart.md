# Quickstart — Verificar que el asistente sabe con quién habla

Cómo comprobar a mano lo que esta spec entrega. Cada escenario dice qué se espera y
por qué importa.

## Preparación

```bash
docker compose up -d --build
docker compose exec nestjs npx prisma db push          # la relación N:M es nueva
docker compose exec nestjs npx ts-node prisma/seed.ts # Diego queda con las cinco áreas
curl http://localhost:3000/health
```

Las credenciales salen del seed, con contraseña de desarrollo `trimia2026`:

```bash
login() {
  curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"trimia2026\"}" | jq -r .accessToken
}

EMP=$(login ana.torres@credimision.com)     # EMPLEADO — Depósito
SUP=$(login diego.bazan@credimision.com)    # SUPERVISOR de Ventas → pasa a GERENTE
UNSUP=$(login test.supervisor2@credimision.com)  # SUPERVISOR de UNA sola área
```

> El campo del login es **`accessToken`**, no `access_token`. Con el nombre
> equivocado el token queda vacío y todo devuelve `401`, que se parece mucho a un
> problema de autenticación real.

---

## Escenario 1 — El asistente no le vende al dueño *(US1, SC-001)*

**La escena que originó la spec.** Como Diego, preguntar por el proceso de venta:

```bash
curl -s -X POST localhost:3000/messaging/web -H "Authorization: Bearer $SUP" \
  -H 'Content-Type: application/json' \
  -d '{"message":"en el proceso de venta, ¿qué datos se le pide a un cliente?"}'
```

**Esperado**: describe el procedimiento. **No** cierra con algo como *"contame qué
tenías en vista y lo vamos viendo"* ni le ofrece asesorarlo como comprador.

**Contraste que hace válida la prueba**: la misma pregunta desde un teléfono **fuera**
de la whitelist (con el simulador) **sí** debe recibir trato de cliente. Si las dos
respuestas son iguales, el rol no está llegando.

---

## Escenario 2 — A un responsable no se le crea un caso *(US2, SC-002)*

Contar los casos abiertos, preguntar algo que el sistema no sepa, y volver a contar:

```bash
antes=$(curl -s -H "Authorization: Bearer $SUP" "localhost:3000/supervisor/escalations?status=PENDING" | jq '.data|length')
curl -s -X POST localhost:3000/messaging/web -H "Authorization: Bearer $SUP" \
  -H 'Content-Type: application/json' \
  -d '{"message":"¿cuál es el protocolo de devolución de mercadería importada?"}'
sleep 8
despues=$(curl -s -H "Authorization: Bearer $SUP" "localhost:3000/supervisor/escalations?status=PENDING" | jq '.data|length')
echo "antes: $antes · después: $despues"
```

**Esperado**: **el mismo número**. Hoy sube en uno — el sistema le crea a Diego un
caso en la cola de la que él es responsable.

Y en el chat debe aparecer el aviso con **los documentos consultados y qué tan cerca
quedaron**, no un "no está en la base".

---

## Escenario 3 — El empleado y el cliente no cambian *(US2, SC-008)*

La mitad que protege contra regresiones. Con **Ana** (empleada, sin rol de
supervisora), la misma consulta que en el escenario 2:

**Esperado**: **sí** se crea el caso y **sí** se le avisa que pasó a un responsable,
exactamente como antes de esta spec. Y **no** ve ningún listado de documentos
consultados.

Con un teléfono fuera de la whitelist (simulador), lo mismo: escala, y **nunca** ve
los documentos.

---

## Escenario 4 — Un empleado sigue consultando otras áreas *(FR-015, SC-008)*

Con **Ana**, que es de Depósito, preguntar algo de cobranzas:

```bash
curl -s -X POST localhost:3000/messaging/web -H "Authorization: Bearer $EMP" \
  -H 'Content-Type: application/json' -d '{"message":"¿cómo se registra un pago de cuota?"}'
```

**Esperado**: responde normalmente. Esta spec **no** restringe qué puede consultar
nadie. Si acá aparece un "no te corresponde", se implementó de más.

---

## Escenario 5 — Responsable de dos áreas *(US3)*

Asignarle a alguien Depósito y Logística, y comprobar que el sistema lo reconoce como
responsable de las dos —y que **no** queda como gerente, porque no son todas—.

**Esperado**: es responsable de dos áreas; puede escribir documentos de ambas y de
ninguna otra; **no** se lo trata como gerente.

---

## Escenario 6 — El gerente no pierde nada *(US3, SC-005)*

Con Diego, que ahora es responsable de las cinco, recorrer el panel:

```bash
for r in metrics conversations escalations agents/status; do
  printf '%-20s %s\n' "$r" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $SUP" "localhost:3000/supervisor/$r")"
done
curl -s -o /dev/null -w 'knowledge: %{http_code}\n' -H "Authorization: Bearer $SUP" localhost:3000/knowledge
```

**Esperado**: **todo 200**. Es la comprobación de que ampliar la responsabilidad no le
quitó acceso — el riesgo que tenía el diseño con un rol nuevo, y que este diseño evita
por construcción.

---

## Escenario 7 — Escribir fuera del área *(US5, SC-006)*

Con un responsable **de una sola área**, intentar editar un documento de otra:

**Esperado**: se rechaza, con un mensaje que explique por qué. Editar uno de su área
funciona normal.

**Y la puerta de atrás**, que es lo que más importa probar acá: resolver un caso de
**otra área** con la opción de "enseñarle al agente".

**Esperado**: se rechaza igual. Si esto pasa, la regla quedó en la pantalla de gestión
y no donde se escribe.

---

## Escenario 8 — Ver sigue siendo ver *(FR-013, SC-007)*

Con ese mismo responsable de una sola área:

```bash
curl -s -H "Authorization: Bearer $UNSUP" localhost:3000/knowledge | jq '.data|length'
```

**Esperado**: el listado **completo**, incluidos los documentos de otras áreas. Si
aparece filtrado, alguien lo restringió "por consistencia" y rompió justo lo que evita
duplicados.

---

## Escenario 9 — Documentos transversales *(CL-6)*

**Esperado**: un responsable de una sola área **no** puede editar un documento
transversal; Diego **sí**. Sin esta regla los transversales quedarían sin nadie que
pueda tocarlos.

---

## Escenario 10 — Igual por WhatsApp *(FR-017, SC-009)*

Con el simulador, escribir desde el **teléfono de Diego** la pregunta del escenario 1.

**Esperado**: el mismo trato que por el panel. La identidad se resuelve por teléfono,
así que la paridad debería salir gratis — pero conviene comprobarla y no suponerla.
