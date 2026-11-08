# Documentación vigente de TrimIA

Actualizado el 2026-11-06. Este índice distingue las fuentes del proyecto, la operación actual y el material histórico archivado.

## Alcance acordado para el MVP

- Stock Paljet y crédito Riesgo Online simulados.
- Google Sheets como CRM; completar su configuración y validación.
- Demo actual en PC + Docker + Tailscale. GCP para la versión final.
- Paperclip excluido.
- La convergencia 014–019 fue integrada y desplegada tras la revisión de Mauro. El MVP completo aún requiere cerrar los flujos identificados en la auditoría; no se agregan funcionalidades por archivar documentos.

## Estado de los flujos del MVP

1. [020 — Venta financiada completa](../specs/020-venta-financiada-mvp/spec.md): datos desde el chat → Administración habilita ofertas → el cliente elige y confirma → Ventas registra cierre y cuotas desde una ficha con chat. Vigencia de 48 horas desde la creación del pedido/evaluación preliminar.
2. [021 — Seguimiento comercial automático](../specs/021-seguimiento-comercial-mvp/spec.md): una regla y un seguimiento por oportunidad, respetando revisión administrativa, cierre y vigencia. Plazo inicial configurable de 48 horas de inactividad, independiente del vencimiento de financiación.
3. [022 — Mensajería del MVP](../specs/022-mensajeria-mvp/spec.md): controles comunes de no contacto y resultado de los envíos, con entregas simuladas verificables y reintentos acotados.

La 020 está implementada y desplegada en la demo Tailscale, incluido el rediseño acordado el 2026-11-06. Su spec registra evidencia técnica; sigue pendiente la prueba del usuario. Las 021 y 022 están redactadas con sus listas de calidad revisadas, sin implementar por esta redacción. Para habilitar el seguimiento de 021 deben estar disponibles los controles de 022; esta última puede probarse con los avisos existentes de 020.

La configuración de Google Sheets permanece en 019. La 022 separa controles antes agrupados dentro de 021; no incorpora audio web ni mezcla automática de historiales. Las salidas simuladas no acreditan entrega real ni aprobación de plantillas de WhatsApp. El MVP y la aceptación final del proyecto no se declaran completos por redactar estas specs.

## Para trabajar y operar

| Documento | Contenido |
|---|---|
| [Contexto técnico](CONTEXTO_TECNICO.md) | Componentes actuales y dónde está su código |
| [Contrato API del frontend](CONTRATO_API_Frontend.md) | Referencia de integración del panel; contrastar payloads con controladores/DTO y contratos de cada spec |
| [Base de conocimiento de la demo](BASE_CONOCIMIENTO_DEMO.md) | Contenido ficticio coherente, carga y verificación con Gemini |
| [Demo local y WhatsApp](DEMO_LOCAL_WHATSAPP.md) | Configuración y operación del despliegue actual |
| [Convergencia 014–019](CONVERGENCIA_014_019.md) | Implementación, evidencia, limitaciones y despliegue aprobado |
| [Plan de trabajo](plan_de_trabajo.md) | Plan histórico de sprints; el estado de implementación se comprueba en código y evidencias |
| [Specs](../specs/README.md) | Especificaciones y tareas; se conservan para continuidad y trazabilidad |

## Fuentes del proyecto y aceptación

- [Alcance original](TP2_DeclaracióndeAlcancedeProyecto_TrimIA.pdf).
- [Matriz original de requisitos](TP2_PMI_MatrizdetrazabilidaddeRequisitos_TrimIA-requisitos.csv).
- [Acta de constitución](Acta_de_Constitucion_de_Proyecto_2026.md).
- [Diccionario EDT](Diccionario_EDT_TrimIA.pdf).
- [Prototipos](prototipos.pdf) y [diagramas](diagrams/DIAGRAMAS_ARQUITECTURA.md).
- `negocio/`: documentos operativos usados como fuentes para capacitación y pruebas.
- `PRUEBAS/`: plan, defectos y observaciones de QA. No implica que cada defecto histórico siga abierto.

Las fuentes originales describen el proyecto final. Los recortes actuales del MVP se enumeran arriba; no se alteraron los originales.

## Archivo externo

[Índice de la limpieza](/home/mauro/Cursado-2026/Proyecto-Final/contenido-codigo/limpieza-2026-11-04/README.md).

[Auditoría completa previa al recorte del MVP](/home/mauro/Cursado-2026/Proyecto-Final/contenido-codigo/limpieza-2026-11-04/entorno-convergencia/trimIA/docs/AUDITORIA_MVP_2026-11-04.md). Leerla con el alcance acordado arriba: sus pendientes de proveedores reales y GCP corresponden a la versión final.

Allí se conservan los estados antiguos, transcripciones reemplazadas por fuentes, pre-specs consumidas, scripts puntuales y el entorno aislado ya integrado. El manifiesto permite encontrar la ruta original y verificar los archivos por SHA-256.
