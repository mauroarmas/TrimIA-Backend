# Feature Specification: 023 — Evolución Visual "Obsidian Precision", Responsive Móvil e Identidad Viva (Cobranzas y Recordatorios)

**Feature Branch**: `023-ui-obsidian-responsive`

**Created**: 2026-11-23

**Status**: Draft

**Input**: Evolucionar la interfaz operativa de TrimIA —comenzando por la navegación móvil global, el Panel de Cobranzas y la vista de Configuración de Recordatorios— bajo la dirección visual elegida **Obsidian Precision** (inspirada en Linear y Raycast), conservando la esencia cromática azul/cian del sistema, con sinergia simétrica entre Modo Oscuro y Modo Claro, micro-interacciones fluidas tipo *spring*, diseño responsive completo para teléfonos móviles y una presencia sutil y con propósito de los robots animados de agentes y la mascota oficial Trimi.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Configurar recordatorios con jerarquía clara y estado honesto en escritorio (Priority: P1)

Como supervisor o responsable de cobranzas en una computadora de escritorio, quiero configurar la cadencia de recordatorios de WhatsApp, el límite de reintentos, la plantilla y el estado de aprobación mediante selectores predefinidos sobre una superficie limpia y ordenada, distinguiendo de inmediato qué está seleccionado, si los envíos están activos o pausados y si hay cambios pendientes por guardar.

**Why this priority**: Es la tarea operativa central que motivó esta evolución visual; elimina la fatiga visual por exceso de degradados brillantes, el anidamiento innecesario de cajas, las inconsistencias tipográficas y la falsa señal de un botón de guardado siempre encendido.

**Independent Test**: Abrir la vista de Configuración de Recordatorios en una pantalla de escritorio estándar (1366×649) tanto en Modo Oscuro como en Modo Claro, verificar que el formulario completo y el botón de guardar son legibles y jerárquicamente claros sin competir con los selectores, modificar un parámetro y comprobar que el botón de guardado pasa de inactivo a activo y guarda correctamente.

**Acceptance Scenarios**:

1. **Given** el supervisor ingresa a Configuración de Recordatorios sin haber modificado ningún valor, **When** observa la pantalla en Modo Oscuro o Modo Claro, **Then** los selectores activos (días, combinaciones rápidas e intentos) se distinguen mediante superficie sutil con borde luminoso, mientras el botón "Guardar configuración" permanece en estado neutro deshabilitado sin competir por atención visual.
2. **Given** la configuración cargada inicialmente, **When** el supervisor cambia cualquier selector (días antes del vencimiento, máximo de intentos, plantilla de WhatsApp o interruptor de aprobación), **Then** el botón "Guardar configuración" se habilita con el acento primario único de la vista y feedback táctil suave.
3. **Given** la tarjeta de configuración en una pantalla de 1366 px de ancho, **When** el supervisor revisa los 9 selectores de días predefinidos (30d, 15d, 10d, 7d, 5d, 3d, 2d, 1d y Hoy), **Then** todos se muestran alineados en una sola fila equilibrada, las etiquetas de sección ("Días antes del vencimiento", "Máximo de intentos" y "Plantilla de WhatsApp") comparten idéntica jerarquía visual y no existen sub-tarjetas con bordes concéntricos innecesarios.
4. **Given** la plantilla aún no está aprobada en WhatsApp Business, **When** el supervisor consulta la pantalla, **Then** el estado de pausa de envíos se comunica en un único bloque coherente vinculado al interruptor de aprobación, sin triplicar el mismo aviso en la misma vista.
5. **Given** la fila superior de indicadores de Cobranzas, **When** un indicador muestra valor cero (por ejemplo, 0 comprobantes para revisar o 0 pagos confirmados), **Then** su acento visual se atenúa a un tono neutro informativo en lugar de simular urgencia o éxito activo, y el indicador no clickeable se diferencia de las tarjetas interactivas.

---

### User Story 2 — Operar el panel y configurar recordatorios cómodamente desde un teléfono móvil (Priority: P1)

