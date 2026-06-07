@./skills/using-superpowers/SKILL.md
@./skills/using-superpowers/references/gemini-tools.md
@./docs/CONTEXTO_TECNICO.md

# Cómo trabajar en TrimIA

Los archivos importados arriba se cargan solos en cada sesión:

1. **`skills/using-superpowers/SKILL.md`** — sistema de skills (CÓMO trabajar). Si hay
   1% de chance de que una skill aplique, leela y seguila (brainstorming antes de codear,
   systematic-debugging ante un bug, test-driven-development para código nuevo,
   verification-before-completion antes de decir "listo", etc.).
2. **`skills/using-superpowers/references/gemini-tools.md`** — mapeo de herramientas
   (las skills usan nombres de Claude Code: `Read`→`view_file`, `Bash`→`run_command`...).
3. **`docs/CONTEXTO_TECNICO.md`** — documento maestro del proyecto (QUÉ es): stack,
   estructura del código, flujo de un mensaje, los 5 agentes, RAG, modelo de datos,
   estado por fases, mapeo requisito→entregable, tareas pendientes y reglas.

## Reglas que NO se negocian

- **Citá la fuente.** Para cada afirmación sobre el código o el proyecto, indicá el
  archivo/sección de donde la sacaste. Si no está en el doc ni en el código, decí
  "no lo sé" — NO inventes (precios, montos, stock, comportamiento, nombres de archivos).
- **Confidencialidad (regla de oro / OE-10):** un CLIENTE jamás debe acceder a
  conocimiento `INTERNO` ni a agentes no permitidos. Ver `allowedAgentsFor` en
  `src/ai/agents/agent-domains.ts`.
- **RAG estricto:** los agentes responden SOLO con el contexto recuperado; si la
  confianza cae bajo `RAG_CONFIDENCE_THRESHOLD`, escalan a humano.
- **Decisiones críticas con humano:** el sistema no cierra ventas, no aprueba créditos
  ni verifica pagos solo — siempre deriva a un supervisor.
- **Convenciones:** patrón de agente = `<agente>.graph.ts` + `<agente>.prompt.ts` con la
  fábrica `buildRagAgentGraph`; inyección de dependencias; env vars validadas en
  `config.module.ts`.
- **Verificá antes de terminar:** corré `docker compose exec nestjs npx jest --no-coverage`
  y confirmá que compila/arranca.
- Cambios incrementales y explicados. Si algo es ambiguo, preguntá antes de asumir.

## Prioridad de instrucciones

1. Instrucciones explícitas del usuario (este archivo, pedidos directos) — máxima.
2. Skills de superpowers — sobre el comportamiento por defecto.
3. Comportamiento por defecto del modelo — mínima.