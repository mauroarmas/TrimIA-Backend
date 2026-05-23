---
name: Procesos de Credimisión S.R.L.
description: Mapeo de los procesos reales del cliente principal a los agentes del sistema. Información de negocio sin la que las Fases 4 y 5 quedarían genéricas.
type: project
originSessionId: 1facc19b-453b-4476-aac3-5d9766931d3d
---
**Cliente:** Credimisión S.R.L. — venta de productos al contado y financiados, operando en Posadas/Garupá (Misiones) y interior. Canales: WhatsApp, Facebook, Instagram, Marketplace + venta presencial.

**Documento fuente:** `docs/Procesos de Credimisión S.R.L..md`

## Mapeo de roles a agentes

| Rol humano | Agente del sistema | Operaciones críticas |
|------------|-------------------|----------------------|
| Vendedor ecommerce/salón (WhatsApp/Meta) | `SALES` | Consultar stock + precio, registrar prospecto en CRM, seguimiento. NO verifica crédito (deriva a ADMIN). Para cerrar deriva al humano con toda la info recopilada |
| Vendedor de calle | `SALES` (mismo agente, modo asistido) | Mismas consultas, sin entrada de WhatsApp |
| Administrativo | `ADMIN` | Verificación crediticia en Riesgo Online (gate de financiación), cotización fuera de lista, control documental. **Único agente con acceso a Riesgo Online.** El más auditable en Paperclip |
| Cobrador online | `COLLECTIONS` | Cobrar cuota semanal por WhatsApp, recibir comprobante, cargar al sistema. NO aprueba crédito (eso es ADMIN, antes de la venta) |
| Cobrador físico | `COLLECTIONS` (apoyo) | Recibe ficha, hace cobranzas presenciales — solo info |
| Logística | `LOGISTICS` | Consultas de stock, fotos/videos, preparación de despacho, remitos |
| Depósito | `DEPOSITS` | Recepción/control/carga de mercadería, distribución física |

**Doble rol de todos los agentes:** además de atender clientes, capacitan a empleados internos sobre los procesos de su área (ej. "¿cómo finalizo una venta con estos datos?"). Ver confidencialidad en [[project-trimia]] (clientes no deben acceder a conocimiento interno).

## Flujos clave detectados

1. **Gate de financiación (ADMIN)** — antes de cerrar venta financiada, `ADMIN` DEBE consultar Riesgo Online. Si tiene deudas → solo contado. Si no → contado o financiado. Lógica de negocio crítica y auditable, no "consulta opcional". SALES deriva a ADMIN cuando aparece financiación.

2. **Derivación SALES → ADMIN → humano** — SALES maneja la conversación comercial; cuando hay financiación deriva a ADMIN para la verificación crediticia; el cierre final siempre vuelve a un humano con toda la info ya recopilada (productos, medio de pago, resultado del crédito).

3. **Ficha de venta como artefacto** — al cerrar venta se genera una ficha que se deriva al cobrador. El agente `SALES` debería producir un objeto estructurado que el agente `COLLECTIONS` pueda consumir.

4. **Escrituras al Paljet por cobranzas** — el cobrador online carga comprobantes al Paljet. Esto contradice el "solo lectura" del plan inicial — Paljet podría requerir métodos de escritura (`registerPayment(...)`) o mantenerse en lectura y derivar al humano para la carga manual.

## Sistemas externos confirmados

| Sistema | Uso | Modo |
|---------|-----|------|
| **Riesgo Online** | Estado de deudas del cliente (gate de financiación) — **exclusivo del agente ADMIN** | Lectura |
| **Paljet** | Facturas, saldos, caja, mercadería | Lectura (revisar si requiere escritura para cobranzas) |
| **CRM** | Base de datos de consultas de clientes | Lectura + escritura (`createProspect`, `addFollowUp`) |
| **Google Drive** | Detalle de créditos, totales por cobrador, productos con cobranza especial | Sin API directa — candidato a ingesta RAG |

## Implicancias para el plan

- **Fase 4 (RAG)**: el Drive con detalles de créditos y "productos con cobranza especial" debe ser ingestable como fuente de conocimiento, no solo manuales/protocolos.
- **Fase 5 (Integraciones)**: revisar si Paljet realmente queda en solo lectura o si necesita endpoints de carga de pagos. Si es solo lectura, el flujo de cobranza termina derivando al humano para cargar el comprobante.
- **Agente SALES**: debe poder generar una "ficha de venta" estructurada como output, no solo texto libre. Posible candidato a structured output con Gemini.

**How to apply:** consultar este memo antes de diseñar tools de los agentes en Fases 4 y 5. Los métodos del CRM, Paljet y Riesgo deben reflejar las operaciones que los roles humanos hacen hoy.
