# Data Model (UI State & View-Models): 023 — Obsidian Precision, Responsive Móvil e Identidad Viva

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

> Esta feature no crea ni modifica tablas de PostgreSQL/Prisma ni DTOs del backend. El modelo siguiente describe las entidades de estado en memoria del frontend, sus invariantes y transiciones.

---

## 1. `ReminderConfigRecord` (Contrato existente del servidor — Solo lectura/escritura vía API actual)

Representa la fila única de configuración retornada por `GET /collections/reminder-config` y actualizada por `PUT /collections/reminder-config`.

| Campo | Tipo | Reglas / Invariantes |
| :--- | :--- | :--- |
| `daysBefore` | `number[]` | Enteros únicos entre `0` y `30`, al menos 1 elemento. Normalizado siempre en orden descendente (ej. `[7, 3, 0]`). |
| `maxAttempts` | `number` | Entero `>= 1` (selector estándar `1..5`, preservando cualquier valor `> 5` existente). |
| `templateName` | `string` | Cadena no vacía recortada (`trim()`). Catálogo estándar + fallback dinámico si viene una plantilla personalizada. |
| `templateApproved` | `boolean` | Define si el procesador de recordatorios puede enviar mensajes automáticos por WhatsApp. |
| `updatedAt` | `string (ISO-8601)` | Marca temporal de la última actualización confirmada en servidor. |

---

## 2. `ReminderEditorState` (Estado local de `ReminderConfig.jsx`)

| Campo | Tipo | Descripción y Derivación |
| :--- | :--- | :--- |
| `savedConfig` | `ReminderConfigRecord \| null` | Último estado confirmado recibido del backend (en carga inicial o tras `PUT` exitoso). |
| `draft` | `{ daysBefore: number[], maxAttempts: number, templateName: string, templateApproved: boolean } \| null` | Valores actualmente seleccionados en la interfaz. |
| `isDirty` *(derivado)* | `boolean` | `true` si y solo si difiere al menos un campo normalizado entre `draft` y `savedConfig`: `!sameDays(draft.daysBefore, savedConfig.daysBefore) \|\| Number(draft.maxAttempts) !== Number(savedConfig.maxAttempts) \|\| draft.templateName.trim() !== savedConfig.templateName.trim() \|\| Boolean(draft.templateApproved) !== Boolean(savedConfig.templateApproved)`. |
| `busy` | `boolean` | Bloquea reenvíos concurrentes durante `PUT /collections/reminder-config`. |
| `saved` | `boolean` | `true` tras guardado exitoso; se limpia a `false` en cuanto el usuario edita cualquier control. |
| `error` | `string` | Mensaje de error de carga o guardado; se limpia al editar o reintentar. |

### Transiciones de estado del formulario

```text
[LOADING] --(GET ok)--> [CLEAN (isDirty=false, CTA disabled)]
[CLEAN]   --(editar valor distinto)--> [DIRTY (isDirty=true, CTA primary active)]
[DIRTY]   --(revertir al valor original)--> [CLEAN (isDirty=false, CTA disabled)]
[DIRTY]   --(submit)--> [SAVING (busy=true)]
[SAVING]  --(PUT ok)--> [SAVED_CLEAN (savedConfig=updated, isDirty=false, saved=true, Trimi=festeja)]
[SAVING]  --(PUT error)--> [DIRTY_ERROR (error!=empty, draft preservado, CTA reintentable)]
```

---

## 3. `AutomationVisualState` (Derivado para `AgentRobotAvatar` + Bloque de aprobación + `Trimi`)

| Condición | Estado del Robot (`COLLECTIONS`) | Estado de `Trimi` (`variant="avatar"`) | Estado del Bloque de Aprobación |
| :--- | :--- | :--- | :--- |
| `draft.templateApproved === true` y `!saved` | `paused={false}` (flotación sutil + badge esmeralda `"Envíos activos"`) | `mood="piensa"` (`outfit="consejo"`) junto al resumen de cadencia | Interruptor encendido + tono esmeralda sutil |
| `draft.templateApproved === false` y `!saved` | `paused={true}` (antena en reposo + badge ámbar `"Envíos pausados"`) | `mood="piensa"` (`outfit="consejo"`) junto al resumen de cadencia | Interruptor apagado + aviso contextual único en tono ámbar |
| `saved === true` | Refleja `draft.templateApproved` | `mood="festeja"` (`outfit="felicitaciones"`) en la confirmación de guardado | Confirmación persistida |

---

## 4. `MobileShellState` (Estado de navegación móvil en `App.jsx`)

| Campo | Tipo | Reglas / Transiciones |
| :--- | :--- | :--- |
| `mobileMenuOpen` | `boolean` | Inicialmente `false`. Solo tiene efecto visual en `<= 768px`. |
| `theme` | `'light' \| 'dark'` | Persistido en `localStorage['trimia:theme']` y reflejado en `document.documentElement.dataset.theme`. Accesible desde el sidebar y desde `.mobile-topbar`. |

**Reglas de cierre automático de `mobileMenuOpen`**:
- Al ejecutar `selectTab(nextTabId)` -> `setMobileMenuOpen(false)`.
- Al presionar tecla `Escape` con `mobileMenuOpen === true` -> `setMobileMenuOpen(false)`.
- Al hacer clic sobre `.mobile-sidebar-backdrop` -> `setMobileMenuOpen(false)`.
- Cuando `window.matchMedia('(min-width: 769px)')` cambia a `matches === true` -> `setMobileMenuOpen(false)`.

---

## 5. `KpiTileState` (Tarjetas KPI en `CollectionsPanel.jsx`)

| Tarjeta | Valor | Interactividad | Clase semántica cuando `valor === 0` | Clase semántica cuando `valor > 0` |
| :--- | :--- | :--- | :--- | :--- |
| Cuotas pendientes | `kpis.clientsWithPendingQuotas` | `<button>` (navega a `clients`) | `.is-zero` (tono `--ui-slate`) | Acento `--ui-cyan` |
| Comprobantes para revisar | `kpis.proofsToReview` | `<button>` (navega a `proofs`) | `.is-zero` (tono `--ui-slate`) | Acento `--ui-amber` / atención |
| Pagos confirmados esta semana | `kpis.confirmedThisWeek` | `<div>` (`.is-static`, no clickeable) | `.is-zero.is-static` (tono `--ui-slate`, sin hover de botón) | `.is-static` (acento `--ui-emerald`, sin hover de botón) |
