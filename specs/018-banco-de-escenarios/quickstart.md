# Quickstart: 018 — Banco de Escenarios y Medición de Calidad

> Actualización de implementación (2026-11-04): El comando activo delega a cli.ts y usa OrchestratorService/AgentsService reales con corpus/puertos en memoria. Requiere GOOGLE_API_KEY y GEMINI_MODEL explícitos para inferencias. --runs acepta enteros 1..5; el exit code depende del 80% de cada escenario. PASS=todas, WARN=mixto, FAIL=cero éxitos. ESC-07 comprueba pausa sin invocar IA; ESC-08 observa cero casos creados. Errores técnicos nunca aprueban y el reporte imprime respuestas discordantes completas. Las tablas de ejemplo siguientes son ilustrativas, no mediciones. Ver ../../docs/CONVERGENCIA_014_019.md.

Esta guía explica cómo ejecutar y calibrar el banco de escenarios de TrimIA.

---

## 1. Ejecución Básica (Todos los escenarios, 3 corridas)

Para ejecutar la batería completa de los 8 escenarios con $N=3$ repeticiones:

```bash
npm run test:escenarios
```

El arnés imprimirá en consola el progreso de cada escenario turno por turno y finalizará con una tabla resumen consolidada:

```text
================================================================================
📊 REPORTE CONSOLIDADO DEL BANCO DE ESCENARIOS — TRIMIA
================================================================================
[PASS] ESC-01: Dueño pregunta por ventas ......... 3/3 (100%)
[PASS] ESC-02: Cliente externo misma consulta ... 3/3 (100%)
[PASS] ESC-03: Saludo con catálogo .............. 3/3 (100%)
[PASS] ESC-04: Saludo puro ...................... 3/3 (100%)
[PASS] ESC-05: Cuarto turno sin reinicio ........ 3/3 (100%)
[PASS] ESC-06: Consulta de financiación ......... 3/3 (100%)
[PASS] ESC-07: Mensaje en escalado humano ....... 3/3 (100%)
[PASS] ESC-08: Reporte supervisor sin tickets ... 3/3 (100%)
--------------------------------------------------------------------------------
Total: 8/8 escenarios superados (24/24 corridas exitosas) — 100% efectividad
Tiempo total: 42.5s
================================================================================
```

---

## 2. Ejecutar un Escenario Específico

Si estás ajustando el prompt de un caso puntual (por ejemplo el de saludo o el del dueño):

```bash
npm run test:escenarios -- --scenario=ESC-01
```

O por nombre:

```bash
npm run test:escenarios -- --scenario=dueno
```

---

## 3. Ajustar la Cantidad de Corridas ($N$)

Para una validación intensiva de estabilidad previa a un pase a producción:

```bash
npm run test:escenarios -- --runs=5
```

O para una corrida rápida de 1 repetición:

```bash
npm run test:escenarios -- --runs=1
```

---

## 4. Diagnóstico de Fallas

Si un escenario no alcanza el 100%, el reporte imprimirá la aserción que falló y el extracto generado:

```text
❌ FALLO en Corrida #2 de ESC-01:
   Regla violada: mustNotContain [/¿te gustaría comprar|ofrecemos comprar/i]
   Texto generado por el modelo: "...el proceso es simple, ¿te gustaría comprar hoy mismo una unidad?..."
```

