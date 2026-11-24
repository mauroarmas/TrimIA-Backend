# UI & Design System Contracts: 023 — Obsidian Precision, Responsive Móvil e Identidad Viva

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

---

## 1. Contrato de Tokens CSS (`trimIA-frontend/src/theme.css`)

Todos los componentes nuevos o actualizados DEBEN consumir estos tokens en lugar de valores hexadecimales rígidos para garantizar paridad 1:1 entre Modo Oscuro y Modo Claro.

### Superficies, Bordes y Selección

| Token | `:root` (Modo Claro) | `:root[data-theme='dark']` (Modo Oscuro) | Uso obligatorio |
| :--- | :--- | :--- | :--- |
| `--ui-bg-canvas` | `#f3f5f8` | `#090d18` | Lienzo base y fondo de barra superior móvil |
| `--ui-panel` | `#ffffff` | `#111827` | Superficie principal de `.card` / `.rc-card` |
| `--ui-panel-2` | `#f7f9fc` | `#162033` | Pistas de controles segmentados, inputs y `<select>` |
| `--ui-surface-selected` | `rgba(8, 145, 178, 0.10)` | `rgba(34, 211, 238, 0.13)` | Estado seleccionado en chips de días, presets y segmentos |
| `--ui-border-selected` | `rgba(8, 145, 178, 0.48)` | `rgba(56, 189, 248, 0.55)` | Borde activo de `1px` en selectores seleccionados |
| `--ui-specular-edge` | `inset 0 1px 0 rgba(255, 255, 255, 0.85)` | `inset 0 1px 0 rgba(255, 255, 255, 0.08)` | Borde especular superior estilo Raycast |
| `--ui-line` | `#e2e8f0` | `rgba(148, 163, 184, 0.16)` | Borde externo de tarjetas |
| `--ui-line-soft` | `#eef2f6` | `rgba(148, 163, 184, 0.09)` | Divisores internos horizontales (`1px`) sin cajas anidadas |
| `--ui-text-strong` | `#0b1324` | `#f8fafc` | Títulos y etiquetas `.rc-label` (tanto `<span>` como `<label>`) |

### Movimiento (Raycast Motion Tokens)

| Token | Valor | Regla |
| :--- | :--- | :--- |
| `--ui-ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | Indicador deslizante de intentos, drawer móvil y thumb del switch |
| `--ui-ease-snappy` | `cubic-bezier(0.16, 1, 0.3, 1)` | Hover, foco, aparición de confirmaciones y compresión táctil |
| `--ui-dur-fast` | `140ms` | Interacciones de botón/chip (`:active { transform: scale(0.98) }`) |
| `--ui-dur-spring` | `240ms` | Desplazamientos con curva spring |

**Regla de accesibilidad obligatoria**:
```css
@media (prefers-reduced-motion: reduce) {
  /* Desactivar animaciones infinitas (.sup-bot-*, .trimi-*) y transiciones largas */
}
```

---

## 2. Contrato de Componentes React

### A. `AgentRobotAvatar` (`src/components/AgentRobotAvatar.jsx`)

Componente compartido extraído de `SupervisorPanel.jsx` (exporta `AGENT_BOT_THEMES` y `AgentRobotAvatar` como default).

| Prop | Tipo | Default | Comportamiento |
| :--- | :--- | :--- | :--- |
| `agentType` | `'SALES' \| 'ADMIN' \| 'COLLECTIONS' \| 'LOGISTICS' \| 'DEPOSITS'` | `'SALES'` | Selecciona tema cromático y símbolo de pecho. |
| `label` | `string` | `undefined` | `aria-label` cuando no es decorativo (`size !== 'lg'`). |
| `size` | `'card' \| 'lg' \| 'sm'` | `'card'` | `'card'`: `96×98` (tarjetas supervisor); `'lg'`: `50×50` (modal supervisor); `'sm'`: `40×40` (emblema compacto en cabecera de `ReminderConfig`, siempre `<= 44px`). |
| `paused` | `boolean` | `false` | Cuando `true`, agrega clase `.is-paused` que atenúa la antena y pausa la animación de flotación para reflejar envíos detenidos. |

### B. `ReminderConfig` (`src/components/ReminderConfig.jsx`)

| Prop | Tipo | Contrato |
| :--- | :--- | :--- |
| `token` | `string` | Token JWT de sesión existente para `getReminderConfig(token)` y `updateReminderConfig(token, payload)`. |

**Invariantes de interfaz y accesibilidad**:
- Mantiene los IDs accesibles `#reminder-days`, `#reminder-attempts`, `#reminder-template` y la semántica `role="group"`, `role="radiogroup"`, `role="radio"`, `aria-pressed`, `aria-checked`, `role="alert"`.
- Payload enviado a `PUT /collections/reminder-config` **idéntico al contrato actual**: `{ daysBefore: number[], maxAttempts: number, templateName: string, templateApproved: boolean }`.
- Botón submit (`button[type="submit"]`): `disabled={busy || !isDirty}`. Solo lleva estilo primario brillante cuando `isDirty === true` y `!busy`.
- Presencia de identidad:
  - Cabecera: `<AgentRobotAvatar agentType="COLLECTIONS" size="sm" paused={!draft.templateApproved} />`.
  - Resumen de cadencia / confirmación: `<Trimi variant="avatar" size={32} mood={saved ? 'festeja' : 'piensa'} />`.