Como supervisor o cobrador que accede a TrimIA desde el navegador de su teléfono (360–430 px de ancho), quiero navegar entre secciones mediante un menú deslizable que no aplaste la pantalla y ajustar cualquier parámetro de recordatorios con controles táctiles legibles y bien proporcionados, sin desborde horizontal ni textos cortados.

**Why this priority**: En la auditoría móvil actual (390×844), el menú lateral fijo bloquea el 73% de la pantalla y vuelve inutilizable el contenido principal; incluso colapsado, reduce el formulario a una columna estrecha que rompe el selector de intentos en 3 filas, apila los 9 días en 9 renglones y trunca el selector de plantilla.

**Independent Test**: Abrir la aplicación en un teléfono real o vista emulada de 390×844 y 360×800, verificar que el menú lateral inicia oculto y se abre mediante un botón superior con deslizamiento fluido, navegar entre sub-pestañas de Cobranzas y completar una edición y guardado de recordatorios sin scroll horizontal involuntario.

**Acceptance Scenarios**:

1. **Given** un usuario abre la aplicación en un teléfono de 390×844 o 360×800, **When** carga el Panel de Cobranzas, **Then** el menú lateral permanece oculto fuera de la pantalla y el contenido principal ocupa el 100% del ancho útil debajo de una barra superior compacta con acceso al menú, logo y cambio de tema.
2. **Given** el usuario pulsa el botón de menú en la barra superior móvil, **When** se abre el cajón lateral y elige otra sección, **Then** el menú se despliega con transición fluida sobre un fondo atenuado y se cierra automáticamente al seleccionar un destino o tocar fuera.
3. **Given** el usuario navega a Configuración de Recordatorios en un teléfono de 360 px o 390 px, **When** interactúa con las sub-pestañas de Cobranzas, **Then** puede deslizarlas horizontalmente y percibe visualmente que existen más pestañas fuera del borde visible.
4. **Given** el formulario de recordatorios abierto en móvil, **When** el usuario visualiza los controles, **Then** los 9 chips de días se organizan en una grilla compacta de 3×3, los 4 atajos rápidos en 2×2, las 5 opciones de "Máximo de intentos" se mantienen en una sola fila horizontal de 5 columnas, el selector de plantilla muestra su texto sin truncamiento prematuro y el bloque de aprobación ubica el interruptor junto al título con la descripción legible a ancho completo debajo.

---

### User Story 3 — Sinergia simétrica entre Modo Oscuro y Modo Claro con micro-interacciones fluidas (Priority: P2)

Como operador que alterna entre Modo Oscuro y Modo Claro durante la jornada laboral, quiero que ambos temas compartan la misma claridad, contraste y respuesta táctil inspirada en Raycast, sin perder la esencia azul/cian de TrimIA ni sufrir elementos desajustados al cambiar de tema.

**Why this priority**: Garantiza coherencia visual real en toda la sesión de trabajo y evita regresiones de contraste como alertas claras incrustadas sobre superficies oscuras o textos apagados.

**Independent Test**: Alternar repetidamente entre Modo Oscuro y Modo Claro en escritorio y móvil sobre el Panel de Cobranzas, verificando contraste legible en todos los estados (seleccionado, inactivo, hover, foco, pausa, éxito y error) y transiciones fluidas en interruptores, controles segmentados y chips.

**Acceptance Scenarios**:

1. **Given** el usuario está en Modo Oscuro, **When** cambia a Modo Claro (y viceversa), **Then** lienzo, superficies, divisores, bordes luminosos, selectores activos, alertas y textos cambian en perfecta simetría manteniendo contraste legible (nivel AA).
2. **Given** el usuario interactúa con los selectores de días, combinaciones rápidas, segmentos de intentos o el interruptor de aprobación, **When** pasa el cursor o presiona un control, **Then** recibe una respuesta visual y táctil breve (compresión ligera y desplazamiento fluido del indicador activo) sin saltos bruscos de diseño.
3. **Given** el usuario tiene activada en su dispositivo la preferencia de reducir movimiento, **When** navega o interactúa con la pantalla, **Then** las animaciones de desplazamiento y flotación se reducen o desactivan automáticamente conservando toda la funcionalidad.

