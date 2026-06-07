/**
 * Página HTML del Panel del Supervisor (módulo de gobernanza).
 *
 * Es una sola página autocontenida (sin React ni build): hace fetch a
 * `GET /supervisor/metrics` y dibuja tarjetas + barras + eventos. Se sirve desde
 * el SupervisorController. Cuando llegue el frontend React (E4), esto se reemplaza
 * por el módulo de Gobernanza dentro de esa app.
 */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TrimIA · Panel del Supervisor</title>
  <style>
    :root { --bg:#0f172a; --card:#1e293b; --line:#334155; --txt:#e2e8f0; --muted:#94a3b8; --accent:#38bdf8; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--txt); }
    header { padding:20px 28px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; }
    header h1 { font-size:18px; margin:0; }
    header .sub { color:var(--muted); font-size:13px; }
    main { padding:24px 28px; max-width:1000px; margin:0 auto; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; margin-bottom:28px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px; }
    .card .label { color:var(--muted); font-size:13px; }
    .card .value { font-size:30px; font-weight:600; margin-top:6px; }
    section h2 { font-size:14px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin:28px 0 12px; }
    .bar-row { display:flex; align-items:center; gap:12px; margin:8px 0; }
    .bar-row .name { width:120px; font-size:13px; }
    .bar-track { flex:1; background:#0b1220; border-radius:6px; overflow:hidden; height:22px; }
    .bar-fill { height:100%; background:var(--accent); }
    .bar-row .num { width:90px; text-align:right; font-size:13px; color:var(--muted); }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
    th { color:var(--muted); font-weight:500; }
    .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; background:#0b1220; border:1px solid var(--line); }
    .empty { color:var(--muted); font-style:italic; }
    footer { color:var(--muted); font-size:12px; text-align:center; padding:20px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>TrimIA · Panel del Supervisor</h1>
      <div class="sub">Módulo de Gobernanza — métricas en vivo</div>
    </div>
    <div class="sub" id="updated">cargando…</div>
  </header>

  <main>
    <div class="cards" id="cards"></div>

    <section>
      <h2>Tokens por agente</h2>
      <div id="tokens"></div>
    </section>

    <section>
      <h2>Eventos por tipo</h2>
      <div id="eventTypes"></div>
    </section>

    <section>
      <h2>Últimos eventos</h2>
      <table>
        <thead><tr><th>Hora</th><th>Evento</th><th>Agente</th></tr></thead>
        <tbody id="events"></tbody>
      </table>
    </section>
  </main>

  <footer>Se actualiza cada 5 s · datos de TokenUsage / OrchestrationEvent / Conversation</footer>

  <script>
    const fmt = (n) => (n ?? 0).toLocaleString('es-AR');

    function card(label, value) {
      return '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
    }

    function bars(map, valueFn) {
      const entries = Object.entries(map);
      if (!entries.length) return '<div class="empty">Sin datos todavía.</div>';
      const max = Math.max(...entries.map(([, v]) => valueFn(v)), 1);
      return entries.map(([name, v]) => {
        const val = valueFn(v);
        const pct = Math.round((val / max) * 100);
        return '<div class="bar-row"><div class="name">' + name + '</div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="num">' + fmt(val) + '</div></div>';
      }).join('');
    }

    async function refresh() {
      try {
        const r = await fetch('/supervisor/metrics');
        const m = await r.json();

        document.getElementById('cards').innerHTML =
          card('Conversaciones', fmt(m.conversations.total)) +
          card('Activas', fmt(m.conversations.active)) +
          card('Tokens entrada', fmt(m.tokens.totalInput)) +
          card('Tokens salida', fmt(m.tokens.totalOutput));

        document.getElementById('tokens').innerHTML =
          bars(m.tokens.byAgent, (v) => v.input + v.output);

        document.getElementById('eventTypes').innerHTML =
          bars(m.events.byType, (v) => v);

        const rows = m.recentEvents.map((e) => {
          const t = new Date(e.createdAt).toLocaleTimeString('es-AR');
          return '<tr><td>' + t + '</td><td><span class="tag">' + e.eventType + '</span></td><td>' + (e.agentType ?? '—') + '</td></tr>';
        }).join('');
        document.getElementById('events').innerHTML =
          rows || '<tr><td colspan="3" class="empty">Sin eventos todavía.</td></tr>';

        document.getElementById('updated').textContent =
          'actualizado ' + new Date().toLocaleTimeString('es-AR');
      } catch (err) {
        document.getElementById('updated').textContent = 'error al cargar';
      }
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;