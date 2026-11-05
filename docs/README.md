# Documentación vigente de TrimIA

Actualizado el 2026-11-04. Este índice distingue las fuentes del proyecto, la operación actual y el material histórico archivado.

## Alcance acordado para el MVP

- Stock Paljet y crédito Riesgo Online simulados.
- Google Sheets como CRM; completar su configuración y validación.
- Demo actual en PC + Docker + Tailscale. GCP para la versión final.
- Paperclip excluido.
- La convergencia 014–019 fue integrada y desplegada tras la revisión de Mauro. El MVP completo aún requiere cerrar los flujos identificados en la auditoría; no se agregan funcionalidades por archivar documentos.

## Siguiente implementación del MVP

1. [020 — Venta financiada completa](../specs/020-venta-financiada-mvp/spec.md): solicitud desde la conversación, evaluación simulada, revisión humana y aviso al cliente.
2. [021 — Seguimiento comercial automático](../specs/021-seguimiento-comercial-mvp/spec.md): una regla de seguimiento, bajas y estado de la comunicación.

Ambas están especificadas, no implementadas. La configuración de Google Sheets permanece en la 019; no se abre una tercera spec de audio o historial.

## Para trabajar y operar

| Documento | Contenido |
|---|---|
| [Contexto técnico](CONTEXTO_TECNICO.md) | Componentes actuales y dónde está su código |
| [Contrato API del frontend](CONTRATO_API_Frontend.md) | Referencia de integración del panel; contrastar payloads con controladores/DTO y contratos de cada spec |
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