---

### User Story 4 — Presencia sutil y contextual de robots animados y mascota Trimi (Priority: P3)

Como usuario de TrimIA, quiero percibir la personalidad propia de la plataforma a través de apariciones medidas y funcionales del robot animado de Cobranzas y de la mascota Trimi, reforzando el estado del automatismo y el feedback de guardado sin distraer ni infantilizar la herramienta operativa.

**Why this priority**: Conecta la identidad visual del sistema (ya presente en el inicio de sesión, supervisión y capacitación) con la operación diaria de cobranzas de forma sobria, útil y equilibrada.

**Independent Test**: Revisar la tarjeta de Configuración de Recordatorios en estado pausado, editado y recién guardado, verificando que el emblema animado del agente de cobranzas refleja el estado de envío y que Trimi acompaña discretamente el resumen de cadencia y la confirmación de guardado sin ocupar espacio excesivo.

**Acceptance Scenarios**:

1. **Given** el supervisor abre Configuración de Recordatorios, **When** observa el encabezado de la sección, **Then** un emblema compacto del robot animado de Cobranzas (hasta 44 px) acompaña el título e indica visualmente si los envíos automáticos están activos o en pausa esperando aprobación.
2. **Given** el supervisor modifica la cadencia de días antes del vencimiento, **When** lee el resumen de envíos programados, **Then** un mini-avatar compacto de la mascota Trimi en actitud de consejo acompaña la explicación en lenguaje natural.
3. **Given** el supervisor guarda cambios válidos exitosamente, **When** aparece el mensaje de confirmación, **Then** el mini-avatar de Trimi refleja una breve expresión celebratoria confirmando que la nueva configuración quedó aplicada para el próximo ciclo.

---

### Edge Cases

