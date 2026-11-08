# Research: 018 — Banco de Escenarios y Medición de Calidad

**Feature**: `018-banco-de-escenarios`  
**Date**: 2026-10-14  

---

## 1. Problema y Hallazgos Previos

### 1.1 Naturaleza no determinística de los Prompts
Los tests unitarios convencionales (`npm test`) usan aserciones determinísticas sobre strings (`expect(prompt).toContain(...)`), comprobando que una directiva esté redactada en el prompt. Sin embargo, no verifican que el modelo de lenguaje cumpla la instrucción en una inferencia real.

En pruebas manuales anteriores se identificaron 4 defectos reales en 3 días:
1. **Venta al dueño**: El orquestador intentaba venderle productos al dueño de la empresa por falta de neutralización del rol interlocutor.
2. **Saludo con pregunta omitida**: Ante «hola! ¿qué venden?», el asistente respondía el saludo y descartaba la consulta comercial.
3. **Derivación contradictoria**: Preguntaba «¿querés que lo consulte con un supervisor?» en el mismo mensaje en que ya estaba transfiriendo.
4. **Reinicio de saludos**: En el cuarto mensaje de un diálogo activo volvía a enviar el saludo inicial de bienvenida.

### 1.2 Por qué se requieren N corridas ($N=3$ a $5$)
En pruebas repetidas, una única corrida arrojó resultados contradictorios: en una tanda de 4 corridas idénticas, 3 cumplieron la regla y 1 perdió el hilo. Evaluar una sola vez confunde una falla real con variabilidad aleatoria. Medir $N$ corridas proporciona una métrica probabilística (*"pasó 4 de 5 veces"*).

### 1.3 Control de Ritmo y Cuota de API
El tier gratuito o estándar de Gemini establece un límite de 100 requests por minuto (RPM) para embeddings e inferencias. Ejecutar 8 escenarios $\times$ 3 corridas implica aproximadamente 24 a 48 llamadas. El arnés debe incorporar un retardo controlado (pacer de 600ms entre turnos) para prevenir errores HTTP 429 (`ResourceExhausted`).

---

## 2. Decisiones de Arquitectura y Diseño

### Decisión 1: Aislamiento del Corpus de Evaluación
* **Problema**: Si el banco de escenarios consulta la colección activa de ChromaDB, cualquier documento agregado o editado por un supervisor alteraría los resultados, impidiendo comparar dos corridas temporales.
* **Solución**: Se define un corpus fijo de prueba en `test/fixtures/corpus-evaluacion/` con documentos representativos de cada área. Para las pruebas de escenarios, el servicio de recuperación utiliza este corpus fijo o un namespace vectorial aislado de evaluación (`trimia_evaluation_corpus`), sin tocar los vectores operativos de producción.

### Decisión 2: Motor de Aserciones Basado en Patrones
* **Problema**: Evaluar respuestas mediante otro LLM ("LLM-as-a-judge") es costoso en tokens, agrega latencia y traslada la no-determinación a la evaluación misma.
* **Solución**: Utilizar aserciones determinísticas basadas en:
  - **Patrones de Exclusión (`mustNotContain`)**: Expresiones regulares sobre lo que está terminantemente prohibido decir (ej: frases de venta al dueño, preguntas de permiso al derivar, repetición de bienvenida).
  - **Patrones de Inclusión (`mustContain`)**: Verificación de presencia de información obligatoria (ej: mención de productos, explicación de circuito, términos de financiación).
  - **Aserciones Estructurales**: Verificación del agente ruteado (`expectedAgent`) y estado de escalado.

### Decisión 3: Desacople Total de `npm test`
* **Problema**: Forzar la ejecución del banco de escenarios en `npm test` consumiría tokens en cada commit y bloquearía los pipelines de integración continua rápida.
* **Solución**: Registrar un comando dedicado en `package.json`:
  ```bash
  npm run test:escenarios
  ```
  Con flags opcionales para filtrar:
  ```bash
  npm run test:escenarios -- --runs=3 --scenario=dueno-ventas
  ```

---

## 3. Matriz de los 8 Escenarios Críticos

| ID | Nombre | Condición de Entrada | Aserción Positiva (`mustContain`) | Aserción Negativa (`mustNotContain`) |
|---|---|---|---|---|
| `ESC-01` | Dueño pregunta por ventas | `userType: EMPLEADO`, rol dueño | Procedimiento de venta / circuito interno | No frases comerciales de venta ("¿te gustaría comprar?", "te podemos ofrecer") |
| `ESC-02` | Cliente externo misma consulta | `userType: CLIENTE`, sin whitelist | Atención comercial, bienvenida o catálogo | No lenguaje interno confidencial |
| `ESC-03` | Saludo combinado con catálogo | "hola! ¿qué venden?" | Mención de productos, rubro o catálogo | No saludo aislado sin respuesta a la pregunta |
| `ESC-04` | Saludo puro | "hola" | Saludo cordial, ponerse a disposición | No volcado extenso de listas ni presunciones |
| `ESC-05` | Cuarto turno en conversación activa | Historial con 3 mensajes previos | Respuesta directa a la duda | No expresiones de bienvenida inicial ("¡Bienvenido!", "Hola de nuevo!") |
| `ESC-06` | Consulta exclusiva de financiación | "qué cuotas y planes tienen?" | Plazos, medios de pago o financiación | No ofrecimiento de chequear stock en depósito |
| `ESC-07` | Mensaje bajo escalado humano | `needsHuman: true` | Mensaje de derivación / aviso de espera | No repreguntas al usuario ("¿en qué más puedo ayudarte?") |
| `ESC-08` | Reporte supervisor sobre vacíos | Consulta de vacíos de conocimiento | Resumen de temas o documentos | Cero casos nuevos creados en `Escalation` |

