# Quickstart: Validación de Integraciones (CRM, Stock y Crédito)

**Feature**: `019-integraciones-crm-stock-credito`  
**Date**: 2026-10-21  

Esta guía describe los escenarios de validación ejecutables para verificar de punta a punta las integraciones de Stock (Paljet), Crédito (Riesgo Online) y CRM (Google Sheets vía n8n).

---

## 1. Prerrequisitos

- Docker containers levantados (`postgres`, `redis`, `chromadb`, `nestjs`).
- Dependencias de Node instaladas (`npm install`).
- Base de datos actualizada con Prisma (`npx prisma db push`).
- Token JWT válido para pruebas (`scripts/login-test-users.sh` o login con `juan.perez@credimision.com.ar` para Ventas y `diego.bazan@credimision.com.ar` para Supervisión).

---

## 2. Escenarios de Validación

### Escenario 1: Consulta de Stock con Sustitución Automática (RF09)

**Objetivo**: Verificar que un producto sin stock retorne automáticamente hasta 2 alternativas con stock disponible y enlaces a la web de Credimisión.

```bash
# 1. Ejecutar test unitario del adaptador de stock
npm test src/ai/integrations/adapters/mock-stock.adapter.spec.ts

# 2. Consultar vía API endpoint (vendedor autenticado)
curl -X GET "http://localhost:3000/sales/stock?query=cortadora" \
  -H "Authorization: Bearer $SALES_JWT"
```

**Resultado esperado**:
- El SKU sin stock devuelve `available: false`.
- En `suggestedSubstitutes` se incluyen hasta 2 alternativas con `stock > 0`, sus precios y links a `credimision.com.ar`.

---

### Escenario 2: Verificación Crediticia Confidencial (OE-10, RF10)

**Objetivo**: Asegurar que un vendedor pueda verificar si un cliente califica sin tener acceso al detalle de deuda confidencial de Riesgo Online.

```bash
# 1. Petición como vendedor de Ventas
curl -X POST "http://localhost:3000/sales/credit-check" \
  -H "Authorization: Bearer $SALES_JWT" \
  -H "Content-Type: application/json" \
  -d '{"dni": "30123458", "amount": 250000}'
```

**Resultado esperado**:
- Código HTTP 200.
- Payload contiene `{ "verdict": "APPROVED", "commercialCondition": "..." }`.
- No aparecen campos como `score`, `rawReport` ni detalles bancarios en la respuesta del vendedor.

```bash
# 2. Ejecutar test de confidencialidad
npm test src/sales/sales-credit-confidentiality.spec.ts
```

---

### Escenario 3: Sincronización de Prospecto al CRM (Google Sheets vía n8n) y Fallback Local

**Objetivo**: Validar que la captación del bot envíe el prospecto a n8n, y que si n8n no está disponible, el prospecto se guarde en PostgreSQL localmente sin arrojar error 500.

```bash
# 1. Test unitario y de resiliencia del adaptador CRM
npm test src/ai/integrations/adapters/n8n-crm.adapter.spec.ts

# 2. Consultar lista de prospectos en el panel de ventas
curl -X GET "http://localhost:3000/sales/prospects" \
  -H "Authorization: Bearer $SALES_JWT"
```

**Resultado esperado**:
- Se recuperan los prospectos pendientes de contacto con sus 17 campos canónicos.
- Si n8n estuvo caído, los registros figuran con `syncStatus: PENDING` para reintento.

---

### Escenario 4: Registro y Auditoría de Cierre de Venta

**Objetivo**: Permitir al vendedor registrar una venta como cerrada en TrimIA tras haberla cargado en el ERP Paljet.

```bash
curl -X POST "http://localhost:3000/sales/close" \
  -H "Authorization: Bearer $SALES_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "purchaseRequestId": "550e8400-e29b-41d4-a716-446655440000",
    "finalAmount": 320000,
    "modality": "FINANCED",
    "notes": "Cargado en Paljet Factura B-0002-0000123."
  }'
```

**Resultado esperado**:
- Código HTTP 200 con `{ "success": true, "closedBy": "..." }`.
- La conversación u oportunidad queda registrada con estado cerrado.

---

## 3. Comandos de Verificación Automatizada

Para ejecutar todas las pruebas asociadas al Sprint 6:

```bash
npm test -- --testPathPattern="integrations|sales"
```
