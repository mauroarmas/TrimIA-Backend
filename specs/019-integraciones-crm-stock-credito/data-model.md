# Data Model: Integraciones CRM, Stock y Riesgo Crediticio

**Feature**: `019-integraciones-crm-stock-credito`  
**Date**: 2026-10-21  
**Status**: Completed  

---

## 1. Domain Entities & Interfaces

### 1.1 Puerto de Stock (Paljet) — `StockPort`

```typescript
export interface StockItem {
  sku: string;
  name: string;
  category: 'BALANZAS' | 'CORTADORAS' | 'GASTRONOMIA' | 'REFRIGERACION' | 'ACCESORIOS';
  stock: number;
  listPrice: number;        // Precio de lista para cuotas
  cashPrice: number;        // Precio contado efectivo
  substituteSkus: string[]; // SKUs de productos alternativos
  urlCredimision: string;   // Link a la ficha web
  lastUpdated: string;      // ISO string
}

export interface StockCheckResult {
  available: boolean;
  item: StockItem;
  suggestedSubstitutes?: StockItem[]; // Máximo 2 alternativas si stock === 0
}

export const STOCK_PORT = Symbol('STOCK_PORT');

export interface StockPort {
  /**
   * Consulta disponibilidad y precio por SKU o término de búsqueda.
   * Si no hay stock disponible, calcula y retorna hasta 2 productos sustitutos (RF09).
   */
  checkAvailability(skuOrQuery: string, userType?: string): Promise<StockCheckResult>;
  
  /**
   * Obtiene la lista completa del catálogo para el panel de ventas.
   */
  listCatalog(category?: string): Promise<StockItem[]>;
}
```

---

### 1.2 Puerto de Crédito (Riesgo Online) — `CreditPort`

```typescript
import { CreditVerdict } from '@prisma/client';

export interface CreditEvaluationInput {
  dni: string;
  fullName?: string;
  requestedAmount?: number;
}

export interface CreditAssessmentResult {
  verdict: CreditVerdict; // APPROVED | APPROVED_WITH_CONDITIONS | REJECTED | UNAVAILABLE
  score: number;          // 0 a 1000
  reason: string;         // Explicación técnica (para ADMIN)
  commercialCondition?: string; // Condición comercial para el vendedor (ej. "Anticipo 20%")
  rawReport?: Record<string, any>; // Informe detallado del buró (CONFIDENCIAL)
  assessedAt: Date;
}

export const CREDIT_PORT = Symbol('CREDIT_PORT');

export interface CreditPort {
  /**
   * Evalúa el perfil crediticio a través de Riesgo Online.
   * Acceso exclusivo del agente ADMIN y supervisores autorizados (OE-10, RF10).
   */
  evaluateCredit(input: CreditEvaluationInput): Promise<CreditAssessmentResult>;
}
```

---

### 1.3 Puerto de CRM (Google Sheets vía n8n) — `CrmPort`

```typescript
export enum ProspectStatus {
  NUEVO = 'NUEVO',
  EN_CONTACTO = 'EN_CONTACTO',
  CALIFICA = 'CALIFICA',
  NO_CALIFICA = 'NO_CALIFICA',
  VENTA_CERRADA = 'VENTA_CERRADA',
  PERDIDO = 'PERDIDO',
}

export interface CrmProspectRecord {
  fechaContacto: string;      // DD/MM/YYYY
  nombreApellido: string;
  telefono: string;           // Normalizado E.164
  dni?: string;
  comercio?: string;
  rubro?: string;
  localidad?: string;
  productoInteres: string;
  modalidad: 'CONTADO' | 'CUOTAS_SEMANALES';
  montoEstimado?: number;
  estado: ProspectStatus;
  dictamenCrediticio?: string;
  vendedorAsignado?: string;
  canalOrigen: 'WHATSAPP' | 'WEB' | 'LOCAL';
  ultimaInteraccion: string;
  notasSeguimiento: string;
  conversationId?: string;
}

export interface ProspectFilter {
  phone?: string;
  estado?: ProspectStatus;
  vendedorId?: string;
}

export const CRM_PORT = Symbol('CRM_PORT');

export interface CrmPort {
  /** Crea un nuevo prospecto en Google Sheets vía webhook n8n */
  createProspect(prospect: CrmProspectRecord): Promise<{ success: boolean; id?: string }>;

  /** Busca prospectos previos por teléfono para contextualizar conversaciones */
  searchProspect(phone: string): Promise<CrmProspectRecord | null>;

  /** Asienta notas de seguimiento y actualiza estado en el CRM */
  addFollowUp(phone: string, note: string, newStatus?: ProspectStatus): Promise<void>;
}
```

