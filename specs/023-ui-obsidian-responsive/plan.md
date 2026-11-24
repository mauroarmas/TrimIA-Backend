# Implementation Plan: 023 — Evolución Visual "Obsidian Precision", Responsive Móvil e Identidad Viva

**Branch**: `023-ui-obsidian-responsive` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-ui-obsidian-responsive/spec.md`

## Summary

Evolucionar visual y estructuralmente el panel web de **TrimIA** (`../trimIA-frontend`) bajo la dirección **Obsidian Precision** (Linear + Raycast) manteniendo la esencia cromática azul/cian y sinergia 1:1 entre Modo Oscuro y Modo Claro, corregir de raíz el layout responsive en teléfonos (`<= 768px`) mediante un cajón lateral *off-canvas* y grillas adaptativas, introducir estado honesto (*dirty state*) y jerarquía limpia en **Configuración de Recordatorios** y KPIs de **Cobranzas**, e integrar de forma medida los activos vectoriales oficiales (`AgentRobotAvatar` extraído a componente compartido y mini-avatar de `Trimi`). No se modifica ningún endpoint ni esquema del backend NestJS/Prisma.

## Technical Context

**Language/Version**: JavaScript (ES2022+ JSX sin TypeScript) sobre Node.js 20+ (frontend Vite 8 / React 19.2.8); documentación y contratos en el repo principal `trimIA`.  
**Primary Dependencies**: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `oxlint` (cero librerías UI/animación externas).  
**Storage**: N/A para persistencia nueva (consume los endpoints existentes `GET /collections/reminder-config` y `PUT /collections/reminder-config` del backend NestJS; `localStorage` ya persiste `trimia:theme`).  
**Testing**: Verificación estática con `oxlint` (`npx oxlint`), build de producción (`VITE_SAME_ORIGIN=true npm run build`) y auditoría visual/interactiva en navegador real (Chrome DevTools) en Desktop `1366×649` (Dark/Light) y Mobile `390×844` / `360×800`, más actualización opcional de pruebas E2E Cypress existentes (`02-cobranzas.cy.js`).  
**Target Platform**: Navegadores modernos de escritorio y teléfonos móviles (Chrome, Safari, Edge, Firefox) desde `360px` hasta `1920px+`.  
**Project Type**: Aplicación web SPA (frontend React hermano `../trimIA-frontend` acoplado al backend `trimIA`).  
**Performance Goals**: Transiciones de interfaz fluidas a 60 fps (`140ms–240ms`, solo `transform`/`opacity`/`box-shadow`), respuesta inmediata al cambiar selectores (`< 100ms`), cero incremento apreciable en tamaño de bundle (sin dependencias nuevas).  
**Constraints**: Cero cambios en el backend NestJS/Prisma; paridad AA (`>= 4.5:1`) entre Modo Oscuro y Modo Claro; cero desborde horizontal (`scrollWidth <= innerWidth`) en `360×800` y `390×844`; respeto estricto a `@media (prefers-reduced-motion: reduce)`; altura de personajes animados `<= 44px` en la tarjeta de recordatorios.  
**Scale/Scope**: 1 capa global de tokens (`theme.css`), 1 shell responsive móvil (`App.jsx` + `index.css`/`theme.css`), 1 componente compartido extraído (`AgentRobotAvatar.jsx`), 2 vistas actualizadas (`CollectionsPanel.jsx` y `ReminderConfig.jsx` + sus CSS).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / Regla de la Constitución | Estado | Evaluación |
| :--- | :--- | :--- |
| **I. Confidencialidad por Rol y Audiencia** | ✅ PASS | No modifica `allowedAgentsFor`, `knowledge.search()`, roles ni rutas protegidas. Las pestañas visibles en el cajón móvil siguen exactamente la misma lógica `visibleTabs` de `App.jsx`. |
| **II. RAG Estricto — Cero Alucinación** | ✅ PASS | No toca agentes, prompts ni recuperación RAG. |
| **III. Humano en el Loop para Decisiones Críticas** | ✅ PASS | Refuerza explícitamente el control humano en el envío automático de recordatorios (`templateApproved` manual y confirmación explícita vía botón `Guardar configuración` con *dirty state*). |
| **IV. Procesamiento Asíncrono y Resiliente** | ✅ PASS | No modifica webhooks ni colas BullMQ. |
| **V. Arquitectura Modular y Desacoplada** | ✅ PASS | Extrae `AgentRobotAvatar` a componente reutilizable en vez de duplicar código SVG entre `SupervisorPanel` y `ReminderConfig`; mantiene tokens centralizados en `theme.css`. |
| **Restricciones Técnicas y Stack** | ✅ PASS | No añade librerías, variables de entorno ni migraciones; respeta el stack fijo del repo hermano `trimIA-frontend` (Vite + React JSX + `oxlint`). |
| **Post-Design Re-Check (Phase 1)** | ✅ PASS | Contratos UI, modelos de estado en cliente y guía de validación verificados sin ninguna violación ni complejidad injustificada. |

## Project Structure

### Documentation (this feature)

```text
specs/023-ui-obsidian-responsive/
├── spec.md              # Feature specification (/speckit-specify)
├── checklists/
│   └── requirements.md  # Spec quality validation checklist
├── plan.md              # This file (/speckit-plan)
├── research.md          # Phase 0 architectural & visual decisions
├── data-model.md        # Client UI view-model & state transitions
├── contracts/
│   └── ui-contracts.md  # CSS token, component props, responsive & a11y contracts
├── quickstart.md        # Step-by-step Desktop/Mobile/Dark/Light verification guide
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created here)
```

### Source Code (sibling frontend repository `/home/mauro/Proyectos/trimIA-frontend`)

```text
../trimIA-frontend/
├── src/
│   ├── theme.css                          # Tokens Obsidian Precision (dark/light), motion Raycast, overrides móvil y KPIs neutros
│   ├── index.css                          # Ajustes base de layout móvil y prefers-reduced-motion para .sup-bot-*
│   ├── App.jsx                            # Estado mobileMenuOpen, barra superior móvil (.mobile-topbar) y backdrop del drawer
│   └── components/
│       ├── AgentRobotAvatar.jsx           # NUEVO: extracción compartida de AGENT_BOT_THEMES + AgentRobotAvatar (tamaños card/lg/sm + estado paused)
│       ├── SupervisorPanel.jsx            # Reemplaza definición inline de AgentRobotAvatar por import compartido
│       ├── CollectionsPanel.jsx           # Clases is-zero / is-static en KPIs y contenedor responsive de sub-pestañas
│       ├── collectionsPanel.css           # Sub-pestañas deslizables con fade lateral y KPIs neutros/estáticos
│       ├── ReminderConfig.jsx             # Dirty-state real, etiquetas compactas, bloque de aprobación unificado, AgentRobotAvatar + Trimi
│       ├── ReminderConfig.css             # Superficie aplanada sin "Muñeca Rusa", acento único, sliding pill, grillas 9x1 / 3x3 / 5x1
│       └── Trimi.jsx / Trimi.css          # Reutilizado tal cual (variant="avatar", size={32}) con respeto a reduced-motion
└── cypress/e2e/
    └── 02-cobranzas.cy.js                 # Referencia E2E (opcional actualizar en tareas si se requiere alinear con selectores predefinidos)
```

**Structure Decision**: Toda la documentación SpecKit vive en `specs/023-ui-obsidian-responsive/` dentro del repositorio raíz `trimIA`, y los cambios de implementación viven exclusivamente en el repositorio hermano `../trimIA-frontend`, respetando la separación establecida en `CLAUDE.md` y la constitución del proyecto.

## Complexity Tracking

> Sin violaciones a la Constitución; no se requieren excepciones ni justificaciones adicionales.
