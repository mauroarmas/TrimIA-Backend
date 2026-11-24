# Research & Technical Decisions: 023 — Evolución Visual "Obsidian Precision", Responsive Móvil e Identidad Viva

**Feature**: [spec.md](./spec.md) · **Date**: 2026-11-23 · **Target Repo**: `../trimIA-frontend` (React 19 + Vite 8 + CSS nativo)

---

## 1. Estrategia de tokens visuales y sinergia Modo Oscuro ↔ Modo Claro

- **Decision**: Extender la capa unificada `src/theme.css` (cargada al final en `src/main.jsx`) con tokens gemelos en `:root` y `:root[data-theme='dark']` para superficies seleccionadas (`--ui-surface-selected`, `--ui-border-selected`, `--ui-specular-edge`), divisores finos (`--ui-line-soft`), lienzo (`--ui-bg-canvas`) y curvas de movimiento estilo Raycast (`--ui-ease-spring`, `--ui-ease-snappy`, `--ui-dur-fast`, `--ui-dur-spring`).
- **Rationale**: `src/theme.css` ya funciona como fuente única de verdad con prefijo `:root:root` para ganar especificidad sobre las reglas legadas de `src/index.css`. Definir allí los tokens de selección y movimiento garantiza paridad exacta entre modo oscuro y claro sin introducir colores rígidos en componentes ni romper otras pantallas del panel.
- **Alternatives considered**:
  - *Introducir Tailwind CSS o una librería UI (Radix/shadcn)*: Descartado por estar fuera de alcance y porque el proyecto usa CSS puro liviano (`345 kB` totales) sin PostCSS/Tailwind.
  - *Crear reglas `[data-theme='dark']` duplicadas en cada archivo `.css` de componente*: Descartado porque genera deriva entre ambos modos (justamente lo que causó alertas claras sobre fondo oscuro).

---

## 2. Disciplina de acento único y corrección de conflictos de especificidad CSS

- **Decision**:
  1. Reservar `--ui-primary-grad` y `--ui-primary-glow` dentro de `ReminderConfig` **exclusivamente** para el botón `button.primary.rc-save-btn` cuando `isDirty === true`.
  2. Cambiar el estado seleccionado de presets, chips de días y segmento activo de intentos a `--ui-surface-selected` + `--ui-border-selected` + `--ui-specular-edge`, con un indicador deslizante (*sliding thumb*) CSS en el control segmentado de intentos.
  3. Reemplazar el anidamiento de 4 sub-tarjetas `.rc-section` con fondo/borde propio por filas separadas con `border-top: 1px solid var(--ui-line-soft)` directamente dentro de `.rc-card`.
  4. Asegurar alta especificidad en `.collections-panel .rc-label` (incluyendo `label.rc-label`) para que no sea pisada por reglas heredadas de `label` en `index.css`/`theme.css`, y estilizar `select.rc-select` con `appearance: none` + chevron SVG embebido en data URI usando `currentColor`/tokens.
- **Rationale**: Resuelve de raíz los 7 hallazgos de la auditoría en `1366×649`: elimina el ruido de 6 gradientes compitiendo, iguala el color de `"Plantilla de WhatsApp"` con `"Máximo de intentos"`, quita 2 capas de cajas anidadas y recorta más de `180px` de altura vertical de la tarjeta.
- **Alternatives considered**:
  - *Reemplazar `<select>` por un menú desplegable custom en JS*: Descartado por complejidad innecesaria en accesibilidad móvil (en iOS/Android el picker nativo activado por un `<select>` estilizado con `appearance: none` es más cómodo, accesible por teclado y cero dependencias).

---

## 3. Detección de estado modificado (*Dirty State*) en `ReminderConfig`

- **Decision**: Conservar en `ReminderConfig.jsx` el último snapshot persistido (`savedConfig`, normalizado con `daysBefore` ordenado descendente, `maxAttempts` entero, `templateName` recortado y `templateApproved` booleano) y derivar `isDirty` comparando el borrador actual contra `savedConfig`. El botón `"Guardar configuración"` recibe `disabled={busy || !isDirty}` y clase condicional `is-dirty`.
- **Rationale**: Evita el estado "mentiroso" *always-on*, vuelve inmediatamente a estado neutro si el usuario revierte manualmente su cambio, y permite que el CTA primario solo brille cuando realmente hay algo que guardar.
- **Alternatives considered**:
  - *Flag booleano `hasEdited` que pasa a `true` en cualquier `onChange`*: Descartado porque si el usuario cambia `3 → 4 → 3`, seguiría marcando cambios pendientes inexistentes (incumpliendo el caso borde de reversión manual).

---

## 4. Navegación móvil *off-canvas drawer* (`<= 768px`)

- **Decision**: Añadir estado `mobileMenuOpen` en `src/App.jsx`, una barra superior compacta `.mobile-topbar` (`52px`, visible solo en `<= 768px`) con botón hamburguesa, logo TrimIA y toggle rápido de tema, y un backdrop `.mobile-sidebar-backdrop` al abrir el menú. En `@media (max-width: 768px)`:
  - `.app-sidebar` pasa a `position: fixed; inset: 0 auto 0 0; width: min(296px, 84vw); transform: translateX(-100%)` con transición `transform var(--ui-dur-spring) var(--ui-ease-spring)` y pasa a `translateX(0)` cuando `.app-layout.mobile-menu-open`.
  - `.app-main` recibe `margin-left: 0; padding: 14px 16px 24px` (devolviendo 100% del ancho útil) y el botón `.sidebar-toggle` de escritorio se oculta en móvil.
  - Al elegir una pestaña (`selectTab`), pulsar `Escape`, hacer click en el backdrop o pasar el viewport por encima de `768px` (`matchMedia`), `mobileMenuOpen` vuelve a `false`.