- **Configuración heredada con valores personalizados**: Si el servidor devuelve un día fuera de los 9 predefinidos (por ejemplo, 12 días) o una plantilla personalizada no listada en el catálogo estándar, la interfaz conserva y muestra esa opción seleccionada sin sobrescribirla ni perder datos al guardar otros campos.
- **Intento de deseleccionar el último día activo**: Si el usuario intenta desactivar el único día seleccionado, el sistema impide dejar la cadencia vacía y conserva al menos un día seleccionado.
- **Reversión manual al estado original**: Si el usuario cambia un parámetro y luego vuelve manualmente al valor original cargado desde el servidor, el estado de cambios pendientes vuelve a falso y el botón "Guardar configuración" regresa a su estado neutro deshabilitado.
- **Fallo de red al guardar o cargar**: Si ocurre un error de comunicación, los cambios del usuario no se pierden, se muestra una alerta legible en ambos temas y el botón permanece habilitado para reintentar.
- **Rotación de pantalla o redimensionamiento entre móvil y escritorio**: Al cambiar el ancho de la ventana de móvil a escritorio con el cajón lateral abierto, el diseño recupera automáticamente la disposición de escritorio sin dejar fondos oscuros bloqueando la pantalla.
- **Preferencia de movimiento reducido**: Si el usuario desactiva animaciones a nivel de sistema operativo, tanto las micro-interacciones como las animaciones del robot y Trimi permanecen estáticas y legibles.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE aplicar la dirección visual **Obsidian Precision** preservando la identidad azul/cian de TrimIA y garantizando equivalencia visual y contraste AA (>= 4.5:1 en texto normal) entre Modo Oscuro (`#090D18` lienzo / `#111827` superficie) y Modo Claro (`#F3F5F8` lienzo / `#FFFFFF` superficie).
- **FR-002**: El sistema DEBE reservar el acento primario brillante con degradado **exclusivamente** para la acción principal habilitada ("Guardar configuración" cuando hay cambios pendientes) y el indicador activo de navegación principal; los selectores internos activos (días, combinaciones rápidas e intentos) DEBEN diferenciarse mediante superficie translúcida sutil con borde luminoso de 1 px.
- **FR-003**: El sistema DEBE eliminar las capas de sub-tarjetas anidadas con bordes pesados dentro de Configuración de Recordatorios, organizando los bloques de configuración sobre una única tarjeta principal separada por divisores sutiles de 1 px.
- **FR-004**: El sistema DEBE unificar la jerarquía tipográfica de las etiquetas de sección ("Días antes del vencimiento", "Máximo de intentos" y "Plantilla de WhatsApp") con idéntico peso, tamaño y color de alto contraste, y emplear formato tabular en cifras, días, intentos y códigos técnicos de plantilla.
- **FR-005**: El sistema DEBE organizar los 9 selectores predefinidos de días (30d, 15d, 10d, 7d, 5d, 3d, 2d, 1d y Hoy) en una sola fila de 9 columnas en escritorio (> 900 px) y en una grilla compacta de 3×3 en teléfonos (<= 768 px), con las combinaciones rápidas diferenciadas jerárquicamente por tamaño y ubicación.
- **FR-006**: El sistema DEBE mantener las 5 opciones del selector segmentado "Máximo de intentos" (1 a 5) en una sola fila horizontal de 5 columnas tanto en escritorio como en teléfonos desde 360 px de ancho.
- **FR-007**: El sistema DEBE presentar el selector de "Plantilla de WhatsApp" con apariencia visual coherente con el sistema (sin flecha nativa cruda desalineada), legible sin truncamientos prematuros en pantallas desde 360 px y acompañado de su identificador técnico y breve descripción.
- **FR-008**: El sistema DEBE consolidar el estado de aprobación de la plantilla en WhatsApp Business en un bloque único y coherente vinculado al interruptor de activación, eliminando banners repetitivos que dupliquen el mismo aviso de bloqueo.
- **FR-009**: El sistema DEBE rastrear el estado de cambios pendientes (*dirty state*) comparando los valores editados contra la última configuración confirmada por el servidor, manteniendo el botón "Guardar configuración" deshabilitado y neutro cuando no existan diferencias reales y habilitándolo únicamente cuando haya cambios por guardar.
- **FR-010**: El sistema DEBE adaptar los indicadores superiores del Panel de Cobranzas para que los contadores en valor 0 se muestren en tono neutro en lugar de colores de alerta o éxito, y para que el indicador no interactivo no imite el comportamiento visual de un botón clickeable.
- **FR-011**: El sistema DEBE transformar la navegación lateral fija en un cajón deslizable (*off-canvas drawer*) oculto por defecto en pantallas de hasta 768 px de ancho, acompañado de una barra superior móvil compacta (<= 56 px) que permita abrir el menú y alternar tema, devolviendo el 100% del ancho útil al contenido principal sin desborde horizontal.
- **FR-012**: El sistema DEBE hacer que la barra de sub-pestañas del Panel de Cobranzas ocupe el ancho disponible en móvil con desplazamiento horizontal suave e indicación visual de contenido adicional fuera de cuadro.
- **FR-013**: El sistema DEBE incorporar micro-interacciones suaves inspiradas en Raycast (respuesta táctil breve en pulsación, transición fluida de indicadores activos, switch y apertura del cajón móvil) y desactivarlas automáticamente cuando el usuario prefiera movimiento reducido.
- **FR-014**: El sistema DEBE incluir un emblema animado compacto del robot de Cobranzas (<= 44 px) en la cabecera de Configuración de Recordatorios reflejando visualmente si los envíos automáticos están activos o en pausa, y un mini-avatar compacto de la mascota Trimi (<= 36 px) acompañando el resumen de cadencia y el feedback de guardado exitoso.
- **FR-015**: El sistema DEBE preservar íntegramente el contrato funcional existente de lectura y actualización de configuración de recordatorios sin requerir cambios en el servidor ni en la base de datos.

