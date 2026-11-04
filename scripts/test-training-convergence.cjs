// Prueba de persistencia sobre la base aislada; nunca toma DATABASE_URL del entorno.
process.chdir(require('node:path').resolve(__dirname, '..'));
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { TrainingService } = require('../src/training/training.service');

const url = 'postgresql://converge:converge_test_only@127.0.0.1:5543/trimia_convergence_test';
const prisma = new PrismaClient({ datasources: { db: { url } } });
const tag = randomUUID();
const quiz = [1, 2].map((id) => ({ id, question: 'Pregunta ' + id, options: ['Correcta', 'Otra', 'Tercera'], correctOptionIndex: 0, explanation: 'Según el procedimiento.' }));
const proposal = { title: 'Comprobantes aislados', objective: 'Recibir comprobantes', content: [1, 2, 3].map((n) => '### Paso ' + n + ': Revisar\n\nRevisar según el procedimiento.').join('\n\n'), quiz };
let employee;
let supervisor;
let moduleRecord;
let sector;

async function run() {
  const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;
  assert.equal(name, 'trimia_convergence_test');
  sector = await prisma.sector.create({ data: { name: 'Convergencia ' + tag, agentType: 'COLLECTIONS' } });
  employee = await prisma.employee.create({ data: { phone: 'test-' + tag, email: tag + '@isolated.invalid', name: 'Empleado de prueba aislada', password: 'not-a-login-hash', sectorId: sector.id } });
  supervisor = await prisma.employee.create({ data: { phone: 'sup-' + tag, email: 'sup-' + tag + '@isolated.invalid', name: 'Supervisor de prueba aislada', password: 'not-a-login-hash', role: 'SUPERVISOR', sectorId: sector.id } });
  moduleRecord = await prisma.trainingModule.create({ data: { title: 'Prueba aislada ' + tag, sectorId: sector.id } });
  const knowledge = { assertPuedeEscribir: async () => {}, ingest: async () => ({ documentId: 'isolated', similarDocuments: [] }) };
  const service = new TrainingService(prisma, knowledge, { generatePillProposal: async () => proposal }, { deleteAudio: async () => true }, {});
  const draft = await service.generatePillDraft(supervisor.id, { moduleId: moduleRecord.id, topic: 'Comprobantes' });
  await assert.rejects(service.getEmployeePill(employee.id, draft.id));
  await service.updatePill(supervisor.id, draft.id, { title: 'Revisado' });
  await service.publishPill(supervisor.id, draft.id, { indexInKnowledge: true });
  const audits = await prisma.pillAudit.findMany({ where: { pillId: draft.id }, orderBy: { version: 'asc' } });
  assert.deepEqual(audits.map((x) => x.action), ['CREATED', 'EDITED', 'PUBLISHED']);
  assert.deepEqual(audits.map((x) => x.version), [1, 2, 3]);
  assert(audits.every((x) => x.actorId === supervisor.id));
  const second = await prisma.pill.create({ data: { ...proposal, moduleId: moduleRecord.id, status: 'PUBLISHED', orderIndex: 1 } });
  await assert.rejects(service.verifyQuiz(employee.id, second.id, [0, 0]));
  await service.verifyQuiz(employee.id, draft.id, [1, 0]);
  const passed = await service.verifyQuiz(employee.id, draft.id, [0, 0]);
  assert.equal(passed.nextPillId, second.id);
  const before = await prisma.employeeProgress.findUnique({ where: { employeeId_pillId: { employeeId: employee.id, pillId: draft.id } } });
  assert.equal(before.attempts, 2);
  const [one, two] = await Promise.all([service.getDiagnosticQuestions(employee.id), service.getDiagnosticQuestions(employee.id)]);
  assert.deepEqual(one, two);
  assert(!JSON.stringify(one).includes('correctOptionIndex'));
  assert.equal(await prisma.diagnosticSession.count({ where: { activeKey: employee.id } }), 1);
  const answers = one.questions.map((q) => ({ pillId: q.pillId, questionId: q.questionId, selectedOptionIndex: 0 }));
  await assert.rejects(service.submitDiagnostic(employee.id, { answers: answers.slice(0, 1) }));
  const submissions = await Promise.allSettled([service.submitDiagnostic(employee.id, { answers }), service.submitDiagnostic(employee.id, { answers })]);
  assert.equal(submissions.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(submissions.filter((x) => x.status === 'rejected').length, 1);
  const history = await service.getSupervisorEmployeeDiagnostic(supervisor.id, employee.id);
  assert.equal(history.lastSession.answers.length, answers.length);
  await service.resetEmployeeDiagnostic(supervisor.id, employee.id);
  assert.equal((await prisma.employeeProgress.findUnique({ where: { employeeId_pillId: { employeeId: employee.id, pillId: draft.id } } })).status, 'COMPLETED');
  assert.equal((await prisma.employeeProgress.findUnique({ where: { employeeId_pillId: { employeeId: employee.id, pillId: second.id } } })).status, 'NOT_STARTED');
  await service.getDiagnosticQuestions(employee.id);
  const failedPrisma = new Proxy(prisma, { get(target, property) {
    if (property === '$transaction') return (callback) => target.$transaction((tx) => callback(new Proxy(tx, { get(client, key) {
      if (key === 'employeeProgress') return { ...client.employeeProgress, findUnique: client.employeeProgress.findUnique.bind(client.employeeProgress), upsert: async () => { throw new Error('Fallo de escritura controlado'); } };
      return client[key];
    } })));
    return target[property];
  } });
  const failingService = new TrainingService(failedPrisma, knowledge, {}, {}, {});
  await assert.rejects(failingService.submitDiagnostic(employee.id, { answers }), /Fallo de escritura controlado/);
  const current = await prisma.diagnosticSession.findFirst({ where: { activeKey: employee.id } });
  assert.equal(current.completedAt, null);
  assert.equal(current.correctAnswers, 0);
  await service.archivePill(supervisor.id, second.id);
  assert.equal((await prisma.employeeProgress.findUnique({ where: { employeeId_pillId: { employeeId: employee.id, pillId: draft.id } } })).attempts, 2);
  console.log('OK: auditoría, permisos, quiz, entrega completa, concurrencia, reinicio e integridad transaccional en base aislada.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (moduleRecord) await prisma.trainingModule.delete({ where: { id: moduleRecord.id } });
  for (const user of [employee, supervisor]) if (user) await prisma.employee.delete({ where: { id: user.id } });
  if (sector) await prisma.sector.delete({ where: { id: sector.id } });
  await prisma.$disconnect();
});