### C. Shell Móvil (`src/App.jsx`)

- Renderiza `.mobile-topbar` (visible únicamente en `@media (max-width: 768px)`) con:
  - Botón hamburguesa (`aria-label="Abrir menú"`, `aria-expanded={mobileMenuOpen}`, `aria-controls="app-sidebar-nav"`).
  - Logotipo compacto TrimIA.
  - Botón rápido de alternancia de tema (Modo Oscuro / Modo Claro).
- Renderiza `.mobile-sidebar-backdrop` cuando `mobileMenuOpen === true`, cerrando el drawer al hacer clic.
- Agrega clase `mobile-menu-open` a `.app-layout` cuando `mobileMenuOpen === true`.

---

## 3. Contrato Responsive por Breakpoint

| Breakpoint | Shell / Sidebar | Sub-pestañas Cobranzas | Chips de días (`9`) | Presets (`4`) | Intentos (`5`) | Toggle aprobación |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Desktop (`> 900px`)** | Sidebar fijo (`284px` / `72px`) | Fila alineada al contenedor | 1 fila × 9 cols (`30d`..`Hoy (0)`) | Fila inline compacta en cabecera | 1 fila × 5 cols con thumb deslizante | Título + desc izquierda, switch derecha |
| **Tablet (`769px–900px`)** | Sidebar fijo / colapsable | Scroll horizontal si excede | Grilla `3×3` | Fila wrap compacta | 1 fila × 5 cols | 2 columnas |
| **Mobile (`<= 768px`, `360–430px`)** | Drawer *off-canvas* + `.mobile-topbar` (`52px`); `main` al 100% del ancho (`overflow-x: hidden`) | 100% ancho, scroll horizontal + `scroll-snap` + fade derecho | Grilla `3×3` (3 filas, targets `>= 38px`) | Grilla `2×2` | **Siempre 1 fila × 5 cols** (`>= 40px` alto) | Fila superior: título + switch; inferior: descripción 100% ancho |

---

## 4. Contrato Backend (Sin Cambios)

- `GET /collections/reminder-config` → `{ daysBefore: number[], maxAttempts: number, templateName: string, templateApproved: boolean, updatedAt: string }`
- `PUT /collections/reminder-config` → valida `UpdateReminderConfigDto` (`daysBefore` enteros únicos `0..30`, `maxAttempts >= 1`, `templateName` no vacío, `templateApproved` booleano).
