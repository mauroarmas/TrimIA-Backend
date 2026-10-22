# Research: Integraciones CRM (Google Sheets vía n8n), Mock Stock Paljet y Mock Crédito Riesgo Online

**Feature**: `019-integraciones-crm-stock-credito`  
**Date**: 2026-10-21  
**Status**: Completed  

---

## 1. Arquitectura Hexagonal y Puertos de Integración (RNF-04)

### Contexto
TrimIA requiere interactuar con tres sistemas externos críticos para la operación de ventas y cobranzas:
1. **CRM en Google Sheets** (gestionado por la empresa a través de una planilla de 17 columnas).
2. **Sistema de Gestión de Stock Paljet** (consulta de existencias y precios en depósito).
3. **Buró Crediticio Riesgo Online** (consulta de solvencia y scoring financiero para venta en cuotas).

### Decisiones de Diseño

#### D1: Ubicación y modularidad de los puertos
- **Decisión**: Centralizar los puertos e interfaces en `src/ai/integrations/ports/` y los adaptadores en `src/ai/integrations/adapters/`. Proveer un módulo `IntegrationsModule` que registre los providers con tokens de inyección tipados (`STOCK_PORT`, `CREDIT_PORT`, `CRM_PORT`).
- **Razón**: Cumple con el Principio V de la Constitución ("Integraciones externas desacopladas: Paljet, Riesgo Online y CRM se consumen detrás de puertos/adaptadores (interfaces + mocks), no acopladas directamente a un agente").
- **Alternativas consideradas**: Acoplar llamadas HTTP directas dentro de los nodos del grafo LangGraph. *Rechazada* porque violaría el Principio V e impediría correr `npm test` de forma aislada y determinística.

#### D2: Política de ejecución de tests y fallbacks (RNF-04)
- **Decisión**: Los adaptadores por defecto en entorno de pruebas serán puramente en memoria (`MockStockAdapter`, `MockCreditAdapter`, `LocalCrmAdapter` o mock con nock/fetchMock). `N8nCrmAdapter` dispondrá de fallback automático a persistencia local (PostgreSQL) si n8n no responde o arroja timeout.
- **Razón**: Los tests de CI y desarrollo local no deben fallar si los contenedores de n8n o la conexión a internet no están disponibles.

---

## 2. Integración CRM con Google Sheets (vía n8n)

### Contexto
La empresa utiliza una planilla de cálculo de 17 columnas como CRM operativo. La sincronización es de dirección única principal: TrimIA escribe hacia Google Sheets cuando capta un prospecto en WhatsApp o cuando un empleado registra un seguimiento, y consulta Sheets solo al inicio para validar si un teléfono ya fue cargado manualmente por otra área.

### Decisiones de Diseño

#### D3: Comunicación con n8n y esquema de 17 columnas
- **Decisión**: `N8nCrmAdapter` enviará peticiones HTTP POST a los endpoints de webhook de n8n configurados en `N8N_BASE_URL`:
  - `POST /webhook/crm-prospect-create`: Da de alta el nuevo prospecto.
  - `POST /webhook/crm-prospect-search?phone={phone}`: Consulta si el número ya existe en el CRM.
  - `POST /webhook/crm-prospect-followup`: Agrega nota en la columna de historial.
  
  Las 17 columnas canónicas del CRM se mapean en un DTO estructurado:
  1. `Fecha de Contacto` (ISO date / DD-MM-YYYY)
  2. `Nombre y Apellido`
  3. `Teléfono / WhatsApp`
  4. `DNI / CUIT`
  5. `Comercio / Razón Social`
  6. `Rubro / Actividad`
  7. `Dirección / Localidad`
  8. `Producto de Interés`
  9. `Modalidad` (Contado / Cuotas semanales)
  10. `Monto Estimado`
  11. `Estado del Prospecto` (NUEVO, EN_CONTACTO, CALIFICA, NO_CALIFICA, VENTA_CERRADA, PERDIDO)
  12. `Dictamen Crediticio` (APROBADO, CON_CONDICIONES, RECHAZADO, PENDIENTE)
  13. `Vendedor Asignado`
  14. `Canal de Origen` (WHATSAPP, WEB, LOCAL)
  15. `Última Interacción`
  16. `Notas de Seguimiento`
  17. `ID Conversación TrimIA`
- **Razón**: Mantiene a TrimIA independiente de la API de Google Drive/Sheets y de tokens OAuth complejos en NestJS; toda la autenticación con Google reside en los nodos nativos de n8n.
- **Alternativas consideradas**: Usar la librería oficial `googleapis` en NestJS. *Rechazada* porque duplicaría responsabilidades con n8n y agregaría credenciales sensibles al backend.

#### D4: Resiliencia y almacenamiento local (Fallback)
- **Decisión**: Si n8n no responde dentro de un timeout de 3000 ms o devuelve error 5xx, el adaptador captura la excepción, registra un log de advertencia y persiste el prospecto en una tabla local `Prospect` en PostgreSQL (o `Client` / `PurchaseRequest`), marcándolo con `syncStatus: PENDING`.
- **Razón**: Un problema temporal en Google Sheets no debe interrumpir el diálogo del bot ni perder los datos del cliente potencial.

