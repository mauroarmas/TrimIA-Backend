---
name: Project TrimIA
description: Tesis de grado — plataforma de agentes IA para empresas comerciales, backend NestJS en desarrollo activo
type: project
originSessionId: 1facc19b-453b-4476-aac3-5d9766931d3d
---
TrimIA es una plataforma de IA basada en un ecosistema de agentes inteligentes para empresas comerciales. Backend NestJS/TypeScript, en etapa inicial de desarrollo (sin commits aún).

**Why:** Tesis de grado de Mauro. El objetivo es centralizar el conocimiento organizacional, asistir empleados y automatizar capacitación, seguimiento comercial y cobranzas.

**How to apply:** Tener en cuenta la arquitectura definida en product.md al sugerir decisiones técnicas. El sistema tiene 5 capas: Comunicación (WhatsApp/n8n/Frontend), Lógica (NestJS + Redis/BullMQ + LangGraph.js + Gemini), Datos (PostgreSQL+Prisma + ChromaDB/Pinecone + APIs externas), Administración (Paperclip) e Infraestructura (Docker + GCP).

**Modelo de 5 agentes especializados** + orquestador (ver [[project-credimision-procesos]] para el mapeo a roles reales):
- `ORCHESTRATOR` — clasifica y deriva
- `SALES` — conversación comercial, prospectos, seguimiento. NO decide crédito ni cierra venta: cuando hay financiación deriva a ADMIN, y para cerrar deriva al humano con toda la info ya recopilada (productos, medio de pago, resultado de crédito).
- `ADMIN` — otorgamiento de crédito y aprobación de financiación. **Único agente con acceso a Riesgo Online.** Verificación crediticia, gate de financiación, cotización fuera de lista, control documental. Es el agente MÁS auditable en Paperclip (decisiones críticas con impacto financiero/legal).
- `COLLECTIONS` — cobro de cuotas de ventas ya financiadas. NO aprueba crédito (eso es ADMIN, antes de la venta).
- `LOGISTICS` — envíos, entregas, despacho.
- `DEPOSITS` — stock, disponibilidad, fotos/videos.

**Doble rol de cada agente (NO olvidar):** atienden a clientes externos (consultas comerciales/operativas) Y capacitan a empleados internos (dudas de proceso, ej. "¿cómo finalizo una venta con estos datos?"). El rol de capacitación es central en el acta (reducir inducción 50%, volver reutilizable el conocimiento tácito).

**Confidencialidad (decisión de diseño para Fase 4):** el mismo agente por el mismo WhatsApp puede recibir cliente o empleado, pero el conocimiento interno no debe filtrarse a clientes. Solución en dos capas: (1) identificar quién pregunta — whitelist de números de empleados (campo `userType` CLIENTE/EMPLEADO en Conversation) + canal web autenticado; (2) etiquetar conocimiento por audiencia (campo `audience` público/interno en KnowledgeDocument) y filtrar la búsqueda RAG según el que pregunta.

Integraciones: Paljet (stock/saldos, solo lectura — revisar si cobranzas requiere escritura), Riesgo Online (crédito, solo lectura, **exclusivo de ADMIN**), CRM (prospectos — lectura + escritura selectiva: `createProspect` y `addFollowUp`, retry máx 2 intentos, auditoría vía OrchestrationEvent). Google Drive (detalle de créditos) candidato a ingesta RAG.
Arquitectura RAG con base de conocimiento dinámica.

**Decisiones en curso:** El proyecto está en experimentación activa. Features, integraciones y alcance pueden cambiar durante el desarrollo. Nada está cerrado definitivamente.