- **Rationale**: En la inspección real en Chrome a `390×844`, `.app-sidebar` fijo aplastaba `main.app-main` en una tira de `50px` y el rail colapsado robaba >30% del ancho. El *drawer off-canvas* arregla toda la app móvil de una sola vez sin alterar el comportamiento desktop (`> 768px`).
- **Alternatives considered**:
  - *Barra inferior fija (Bottom Tab Bar)*: Descartado porque Diego Bazán tiene hasta 10 pestañas en el menú, lo cual no entra en una bottom bar de 4–5 ítems sin meter igualmente un menú "Más".

---

## 5. Carrusel horizontal de sub-pestañas y grillas responsivas en Cobranzas

- **Decision**:
  - En `<= 768px`, `.collections-panel .collections-tabs` ocupa `100%` del ancho con `.submenu-pills` en `display: flex; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none` y un degradado lateral sutil (`mask-image`) en el borde derecho cuando hay más ítems desplazables.
  - En `ReminderConfig.css`:
    - Grilla de días (`.rc-day-grid`): `grid-template-columns: repeat(9, minmax(0, 1fr))` en escritorio (`> 900px`) y `repeat(3, minmax(0, 1fr))` en tablets/teléfonos (`<= 900px`) con etiquetas cortas (`30d`, `15d`, `10d`, `7d`, `5d`, `3d`, `2d`, `1d`, `Hoy (0)`).
    - Presets rápidos (`.rc-presets-grid`): fila compacta inline en escritorio y grilla `2×2` en teléfonos (`<= 640px`).
    - Control segmentado `"Máximo de intentos"` (`.rc-segments`): `grid-template-columns: repeat(5, minmax(0, 1fr))` en todos los viewports (o `repeat(var(--rc-seg-count, 5), minmax(0, 1fr))` si existiera un valor custom heredado), garantizando siempre 1 sola fila horizontal incluso en `360px`.
    - Bloque de aprobación (`.rc-toggle-card`): en `<= 640px` la cabecera (título + badge + switch) va en una fila superior y la descripción debajo a ancho completo.
- **Rationale**: Garantiza 0 desborde horizontal (`scrollWidth <= innerWidth`), targets táctiles cómodos (`>= 38px–40px`) y elimina los 4 quiebres observados en Chrome móvil.
- **Alternatives considered**:
  - *Convertir las sub-pestañas de Cobranzas en un `<select>` en móvil*: Descartado porque oculta la navegación contextual y rompe los selectores existentes `.collections-tabs button.submenu-pill`.

---

## 6. Extracción de `AgentRobotAvatar` e integración sutil de `Trimi`

- **Decision**:
  1. Extraer `AGENT_BOT_THEMES` y `AgentRobotAvatar` desde `src/components/SupervisorPanel.jsx` hacia un nuevo componente compartido `src/components/AgentRobotAvatar.jsx`, agregando soporte para tamaño compacto (`size="sm"` -> `40px`) y estado visual (`paused` opcional que atenúa sutilmente el brillo de antena y pausa la flotación si los envíos están pausados).
  2. Reutilizar `AgentRobotAvatar` (`agentType="COLLECTIONS"`, `size="sm"`) en la cabecera de `ReminderConfig.jsx` junto al título, reflejando el estado vivo del bot ejecutor de recordatorios.
  3. Integrar `Trimi` (`src/components/Trimi.jsx`) con `variant="avatar"` y `size={32}` en la línea de resumen contextual de cadencia (`mood="piensa"` / `outfit="consejo"`) y en el aviso de guardado exitoso (`mood="festeja"` / `outfit="felicitaciones"`).
  4. Garantizar reglas `@media (prefers-reduced-motion: reduce)` tanto para `.sup-bot-*` como para `.trimi-*` y las transiciones `.rc-*`.
- **Rationale**: Reutiliza al 100% los activos SVG oficiales del sistema sin duplicar código, mantiene las apariciones en un rango discreto (`32px–40px`, siempre `<= 44px`), y da sentido funcional a cada personaje (el robot representa el automatismo de Cobranzas; Trimi explica la cadencia y celebra el guardado).
- **Alternatives considered**:
  - *Mostrar a Trimi de cuerpo entero (`100px+`) en la tarjeta*: Descartado porque rompería la estética sobria *Obsidian Precision* y desperdiciaría espacio vertical valioso.

---

## 7. Semántica honesta en KPIs de Cobranzas

- **Decision**: En `CollectionsPanel.jsx`, añadir clase condicional `is-zero` a las tarjetas KPI cuando su valor es `0`, y `is-static` a la tercera tarjeta (`<div>` no clickeable). En `collectionsPanel.css` / `theme.css`, `.collection-metric.is-zero` atenúa `--k` a `--ui-slate` (neutro) y `.collection-metric.is-static` desactiva la elevación/glow de hover reservada a tarjetas interactivas `<button>`.
- **Rationale**: Evita falsos positivos visuales (violeta de alerta o verde de logro cuando el contador es `0`) y deja claro qué tarjetas navegan a otra pestaña y cuál es solo informativa.
- **Alternatives considered**:
  - *Ocultar los KPIs cuando está abierta la pestaña de configuración*: Descartado por consistencia con las otras 4 sub-pestañas del Panel de Cobranzas y para no introducir cambios estructurales extremos.