---

## 3. Mock de Stock Paljet y Sustitución Automática (RF09)

### Contexto
Paljet es el sistema ERP de la empresa. No provee API abierta de escritura para TrimIA (lectura únicamente). Cuando un cliente consulta por un equipo gastronómico o comercial, el agente debe verificar existencia. Si el stock es 0, debe sugerir alternativas sustitutas viables según el catálogo.

### Decisiones de Diseño

#### D5: Catálogo Seed y reglas de sustitución
- **Decisión**: Implementar `MockStockAdapter` con un catálogo seed de productos comerciales/gastronómicos típicos de Credimisión:
  - Balanzas electrónicas (ej. Systel Cuora, Systel Croma).
  - Cortadoras de fiambre (ej. Marani 330, Trinidad 300).
  - Sobadoras y amasadoras industriales (ej. Santini 20kg).
  - Hornos pizzeros y convectores.
  - Heladeras exhibidoras y bateas.
  
  Cada item incluye: `sku`, `nombre`, `categoria`, `stock`, `precioLista`, `precioEfectivo`, `substitutos: string[]` (SKUs alternativos), `urlCredimision`.
- **Regla RF09**: Cuando `checkAvailability(sku)` detecta `stock === 0`, el adaptador consulta los `substitutos` definidos y retorna hasta 2 productos alternativos que sí tengan stock > 0, junto con sus precios y links a la web de Credimisión.
- **Razón**: Permite al agente de Ventas responder con empatía comercial sin inventar productos ni precios, guiando al comprador hacia un producto disponible.

---

## 4. Mock de Crédito Riesgo Online y Confidencialidad (RF10, OE-10)

### Contexto
Para ventas en cuotas semanales, la PyME consulta el riesgo del solicitante mediante Riesgo Online (o Veraz). El dictamen financiero detallado es **confidencial** y de uso exclusivo del personal de Administración y Supervisión (OE-10).

### Decisiones de Diseño

#### D6: Algoritmo determinístico de scoring y separación de roles
- **Decisión**: `MockCreditAdapter` evaluará el DNI del cliente de forma determinística para pruebas reproducibles:
  - DNI terminado en número par alto (ej. 8, 0): `APPROVED` (Score > 750, riesgo bajo, sin deudas registradas).
  - DNI terminado en número medio (ej. 4, 6): `APPROVED_WITH_CONDITIONS` (Score 550-749, requiere anticipo del 20% o garante).
  - DNI terminado en número impar específico (ej. 1, 9): `REJECTED` (Score < 550, historial negativo en BCRA).
  - DNI especial de prueba (ej. `00000000`): Simula timeout de servicio devolviendo `UNAVAILABLE`.
- **Confidencialidad (OE-10)**:
  - La herramienta `evaluate_credit_tool` está registrada **únicamente** en el agente `admin.graph.ts`.
  - El endpoint de ventas `POST /sales/credit-check` invoca al servicio interno de evaluación, pero en su DTO de respuesta para el vendedor **filtra y omite** `rawPayload` y datos confidenciales del buró, retornando únicamente:
    `{ verdict: 'APPROVED' | 'APPROVED_WITH_CONDITIONS' | 'REJECTED' | 'UNAVAILABLE', commercialCondition: string }`.
- **Razón**: Garantiza cumplimiento estricto del Principio I de la Constitución (Confidencialidad por Rol y Audiencia) y el objetivo OE-10.

---

## 5. Integración de Tools en Grafos LangGraph

### Contexto
LangGraph en TrimIA utiliza `ChatGoogleGenerativeAI` de `@langchain/google-genai`. Para dotar a los agentes de capacidades de consulta a puertos sin romper la arquitectura RAG:

### Decisiones de Diseño

#### D7: Definición de Tools LangChain
- **Decisión**: Crear las herramientas usando `tool(...)` de `@langchain/core/tools` con esquemas de validación Zod:
  - `check_stock_tool`: `z.object({ query: z.string().describe("Nombre o modelo del producto a consultar") })` → invoca `StockPort.checkAvailability()`.
  - `save_prospect_tool`: `z.object({ name: z.string(), phone: z.string(), product: z.string(), modality: z.enum(["CASH", "FINANCED"]) })` → invoca `CrmPort.createProspect()`.
  - `evaluate_credit_tool`: `z.object({ dni: z.string(), amount: z.number().optional() })` → invoca `CreditPort.checkCredit()`.
- **Inyección en los grafos**:
  - `sales.graph.ts` recibe en sus dependencias los servicios de integración e inyecta `check_stock_tool` y `save_prospect_tool` al LLM cuando corresponda, o provee un nodo `tools_executor` en el subgrafo.
  - Al escalar a un humano, el agente de Ventas genera una salida estructurada (`structuredOutput`) con los campos comerciales acordados (`producto`, `precio`, `modalidad`, `estadoCredito`, `motivoAlerta`).

---

## 6. Conclusión de Factibilidad

Todas las decisiones respetan rigurosamente la Constitución (Principios I, II, III, IV y V), no requieren cambios en dependencias base ni introducen librerías incompatibles, y permiten que los tests unitarios y de integración se ejecuten con `npm test` de forma 100% aislada y rápida.