---

## 2. Resumen Estructurado del Agente SALES (Structured Output)

Al derivar una conversación a un vendedor humano, el agente de Ventas emite una salida estructurada mediante Gemini para completar la ficha comercial y dejar una nota interna:

```typescript
import { z } from 'zod';

export const salesHandoffSchema = z.object({
  producto: z.string().describe('Producto específico o tipo de máquina consultada'),
  precioEstimado: z.number().nullable().describe('Precio aproximado cotizado o acordado'),
  modalidad: z.enum(['CASH', 'FINANCED']).describe('Modalidad de pago consultada'),
  estadoCredito: z.string().nullable().describe('Dictamen comercial de crédito si se evaluó'),
  motivoAlerta: z.string().describe('Motivo por el que se transfiere al vendedor humano'),
  observaciones: z.string().nullable().describe('Detalles del comercio, rubro o requerimiento especial'),
});

export type SalesHandoffSummary = z.infer<typeof salesHandoffSchema>;
```

---

## 3. Modelo de Persistencia Local (Prisma ORM)

Para garantizar la degradación graceful (RNF-04) cuando n8n o Google Sheets no estén accesibles, se define la persistencia local de prospectos en PostgreSQL:

```prisma
enum ProspectSyncStatus {
  SYNCED
  PENDING
  FAILED
}

model Prospect {
  id                 String             @id @default(uuid())
  phone              String
  name               String
  dni                String?
  comercio           String?
  rubro              String?
  localidad          String?
  productInterest    String
  modality           PaymentModality    @default(CASH)
  estimatedAmount    Decimal?
  status             String             @default("NUEVO")
  creditVerdict      CreditVerdict?
  sellerId           String?
  seller             Employee?          @relation("ProspectSeller", fields: [sellerId], references: [id])
  originChannel      Channel            @default(WHATSAPP)
  conversationId     String?
  notes              String?
  syncStatus         ProspectSyncStatus @default(SYNCED)
  lastSyncedAt       DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  @@index([phone])
  @@index([status])
  @@index([sellerId])
  @@index([syncStatus])
}
```

---

## 4. DTOs para el Panel de Ventas (`src/sales/dto/`)

### 4.1 Consulta de Stock Web (`GET /sales/stock`)
- **Query**: `?query=cortadora&category=CORTADORAS`
- **Response**: `StockItem[]`

### 4.2 Verificación Crediticia Confidencial (`POST /sales/credit-check`)
- **Request Body**:
  ```json
  {
    "dni": "30123456",
    "amount": 250000
  }
  ```
- **Response**:
  ```json
  {
    "verdict": "APPROVED_WITH_CONDITIONS",
    "commercialCondition": "Aprobado con anticipo del 20% y hasta 12 cuotas semanales.",
    "evaluatedAt": "2026-10-21T14:30:00.000Z"
  }
  ```
  *(Nota: Se excluyen intencionalmente score numérico, deudas registradas y rawPayload confidencial)*.

### 4.3 Cierre de Venta Manual (`POST /sales/close`)
- **Request Body**:
  ```json
  {
    "prospectId": "uuid-prospecto",
    "purchaseRequestId": "uuid-ficha",
    "finalAmount": 240000,
    "modality": "FINANCED",
    "notes": "Cliente presentó DNI y comprobante de domicilio. Registrado en Paljet factura A-0001-00049281."
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "closedAt": "2026-10-21T14:35:00.000Z",
    "closedBy": "Vendedor Juan Pérez"
  }
  ```
