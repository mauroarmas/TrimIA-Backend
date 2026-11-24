# Tasks: 023 — Evolución Visual "Obsidian Precision", Responsive Móvil e Identidad Viva

**Input**: Design documents from `/specs/023-ui-obsidian-responsive/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/ui-contracts.md`, `quickstart.md`

**Tests**: No se generan tareas de tests unitarios automáticos (el frontend hermano `../trimIA-frontend` no usa runner de tests unitarios según `CLAUDE.md`); la verificación se ejecuta mediante `oxlint`, `vite build` y validación visual/interactiva en Chrome DevTools según `quickstart.md`.

**Organization**: Tareas agrupadas por historia de usuario (`US1` a `US4`) para permitir implementación y validación incremental independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Ejecutable en paralelo (archivos distintos, sin dependencia de tareas incompletas).
- **[Story]**: Historia de usuario a la que pertenece (`[US1]`, `[US2]`, `[US3]`, `[US4]`).
- **Path Conventions**: Todos los archivos de código pertenecen al repositorio hermano `../trimIA-frontend/src/...` (ruta absoluta `/home/mauro/Proyectos/trimIA-frontend/src/...`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verificar el estado base del repositorio frontend hermano antes de aplicar cambios.

- [X] T001 Verify clean lint and production build baseline (`npx oxlint` and `VITE_SAME_ORIGIN=true npm run build`) in `../trimIA-frontend/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Definir la capa central de tokens Obsidian Precision (Modo Claro y Modo Oscuro en sinergia 1:1) y las curvas de movimiento Raycast que consumen todas las historias de usuario.

**⚠️ CRITICAL**: Completar esta fase antes de iniciar `US1`–`US4`.

- [X] T002 Add twin Obsidian Precision design tokens (`--ui-bg-canvas`, `--ui-panel`, `--ui-panel-2`, `--ui-surface-selected`, `--ui-border-selected`, `--ui-specular-edge`, `--ui-line`, `--ui-line-soft`, `--ui-text-strong`) for both `:root` (light) and `:root[data-theme='dark']` (dark) per `contracts/ui-contracts.md` in `../trimIA-frontend/src/theme.css`
- [X] T003 Add Raycast motion tokens (`--ui-ease-spring: cubic-bezier(0.22, 1, 0.36, 1)`, `--ui-ease-snappy: cubic-bezier(0.16, 1, 0.3, 1)`, `--ui-dur-fast: 140ms`, `--ui-dur-spring: 240ms`) and global `@media (prefers-reduced-motion: reduce)` guards in `../trimIA-frontend/src/theme.css`
- [X] T004 [P] Add `@media (prefers-reduced-motion: reduce)` animation pause rules for `.sup-bot-float`, `.sup-bot-shadow`, `.sup-bot-eyes`, `.sup-bot-ant`, and `.sup-bot-arm` in `../trimIA-frontend/src/index.css`

**Checkpoint**: Tokens globales y reglas de movimiento reducido listos — las historias de usuario pueden comenzar.

---

## Phase 3: User Story 1 — Configurar recordatorios con jerarquía clara y estado honesto en escritorio (Priority: P1) 🎯 MVP

**Goal**: Eliminar la fatiga de gradientes repetidos, aplanar el anidamiento de sub-tarjetas ("Muñeca Rusa"), unificar la tipografía de etiquetas, añadir *dirty state* real al CTA de guardado y corregir la semántica cromática de los KPIs en cero.

**Independent Test**: Abrir `/panel/cobranzas/configuracion-recordatorios` en escritorio `1366×649` (Modo Oscuro y Modo Claro); verificar botón `"Guardar configuración"` deshabilitado al inicio y encendido solo al editar, 9 días en 1 fila, etiquetas iguales y KPIs en `0` con tono neutro.

### Implementation for User Story 1

- [X] T005 [US1] Refactor state management in `../trimIA-frontend/src/components/ReminderConfig.jsx` to store `savedConfig` alongside editable `draft` and compute normalized `isDirty` (`!sameDays`, `maxAttempts`, `templateName.trim()`, `templateApproved`) so `button[type="submit"]` is `disabled={busy || !isDirty}`
- [X] T006 [US1] Consolidate the WhatsApp approval warning into a single unified approval block linked to the toggle switch (removing the duplicate top amber banner) and update day chip labels to concise tabular format (`30d`, `15d`, `10d`, `7d`, `5d`, `3d`, `2d`, `1d`, `Hoy (0)`) in `../trimIA-frontend/src/components/ReminderConfig.jsx`
- [X] T007 [US1] Flatten `.rc-card` layout in `../trimIA-frontend/src/components/ReminderConfig.css` by replacing boxed `.rc-section` sub-cards with `1px solid var(--ui-line-soft)` horizontal dividers, reserving `--ui-primary-grad` exclusively for `.rc-save-btn.is-dirty`, and applying `--ui-surface-selected` + `--ui-border-selected` + `--ui-specular-edge` to selected presets, day chips, and attempt segments
- [X] T008 [US1] Fix label specificity (`.collections-panel .rc-label`, including `label.rc-label`), implement 9-column desktop day grid (`repeat(9, minmax(0, 1fr))`), style `select.rc-select` with `appearance: none` + custom SVG chevron, and add sliding active thumb indicator to `.rc-segments` in `../trimIA-frontend/src/components/ReminderConfig.css`
- [X] T009 [P] [US1] Add conditional `is-zero` class when KPI count equals `0` and `is-static` class on the non-interactive confirmed-payments card in `../trimIA-frontend/src/components/CollectionsPanel.jsx`
- [X] T010 [P] [US1] Style `.collection-metric.is-zero` with neutral `--ui-slate` accent and disable interactive hover elevation on `.collection-metric.is-static` in `../trimIA-frontend/src/components/collectionsPanel.css`

**Checkpoint**: User Story 1 (MVP) completamente funcional y verificable en escritorio `1366×649`.

---

## Phase 4: User Story 2 — Operar el panel y configurar recordatorios cómodamente desde un teléfono móvil (Priority: P1)

**Goal**: Convertir la navegación lateral en un cajón *off-canvas* en `<= 768px` con barra superior compacta, hacer las sub-pestañas deslizables con indicador visual y adaptar todas las grillas del formulario de recordatorios a pantallas de `360px` y `390px` sin desborde horizontal.

**Independent Test**: Emular `390×844` y `360×800` en Chrome DevTools; verificar sidebar oculto por defecto, apertura/cierre fluido del drawer, `scrollWidth <= innerWidth`, sub-pestañas deslizables, chips de días en 3×3, intentos en 1 fila de 5 columnas y `<select>` sin truncamiento prematuro.

### Implementation for User Story 2

- [X] T011 [US2] Add `mobileMenuOpen` state, `Escape` key handler, `matchMedia('(min-width: 769px)')` auto-close listener, auto-close on `selectTab()`, `.mobile-topbar` (`<= 56px` with menu button, compact TrimIA logo, and theme toggle), and `.mobile-sidebar-backdrop` in `../trimIA-frontend/src/App.jsx`
- [X] T012 [US2] Add `@media (max-width: 768px)` off-canvas drawer styles (`.app-sidebar` hidden via `translateX(-100%)` and opened via `.app-layout.mobile-menu-open`, `.app-main` with `margin-left: 0` and `padding: 14px 16px 24px`, hidden desktop `.sidebar-toggle`) in `../trimIA-frontend/src/theme.css`
- [X] T013 [P] [US2] Update `.collections-tabs` and `.submenu-pills` for mobile (`<= 768px`) to span 100% width with smooth horizontal scrolling (`scroll-snap-type: x proximity`) and subtle right-edge fade mask indicating additional tabs in `../trimIA-frontend/src/components/collectionsPanel.css`
- [X] T014 [P] [US2] Add responsive mobile rules (`<= 900px` and `<= 640px`) for 3×3 day chips grid (`repeat(3, minmax(0, 1fr))`), 2×2 quick presets grid, locked 5-column horizontal attempts row (`repeat(5, minmax(0, 1fr))`, min-height `40px`), full-width template select, and stacked approval toggle header+description in `../trimIA-frontend/src/components/ReminderConfig.css`

**Checkpoint**: User Stories 1 y 2 operables sin desborde horizontal en escritorio y teléfonos (`360px` y `390px`).

---

## Phase 5: User Story 3 — Sinergia simétrica entre Modo Oscuro y Modo Claro con micro-interacciones fluidas (Priority: P2)

**Goal**: Garantizar paridad visual AA (`>= 4.5:1`) al alternar Modo Oscuro y Modo Claro y pulir las micro-interacciones Raycast (compresión táctil `scale(0.98)`, brillo especular de `1px`, transición suave al entrar a la pestaña y respeto estricto a `prefers-reduced-motion`).

**Independent Test**: Alternar Modo Oscuro ↔ Modo Claro en escritorio y móvil sobre `/panel/cobranzas/configuracion-recordatorios` verificando contraste en todos los estados y respuesta táctil fluida en chips, segmentos y switch.

### Implementation for User Story 3

- [X] T015 [US3] Add Raycast-style tactile press (`:active { transform: scale(0.98) }`), specular edge highlights (`var(--ui-specular-edge)`), subtle tab-entry fade-up (`4px`, `180ms`), and `@media (prefers-reduced-motion: reduce)` overrides in `../trimIA-frontend/src/components/ReminderConfig.css`
- [X] T016 [US3] Audit and harmonize dark/light surface, border, chevron, focus ring, and badge contrast rules for `.mobile-topbar`, `.rc-card`, `.rc-select`, and `.collection-metric` in `../trimIA-frontend/src/theme.css`

**Checkpoint**: Sinergia Modo Oscuro / Modo Claro y micro-interacciones verificadas sin regresiones.

---

## Phase 6: User Story 4 — Presencia sutil y contextual de robots animados y mascota Trimi (Priority: P3)

**Goal**: Extraer `AgentRobotAvatar` a un componente compartido e integrar discretamente el robot animado de Cobranzas (`<= 44px`) en la cabecera de Configuración de Recordatorios y el mini-avatar de `Trimi` (`<= 36px`) en el resumen de cadencia y confirmación de guardado.

**Independent Test**: Revisar Configuración de Recordatorios en estado pausado, activo y recién guardado; confirmar que el robot de Cobranzas (`40px`) refleja el estado `paused`, que `Trimi` (`32px`) cambia de `piensa` a `festeja` al guardar, y que `SupervisorPanel` sigue mostrando los robots sin regresión.

### Implementation for User Story 4

- [X] T017 [P] [US4] Extract `AGENT_BOT_THEMES` and `AgentRobotAvatar` into shared component supporting `size="card" | "lg" | "sm"` (`40×40` for `"sm"`) and `paused` prop in `../trimIA-frontend/src/components/AgentRobotAvatar.jsx`
- [X] T018 [US4] Replace inline `AGENT_BOT_THEMES` and `AgentRobotAvatar` definitions with import from `./AgentRobotAvatar` in `../trimIA-frontend/src/components/SupervisorPanel.jsx`
- [X] T019 [US4] Integrate `<AgentRobotAvatar agentType="COLLECTIONS" size="sm" paused={!draft.templateApproved} />` in the card header and `<Trimi variant="avatar" size={32} mood={saved ? 'festeja' : 'piensa'} />` in the cadence summary / saved confirmation bar in `../trimIA-frontend/src/components/ReminderConfig.jsx`
- [X] T020 [US4] Add compact wrapper styles for the header robot badge (`.rc-bot-emblem`, `.is-paused` muted antenna/paused float) and inline Trimi summary slot (`.rc-trimi-summary`) in `../trimIA-frontend/src/components/ReminderConfig.css`

**Checkpoint**: Todas las historias de usuario (`US1`–`US4`) integradas e independientemente verificables.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verificación integral de calidad estática, build y validación visual real en navegador según `quickstart.md`.

- [X] T021 Run `npx oxlint` on all modified frontend files and `VITE_SAME_ORIGIN=true npm run build` in `../trimIA-frontend`
- [X] T022 Execute full `quickstart.md` visual & interactive validation in Chrome DevTools across Desktop `1366×649` (Dark + Light), Mobile `390×844` and `360×800`, Dirty State transitions, Robot/Trimi states, and `prefers-reduced-motion: reduce`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — inicia de inmediato.
- **Foundational (Phase 2)**: Depende de Phase 1 — **bloquea** `US1`–`US4`.
- **User Story 1 (Phase 3, P1 — MVP)**: Depende de Phase 2.
- **User Story 2 (Phase 4, P1)**: Depende de Phase 2; se beneficia de que `T007`/`T008` hayan aplanado `ReminderConfig.css` antes de `T014`.
- **User Story 3 (Phase 5, P2)**: Depende de `US1` y `US2` para pulir el contraste y motion sobre todos los controles ya maquetados.
- **User Story 4 (Phase 6, P3)**: `T017` y `T018` pueden correr en paralelo tras Phase 2; `T019`/`T020` integran sobre `ReminderConfig.jsx`/`.css` tras `US1`.
- **Polish (Phase 7)**: Depende de la finalización de todas las historias anteriores.

### Parallel Opportunities

```bash
# Phase 2 (parallelizable):
T002 + T003 (theme.css) || T004 (index.css)

# Phase 3 (US1 parallelizable):
T005 -> T006 (ReminderConfig.jsx) || T009 (CollectionsPanel.jsx) || T010 (collectionsPanel.css)

# Phase 4 (US2 parallelizable):
T011 (App.jsx) -> T012 (theme.css) || T013 (collectionsPanel.css) || T014 (ReminderConfig.css)

# Phase 6 (US4 parallelizable):
T017 (AgentRobotAvatar.jsx) -> T018 (SupervisorPanel.jsx) || T019 (ReminderConfig.jsx)
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2)
1. Completar **Phase 1 + Phase 2** (tokens Obsidian Precision + Raycast motion).
2. Completar **Phase 3 (US1)** para resolver los 7 defectos de dirección de arte en escritorio.
3. Completar **Phase 4 (US2)** para desbloquear el uso móvil real (`360px`–`390px`).
4. Completar **Phase 5 (US3)** y **Phase 6 (US4)** para cerrar sinergia Dark/Light, micro-interacciones y presencia sutil de `AgentRobotAvatar` + `Trimi`.
5. Validar todo con **Phase 7 (`oxlint`, `vite build` y Chrome DevTools)**.
