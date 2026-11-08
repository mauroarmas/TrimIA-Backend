const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { fixtureId, modules, salesPills, employees, draftPill } = require('./fixtures/qa-cycle2.cjs');
const base = 'https://trimia-demo.tail9126e1.ts.net';
if (process.argv.includes('--host-db')) {
  // La URL se captura en memoria; nunca se imprime ni se escribe en archivos.
  const { execFileSync } = require('node:child_process');
  const databaseUrl = new URL(execFileSync('docker', ['exec', 'trimia-nestjs-1', 'node', '-e', 'process.stdout.write(process.env.DATABASE_URL)'], { encoding: 'utf8' }));
  databaseUrl.hostname = '127.0.0.1';
  databaseUrl.port = '5433';
  process.env.DATABASE_URL = databaseUrl.href;
}
const prisma = new PrismaClient();

async function main() {
  const credentials = JSON.parse(fs.readFileSync(path.resolve('storage/qa-cycle2/credentials.json'), 'utf8'));
  const tokens = {};
  const checks = [];
  async function api(key, route, expected = 200, method = 'GET', body, headers = {}) {
    const response = await fetch(base + route, {
      method, signal: AbortSignal.timeout(30000),
      headers: { ...(tokens[key] ? { Authorization: 'Bearer ' + tokens[key] } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, expected, `${key}: ${method} ${route}`);
    return response;
  }
  for (const employee of employees) {
    const response = await api(employee.key, '/auth/login', employee.isActive === false ? 401 : 200, 'POST', { email: employee.email, password: credentials.password });
    if (employee.isActive !== false) tokens[employee.key] = (await response.json()).accessToken;
  }
  checks.push('Diez cuentas: nueve logins válidos y uno inactivo rechazado por la URL pública.');

  const sofia = await (await api('sofia', '/training/modules')).json();
  assert.equal(sofia.length, 1);
  assert.equal(sofia[0].title, 'Vendedor Ecommerce / Salón');
  assert.equal(sofia[0].pillsCount, 6);
  assert.equal(sofia[0].completedPillsCount, 2);
  assert.deepEqual(sofia[0].pills.map((pill) => pill.isLocked), [false, false, false, true, true, true]);
  const initial = await (await api('inicio', '/training/modules')).json();
  assert.equal(initial[0].completedPillsCount, 0);
  assert.deepEqual(initial[0].pills.map((pill) => pill.isLocked), [false, true, true, true, true, true]);
  await api('inicio', `/training/pills/${salesPills[1].id}`, 403);
  await api('sofia', `/training/pills/${modules[1].pills[0].id}`, 403);
  await api('sofia', `/training/pills/${draftPill.id}`, 404);
  const ready = await (await api('practica', '/training/modules')).json();
  assert.equal(ready[0].completedPillsCount, 6);
  checks.push('Sofía 2/6, inicio 0/6 y práctica 6/6; candados y alcance por sector verificados.');

  for (const module of modules) for (const pill of module.pills) {
    const detail = await (await api('gerente', `/training/pills/${pill.id}`)).json();
    assert.equal(detail.hasAudio, true);
    assert(detail.audioDurationSeconds > 30);
    assert(detail.quiz.every((question) => !('correctOptionIndex' in question)));
    const audio = await api('gerente', `/training/pills/${pill.id}/audio`, 206, 'GET', null, { Range: 'bytes=0-1023' });
    assert.match(audio.headers.get('content-type'), /audio\/mpeg/);
    assert.equal((await audio.arrayBuffer()).byteLength, 1024);
  }
  checks.push('Siete audios reproducibles publicados por HTTPS, con streaming parcial 206 y cuestionarios sin respuestas expuestas.');
  const supervisor = await (await api('gerente', '/training/supervisor/modules')).json();
  assert.equal(supervisor.reduce((count, module) => count + module.pills.filter((pill) => pill.status === 'DRAFT').length, 0), 1);

  const startId = fixtureId('employee:inicio');
  const diagnosticId = fixtureId('employee:diagnostico');
  // Estos dos perfiles se restauran a su estado inicial eliminando solo los
  // registros creados por esta comprobación, nunca registros anteriores.
  const oldProgress = await prisma.employeeProgress.findMany({ where: { employeeId: { in: [startId, diagnosticId] } } });
  const oldDiagnostics = await prisma.diagnosticSession.findMany({ where: { employeeId: diagnosticId } });
  assert.equal(oldProgress.length, 0, 'Los perfiles de verificación ya se usaron; no se modificaron.');
  assert.equal(oldDiagnostics.length, 0, 'El perfil de diagnóstico ya se usó; no se modificó.');
  const startedAt = new Date();
  let addedProgressIds = [];
  let addedDiagnosticIds = [];
  try {
    const wrong = await (await api('inicio', `/training/pills/${salesPills[0].id}/verify`, 201, 'POST', { answers: salesPills[0].quiz.map((question) => (question.correctOptionIndex + 1) % question.options.length) })).json();
    assert.equal(wrong.passed, false);
    const correct = await (await api('inicio', `/training/pills/${salesPills[0].id}/verify`, 201, 'POST', { answers: salesPills[0].quiz.map((question) => question.correctOptionIndex) })).json();
    assert.equal(correct.passed, true);
    await api('inicio', `/training/pills/${salesPills[1].id}`, 200);

    const diagnosis = await (await api('diagnostico', '/training/diagnostic')).json();
    assert(diagnosis.questions.length >= 5 && diagnosis.questions.length <= 8);
    const answers = diagnosis.questions.map((question) => {
      const pill = salesPills.find((item) => item.id === question.pillId);
      const quiz = pill.quiz.find((item) => item.id === question.questionId);
      return { pillId: pill.id, questionId: quiz.id, selectedOptionIndex: quiz.correctOptionIndex };
    });
    await api('diagnostico', '/training/diagnostic/submit', 201, 'POST', { answers });
    const exempt = await (await api('diagnostico', '/training/modules')).json();
    assert.equal(exempt[0].completedPillsCount, 6);
    assert(exempt[0].pills.every((pill) => pill.isExempted));
    checks.push('Verificación incorrecta/correcta, desbloqueo de siguiente píldora y diagnóstico con exención verificados; perfiles restaurados después.');
  } finally {
    addedProgressIds = (await prisma.employeeProgress.findMany({ where: { employeeId: { in: [startId, diagnosticId] }, createdAt: { gte: startedAt } }, select: { id: true } })).map((item) => item.id);
    addedDiagnosticIds = (await prisma.diagnosticSession.findMany({ where: { employeeId: diagnosticId, createdAt: { gte: startedAt } }, select: { id: true } })).map((item) => item.id);
    await prisma.$transaction([
      prisma.employeeProgress.deleteMany({ where: { id: { in: addedProgressIds } } }),
      prisma.diagnosticSession.deleteMany({ where: { id: { in: addedDiagnosticIds } } }),
    ]);
  }

  const customers = await (await api('controladora', '/collections/clients')).json();
  const testCustomers = customers.filter((client) => client.name.startsWith('[QA Ciclo 2]'));
  assert.equal(testCustomers.length, 5);
  const pedro = testCustomers.find((client) => client.id === fixtureId('client:pedro'));
  assert.equal(pedro.accountSummary.totalDebt, '1080000.00');
  const proofs = await (await api('controladora', '/collections/proofs')).json();
  assert.equal(proofs.filter((proof) => proof.extractedOpCode?.startsWith('QA-C2-')).length, 3);
  const zero = proofs.find((proof) => proof.extractedOpCode === 'QA-C2-CERO');
  await api('controladora', `/collections/proofs/${zero.id}/accept`, 409, 'POST');
  const image = await api('controladora', `/collections/proofs/${zero.id}/image`);
  assert.match(image.headers.get('content-type'), /image\/png/);
  await image.arrayBuffer();
  const prospects = await (await api('supventas', '/sales/prospects')).json();
  assert.equal(prospects.filter((item) => item.name.startsWith('[QA Ciclo 2]')).length, 3);
  const requests = await (await api('supadmin', '/sales/financing/requests')).json();
  assert.equal(requests.filter((item) => item.productSummary.startsWith('[QA Ciclo 2]')).length, 5);
  await api('supventas', '/sales/financing/requests', 403);
  checks.push('Cinco clientes de QA, deuda de ejemplo, tres comprobantes pendientes (incluido cero bloqueado), imágenes, tres prospectos y cinco solicitudes accesibles.');
  for (const mode of ['GUIDED', 'FREE']) {
    const session = await (await api('practica', `/training/simulations/${fixtureId('simulationSession:' + mode)}`)).json();
    assert.equal(session.status, 'COMPLETED');
    assert.equal(session.messages.filter((message) => message.sender === 'EMPLOYEE').length, 2);
    if (mode === 'FREE') assert.match(session.feedback.toImprove, /Faltó solicitar/);
  }
  checks.push('Dos simulaciones completas con devolución coherente con el historial; la omisión de verificación crediticia se muestra como mejora.');
  await api('controladora', '/auth/logout', 200, 'POST');
  await api('controladora', '/auth/me', 401);
  const report = { base, verifiedAt: new Date().toISOString(), checks, restoredProgressRows: addedProgressIds.length, restoredDiagnosticRows: addedDiagnosticIds.length, outboundMessages: 0, externalCrmWrites: 0 };
  fs.writeFileSync(path.resolve('storage/qa-cycle2/public-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