### Key Entities

- **Configuración de Recordatorios**: Conjunto de 4 parámetros editables por supervisión (`días antes del vencimiento`, `máximo de intentos`, `nombre de plantilla WhatsApp` y `estado de aprobación de plantilla`), más la marca temporal de última actualización y el estado derivado de *cambios sin guardar* en la sesión de edición.
- **Estado de Automatización de Cobranzas**: Representación visual unificada de si el agente de Cobranzas puede despachar envíos automáticos (`activo`) o permanece detenido a la espera de aprobación en WhatsApp Business (`pausado`).
- **Contexto de Navegación Móvil**: Estado efímero de apertura/cierre del cajón de navegación en pantallas pequeñas y preferencia persistida de tema visual (Modo Oscuro / Modo Claro).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En una pantalla de escritorio estándar (1366×649), el supervisor visualiza los 4 parámetros de configuración y alcanza el botón "Guardar configuración" reduciendo la altura vertical de la tarjeta de configuración en al menos un 20% respecto a la versión actual (757 px).
- **SC-002**: En una pantalla de escritorio (1366×649), el acento visual de acción primaria aparece exactamente en 1 control dentro del formulario (el botón de guardar cuando hay cambios pendientes) en el 100% de las revisiones, frente a los 5 controles simultáneos que competían anteriormente.
- **SC-003**: En teléfonos de 360×800 y 390×844, el 100% del contenido principal del Panel de Cobranzas y Configuración de Recordatorios es legible y operable con cero desborde horizontal involuntario y con áreas táctiles de al menos 36–40 px de alto en los controles principales.
- **SC-004**: En teléfonos de 360×800 y 390×844, los 9 días predefinidos se muestran en 3 filas (grilla 3×3) en lugar de 9 filas apiladas, y las 5 opciones de máximo de intentos se muestran en 1 sola fila horizontal sin quiebres.
- **SC-005**: El 100% de los textos, etiquetas y estados visibles en Modo Oscuro y Modo Claro cumplen un contraste mínimo de 4.5:1 (AA) y mantienen coherencia cromática al alternar de tema sin recargar la página.
- **SC-006**: Al ingresar a la pantalla sin realizar ediciones, el botón de guardar permanece deshabilitado el 100% de las veces, y se activa inmediatamente (< 100 ms percibidos) al modificar cualquier selector.
- **SC-007**: Los elementos de identidad animada (robot de Cobranzas y mini-avatar de Trimi) permanecen por debajo de 44 px de altura, no desplazan el contenido principal y respetan al 100% la preferencia de movimiento reducido del sistema operativo.

## Assumptions

- **Sin cambios de backend ni base de datos**: La especificación abarca exclusivamente mejoras de experiencia de usuario, diseño visual, responsive móvil e identidad interactiva sobre el panel web existente; los servicios y validaciones de recordatorios actuales permanecen intactos.
- **Alcance inicial focalizado**: Las mejoras de navegación móvil (cajón lateral y barra superior) benefician a toda la aplicación por ser parte del contenedor principal, mientras que el rediseño fino de componentes, estados, robot animado y Trimi se aplica específicamente al Panel de Cobranzas y Configuración de Recordatorios en esta entrega.
- **Catálogo de plantillas predefinidas**: Las plantillas de WhatsApp continúan ofreciéndose desde el catálogo predefinido actual con respaldo automático para conservar cualquier plantilla personalizada ya almacenada; no se consulta en tiempo real la API de Meta para listar plantillas.
- **Preservación de la esencia TrimIA**: Se mantiene la identidad de marca existente (logotipo, familias tipográficas actuales y acento azul/cian) sin migrar a otro sistema de diseño ajeno ni introducir dependencias externas pesadas.
- **Compatibilidad de navegadores**: Se apunta a navegadores modernos de escritorio y teléfonos móviles (Chrome, Safari, Edge y Firefox actuales).
