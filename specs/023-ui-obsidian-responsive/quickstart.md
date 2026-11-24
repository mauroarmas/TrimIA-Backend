# Quickstart & Validation Guide: 023 — Obsidian Precision, Responsive Móvil e Identidad Viva

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contracts**: [ui-contracts.md](./contracts/ui-contracts.md)

---

## Prerrequisitos

1. Backend NestJS corriendo en local (`http://localhost:3000`, `docker compose up -d` en `/home/mauro/Proyectos/trimIA`).
2. Frontend `trimIA-frontend` corriendo en `http://localhost:8080` (`npm run dev` en `/home/mauro/Proyectos/trimIA-frontend`).
3. Usuario de prueba con acceso al Panel de Cobranzas (`diego.bazan@credimision.com`).

---

## 1. Validación estática y de build

Ejecutar desde `/home/mauro/Proyectos/trimIA-frontend`:

```bash
npx oxlint src/App.jsx src/components/AgentRobotAvatar.jsx src/components/SupervisorPanel.jsx src/components/CollectionsPanel.jsx src/components/ReminderConfig.jsx
VITE_SAME_ORIGIN=true npm run build
```

**Resultado esperado**: 0 errores y 0 warnings en los archivos tocados; build de Vite completado sin errores.

---

## 2. Escenarios de validación en navegador (Chrome DevTools)

### Escenario A — Escritorio `1366×649` (Modo Oscuro y Modo Claro)
1. Iniciar sesión y navegar a `/panel/cobranzas/configuracion-recordatorios`.
2. **Acento único y estado honesto (*dirty state*)**:
   - Comprobar al cargar que el botón `"Guardar configuración"` está **deshabilitado y neutro** (sin brillo primario).
   - Comprobar que los chips seleccionados (`7d`, `3d`, `Hoy (0)`) y el segmento `3` usan superficie translúcida + borde luminoso de `1px`, nunca el gradiente azul primario.
   - Modificar un día o intento y verificar que `"Guardar configuración"` pasa inmediatamente a activo con gradiente primario.
   - Revertir el cambio manualmente al valor original y comprobar que el botón vuelve a estado deshabilitado.
3. **Jerarquía, densidad y tipografía**:
   - Verificar que `"Días antes del vencimiento"`, `"Máximo de intentos"` y `"Plantilla de WhatsApp"` tienen exactamente el mismo color y peso computado.
   - Confirmar que los 9 chips de días forman **1 sola fila de 9 columnas** y la tarjeta `.rc-card` redujo su altura al menos un 20% respecto a `757px` (sin sub-cards anidadas).
   - Verificar que las tarjetas KPI con valor `0` lucen tono neutro y la 3ª tarjeta estática no muestra animación de botón al pasar el cursor.
4. **Sinergia de temas**:
   - Pulsar `"Modo claro"` y `"Modo oscuro"` en el sidebar; comprobar que todas las superficies, bordes, `<select>` y textos mantienen contraste AA sin cajas blancas/oscuras desentonadas.

### Escenario B — Teléfonos `390×844` y `360×800`
1. Activar emulación móvil en Chrome DevTools en `390×844` y luego `360×800`.
2. **Drawer móvil y cero desborde horizontal**:
   - Al cargar, `.app-sidebar` está oculto y se muestra `.mobile-topbar` arriba; comprobar `document.documentElement.scrollWidth <= window.innerWidth`.
   - Pulsar el botón menú, comprobar la animación fluida del cajón con backdrop, elegir una pestaña y confirmar que el cajón se cierra solo.
3. **Sub-pestañas y formulario responsive**:
   - Confirmar que `.submenu-pills` se desliza horizontalmente con indicador visual lateral.
   - Confirmar que los 9 días forman una grilla **3×3**, los 4 presets **2×2**, y `"Máximo de intentos"` (`1..5`) permanece en **1 sola fila horizontal de 5 columnas** incluso en `360px`.
   - Confirmar que `#reminder-template` se lee sin truncamiento prematuro y el toggle de aprobación mantiene su descripción legible a ancho completo debajo del encabezado.

### Escenario C — Robots animados, mascota `Trimi` y `prefers-reduced-motion`
1. Comprobar que el emblema animado de `AgentRobotAvatar` (`COLLECTIONS`, `<= 44px`) aparece en la cabecera de `"Configurar recordatorios"` y refleja visualmente el estado pausado/activo al alternar el switch de aprobación.
2. Comprobar que el mini-avatar de `Trimi` (`<= 36px`) acompaña el resumen de cadencia (`consejo`) y cambia a expresión celebratoria (`felicitaciones`) al guardar exitosamente una modificación (y restaurar luego el valor original).
3. Activar `Emulate CSS media feature prefers-reduced-motion: reduce` en Chrome DevTools y verificar que las animaciones de flotación/transición se pausan sin afectar la usabilidad.
