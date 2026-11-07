// Carga aditiva e idempotente: no restablece progreso ni modifica registros existentes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { namespace, fixtureId, modules, salesPills, draftPill, employees, sourceFiles } = require('./fixtures/qa-cycle2.cjs');

const root = path.resolve(process.cwd(), 'storage');
const privateDir = path.join(root, 'qa-cycle2');
const flag = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const referenceDate = flag('--date') || '2026-11-02';
if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error('Fecha de referencia inválida');
const date = (days = 0) => new Date(new Date(`${referenceDate}T12:00:00Z`).getTime() + days * 86400000);
const due = (days = 0) => new Date(date(days).toISOString().slice(0, 10) + 'T00:00:00Z');
const result = { namespace, referenceDate, created: {}, existing: {}, ids: {} };
const MAX_ATTEMPTS = 2147483647; // Ningún recordatorio automático puede contactar números ficticios.

async function main() {
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'DRY_RUN', namespace, sourceFiles, modules: modules.map((module) => ({ id: module.id, title: module.title, publishedPills: module.pills.length })), employees: employees.map(({ email, name, sector, progress = 0, isActive = true, role = 'EMPLEADO' }) => ({ email, name, sector, progress, isActive, role })), operations: '5 clientes, 3 prospectos, 5 solicitudes, 4 cuotas de financiación, 6 comprobantes, 3 escalados y 2 simulaciones de ejemplo' }, null, 2));
    return;
  }
  if (flag('--target') !== 'trimia-demo.tail9126e1.ts.net') throw new Error('Especificá --target trimia-demo.tail9126e1.ts.net para la carga autorizada de QA.');
  const audio = JSON.parse(fs.readFileSync(path.join(privateDir, 'audio-metadata.json'), 'utf8'));
  for (const module of modules) for (const pill of module.pills) {
    const file = fs.readFileSync(path.join(root, 'audio', pill.id + '.mp3'));
    if (!audio[pill.id] || createHash('sha256').update(file).digest('hex') !== audio[pill.id].sha256) throw new Error(`Audio no verificado para ${pill.title}`);
  }
  for (const key of ['valido', 'cero', 'insuficiente', 'aceptado', 'rechazado', 'manual']) {
    if (!fs.existsSync(path.join(root, 'payment-proofs', `qa-ciclo2-${key}.png`))) throw new Error('Falta imagen QA: ' + key);
  }
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDir, 0o700);
  const credentialsPath = path.join(privateDir, 'credentials.json');
  const credentials = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) : { namespace, password: randomBytes(18).toString('base64url'), accounts: [] };
  if (credentials.namespace !== namespace) throw new Error('Credenciales de otro conjunto de datos; se preservaron sin cambios.');
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  fs.chmodSync(credentialsPath, 0o600);
  const passwordHash = await bcrypt.hash(credentials.password, 10);
  const prisma = new PrismaClient();
  try {
    const sectors = await prisma.sector.findMany();
    const sector = Object.fromEntries(sectors.map((item) => [item.name, item.id]));
    const roberto = await prisma.employee.findUnique({ where: { email: 'roberto.sosa@credimision.com' } });
    const laura = await prisma.employee.findUnique({ where: { email: 'laura.gomez@credimision.com' } });
    if (!roberto?.isActive || !laura?.isActive || modules.some((module) => !sector[module.sector])) throw new Error('Faltan usuarios base o sectores. No se cambió la base.');
    // Evita reutilizar un correo o teléfono ajeno para una identidad sintética.
    for (const employee of employees) {
      const expectedId = fixtureId('employee:' + employee.key);
      const collision = await prisma.employee.findFirst({ where: { OR: [{ email: employee.email }, { phone: employee.phone }] } });
      if (collision && collision.id !== expectedId) throw new Error(`Ya existe una cuenta ajena al fixture: ${employee.email}. Se preservó.`);
      if (!sector[employee.sector] || employee.areas?.some((area) => !sector[area])) throw new Error('Sector desconocido para ' + employee.email);
    }

    await prisma.$transaction(async (db) => {
      async function create(model, key, data) {
        const id = data.id || fixtureId(`${model}:${key}`);
        const existing = await db[model].findUnique({ where: { id } });
        const kind = existing ? 'existing' : 'created';
        result[kind][model] = (result[kind][model] || 0) + 1;
        if (existing) return existing;
        return db[model].create({ data: { ...data, id } });
      }
      const accounts = {};
      for (const employee of employees) {
        const account = await create('employee', employee.key, {
          id: fixtureId('employee:' + employee.key), email: employee.email, name: employee.name, phone: employee.phone,
          sectorId: sector[employee.sector], role: employee.role || 'EMPLEADO', isActive: employee.isActive !== false,
          isController: employee.isController || false, password: passwordHash,
          createdAt: date(-3),
          ...(employee.areas ? { areasSupervisadas: { connect: employee.areas.map((name) => ({ id: sector[name] })) } } : {}),
        });
        accounts[employee.key] = account;
      }
      for (const module of modules) {
        await create('trainingModule', module.id, { id: module.id, title: module.title, description: module.description, sectorId: sector[module.sector], orderIndex: module.orderIndex, createdAt: date(-3) });
        for (const item of module.pills) {
          await create('pill', item.id, {
            id: item.id, moduleId: module.id, title: item.title, objective: item.objective, content: item.content,
            quiz: item.quiz, orderIndex: item.orderIndex, status: 'PUBLISHED', createdAt: date(-2), publishedAt: date(-1),
            audioStatus: 'AUDIO_READY', audioScript: { ...item.audioScript, estimatedDurationSeconds: audio[item.id].durationSeconds },
            audioUrl: '/app/storage/audio/' + item.id + '.mp3', audioDurationSeconds: audio[item.id].durationSeconds, audioGeneratedAt: date(-1),
          });
        }
      }
      await create('pill', draftPill.id, { ...draftPill, moduleId: modules[0].id, status: 'DRAFT' });
      for (const employee of employees.filter((item) => item.progress > 0)) {
        for (const item of salesPills.slice(0, employee.progress)) {
          const where = { employeeId_pillId: { employeeId: accounts[employee.key].id, pillId: item.id } };
          const existing = await db.employeeProgress.findUnique({ where });
          if (existing) { result.existing.employeeProgress = (result.existing.employeeProgress || 0) + 1; continue; }
          await db.employeeProgress.create({ data: { employeeId: accounts[employee.key].id, pillId: item.id, status: 'COMPLETED', attempts: 1, lastAnswers: item.quiz.map((q) => q.correctOptionIndex), completedAt: date(), isAudioCompleted: true, playbackProgressSeconds: audio[item.id].durationSeconds, lastPlaybackReportAt: date() } });
          result.created.employeeProgress = (result.created.employeeProgress || 0) + 1;
        }
      }

      const customers = {};
      for (const [index, [key, name, dni, collectorId]] of [
        ['pedro', 'Comercio Don Pedro', '30111222', roberto.id],
        ['nuevo', 'Cliente Prueba Uno', '30111222', roberto.id],
        ['deuda', 'Cliente Prueba Dos', '30999888', accounts.controladora.id],
        ['aldia', 'Comercio al día', '30222333', roberto.id],
        ['revision', 'Cliente para revisión manual', '30333444', roberto.id],
      ].entries()) {
        customers[key] = await create('client', key, { name: `[QA Ciclo 2] ${name}`, phone: `00000090000${index + 1}`, dni, assignedCollectorId: collectorId });
      }
      async function conversation(key, client, status = 'ACTIVE', agent = 'COLLECTIONS', extra = {}) {
        return create('conversation', key, { channel: 'WEB', externalId: `qa-ciclo2:${key}`, clientId: client.id, userType: 'CLIENTE', status, currentAgent: agent, ...extra });
      }
      async function message(key, conv, role, content, agent = 'COLLECTIONS') {
        return create('message', key, { conversationId: conv.id, role, content, agentType: agent, createdAt: date() });
      }
      const requests = [
        ['normal', customers.nuevo, 'Smart TV Samsung 55 pulgadas 4K', 1200000, 'PENDING_REVIEW', 'APPROVED', 'Ejemplo QA: situación normal. Dictamen propuesto favorable; pendiente de decisión humana.'],
        ['deuda', customers.deuda, 'Smart TV LG 50 pulgadas Full HD', 980000, 'PENDING_REVIEW', 'REJECTED', 'Ejemplo QA: evaluación propuesta desfavorable. Ofrecer contado según los procesos; datos ficticios.'],
        ['manual', customers.revision, 'Heladera comercial', 500000, 'PENDING_REVIEW', 'UNAVAILABLE', 'Ejemplo QA: servicio de evaluación no disponible; requiere revisión manual.'],
        ['aprobada', customers.pedro, 'Venta financiada de prueba, cuatro cuotas de $120.000', 480000, 'APPROVED', 'APPROVED', 'Ejemplo QA aprobado para probar cartera y cierre. No representa una decisión real.'],
        ['rechazada', customers.deuda, 'Operación de ejemplo ya rechazada', 300000, 'REJECTED', 'REJECTED', 'Estado histórico ficticio para verificar filtros y auditoría.'],
      ];
      const requestByKey = {};
      for (const [key, customer, product, amount, status, verdict, reason] of requests) {
        const conv = await conversation('solicitud:' + key, customer, 'ACTIVE', 'SALES');
        await message('solicitud:' + key, conv, 'USER', `[QA Ciclo 2] Consulto por ${product}. Este es un ejemplo ficticio para pruebas.`, 'SALES');
        const request = await create('purchaseRequest', key, { clientId: customer.id, conversationId: conv.id, productSummary: `[QA Ciclo 2] ${product}`, amount, modality: 'FINANCED', status, createdAt: date(-2), ...(status !== 'PENDING_REVIEW' ? { reviewedById: accounts.supadmin.id, reviewedAt: date(-1), reviewNote: '[QA] Estado inicial simulado por el fixture; no es una revisión humana real.' } : {}) });
        requestByKey[key] = request;
        await create('creditAssessment', key, { clientId: customer.id, purchaseRequestId: request.id, verdict, source: 'QA_SIMULADO', reason, rawPayload: { simulated: true, warning: 'Datos ficticios. No corresponde a un informe crediticio real.', internalTestMarker: 'SOLO_ADMINISTRACION_QA' } });
      }
      const financing = await create('financing', 'pedro', { purchaseRequestId: requestByKey.aprobada.id, totalAmount: 480000, quotaCount: 4, collectorId: roberto.id });
      for (const [index, [offset, status]] of [[-14, 'PAID'], [-7, 'OVERDUE'], [0, 'PENDING'], [7, 'PENDING']].entries()) {
        await create('quota', 'plan:' + index, { clientId: customers.pedro.id, financingId: financing.id, number: index + 1, amount: 120000, dueDate: due(offset), status, reminderAttempts: MAX_ATTEMPTS });
      }
      await create('quota', 'aldia', { clientId: customers.aldia.id, amount: 120000, dueDate: due(14), status: 'PENDING', reminderAttempts: MAX_ATTEMPTS });
      await create('quota', 'ajena', { clientId: customers.deuda.id, amount: 90000, dueDate: due(7), status: 'PENDING', reminderAttempts: MAX_ATTEMPTS });

      for (const [key, amount, status, quotaStatus] of [
        ['valido', 120000, 'PENDING_REVIEW', 'PENDING'], ['cero', 0, 'PENDING_REVIEW', 'PENDING'],
        ['insuficiente', 110000, 'PENDING_REVIEW', 'PENDING'], ['aceptado', 120000, 'ACCEPTED', 'AWAITING_CONFIRMATION'],
        ['rechazado', 120000, 'REJECTED', 'PENDING'], ['manual', 120000, 'MANUAL_HANDLING', 'MANUAL'],
      ]) {
        const quota = await create('quota', 'proof:' + key, { clientId: customers.pedro.id, amount: 120000, dueDate: due(3), status: quotaStatus, reminderAttempts: MAX_ATTEMPTS, ...(key === 'manual' ? { manualHandlingNote: '[QA] Manejo manual simulado.' } : {}) });
        const conv = await conversation('comprobante:' + key, customers.pedro, key === 'manual' ? 'HUMAN_HANDLING' : 'ACTIVE', 'COLLECTIONS', key === 'manual' ? { handledById: roberto.id, handledAt: date() } : {});
        const receiptMessage = await message('comprobante:' + key, conv, 'USER', `[QA Ciclo 2] Comprobante SIMULADO: ${key}. Importe ficticio $${amount}. Sin validez financiera.`);
        await create('paymentProof', key, {
          quotaId: quota.id, messageId: receiptMessage.id, imagePath: `qa-ciclo2-${key}.png`, extractedAmount: amount,
          extractedDate: new Date(`${referenceDate}T15:00:00Z`), extractedBank: 'Banco QA (ficticio)', extractedOpCode: `QA-C2-${key.toUpperCase()}`,
          status, ...(key === 'aceptado' ? { acceptedById: accounts.controladora.id, acceptedAt: date() } : {}),
          ...(key === 'rechazado' ? { rejectionReason: 'PAST_DATE' } : {}),
          ...(key === 'manual' ? { manualHandlingNote: '[QA] Estado inicial simulado para probar liberación de control.' } : {}),
          impactObservation: '[QA] Datos iniciales ficticios. No acreditan pago ni verificación real.',
        });
        await create('orchestrationEvent', 'proof:' + key, { conversationId: conv.id, eventType: 'QA_FIXTURE_CREATED', agentType: 'COLLECTIONS', payload: { simulated: true, namespace, scenario: key, note: 'Sin mensaje externo ni extracción automática.' } });
      }
      for (const [index, [name, product, modality, status, notes]] of [
        ['Valentina Herrera', 'Heladera exhibidora para almacén', 'FINANCED', 'NUEVO', 'Pidió hablar con una vendedora. Comercio: Almacén QA; presupuesto ficticio $650.000; consultar precio vigente. Próximo contacto a coordinar.'],
        ['Martín Prueba', 'Balanza comercial', 'CASH', 'EN_CONTACTO', 'Comparó opciones. Se debe confirmar disponibilidad y enviar cotización. Objeción: precio.'],
        ['Carolina Prueba', 'Horno para panadería', 'FINANCED', 'CALIFICA', 'Solicitó información por cuotas. Pendientes verificación de Administración y documentación del negocio.'],
      ].entries()) {
        await create('prospect', String(index), { name: `[QA Ciclo 2] ${name}`, phone: `00000090100${index + 1}`, comercio: 'Comercio ficticio QA', rubro: index === 2 ? 'Panadería' : 'Comercio', localidad: 'Posadas (ejemplo QA)', productInterest: product, modality, status, estimatedAmount: [650000, 350000, 435000][index], sellerId: laura.id, originChannel: 'WEB', syncStatus: 'FAILED', notes: `[QA Ciclo 2] Registro local ficticio SIN sincronizar a Google Sheets; excluido del reintento automático. ${notes}` });
      }
      for (const [agent, text] of [
        ['SALES', 'Consulta de descuento especial fuera de las condiciones documentadas.'],
        ['ADMIN', 'Consulta de documentación y criterios que debe resolver el área responsable.'],
        ['COLLECTIONS', 'Solicitud de aclaración de una cuota ficticia.'],
      ]) {
        const conv = await conversation('escalado:' + agent, customers.nuevo, 'WAITING_HUMAN', agent);
        await message('escalado:user:' + agent, conv, 'USER', `[QA Ciclo 2] ${text}`, agent);
        await message('escalado:assistant:' + agent, conv, 'ASSISTANT', 'Tu consulta de prueba pasó a un responsable. Es un caso ficticio de QA.', agent);
        await create('escalation', agent, { conversationId: conv.id, reason: `[QA Ciclo 2] [${agent}] ${text} Caso inicial simulado; no representa un cálculo de confianza del modelo.` });
      }

      for (const mode of ['GUIDED', 'FREE']) {
        const guided = mode === 'GUIDED';
        const session = await create('simulationSession', mode, {
          employeeId: accounts.practica.id, pillId: salesPills[3].id, mode, status: 'COMPLETED',
          scenarioTitle: guided ? '[QA Ciclo 2] Consulta por cuotas con verificación previa' : '[QA Ciclo 2] Consulta por cuotas sin verificar crédito',
          customerName: 'María (cliente simulada)', customerProfile: 'Ejemplo ficticio. Consulta por heladera para un almacén y pregunta por financiación.', createdAt: date(), completedAt: new Date(date().getTime() + 60000),
        });
        const transcript = guided ? [
          ['SIMULATED_CLIENT', 'Hola, necesito una heladera para mi almacén. ¿Puedo pagar en cuotas?'],
          ['EMPLOYEE', 'Hola María, soy la asesora. ¿Qué capacidad necesitás y qué presupuesto tenés?'],
          ['SIMULATED_CLIENT', 'Para bebidas, y necesito conocer las opciones de cuotas.'],
          ['EMPLOYEE', 'Voy a verificar el stock con Depósito y pedir a Administración la evaluación crediticia. La aprobación la define Créditos, no puedo prometerla.'],
        ] : [
          ['SIMULATED_CLIENT', 'Hola, quisiera una heladera en cuotas.'],
          ['EMPLOYEE', 'Hola María, ¿qué capacidad necesitás?'],
          ['SIMULATED_CLIENT', 'Una para mi almacén. ¿Me aprobarán las cuotas?'],
          ['EMPLOYEE', 'Te paso las opciones de equipos y los precios cuando estén confirmados.'],
        ];
        for (const [index, [sender, content]] of transcript.entries()) await create('simulationMessage', mode + ':' + index, { sessionId: session.id, sender, content, turnIndex: index, createdAt: new Date(date().getTime() + index * 10000) });
        await create('simulationGoal', mode, { sessionId: session.id, description: 'Solicitar verificación crediticia sin prometer aprobación', order: 0, isCompleted: guided, ...(guided ? { completedAtTurn: 3, evidence: transcript[3][1] } : {}) });
        await create('simulationFeedback', mode, { sessionId: session.id, band: guided ? 'ACHIEVED' : 'NEEDS_IMPROVEMENT', whatWentWell: 'Saludaste a la cliente e indagaste sobre la necesidad del producto.', toImprove: guided ? 'Continuar con la documentación y el registro de la próxima acción en CRM.' : 'Faltó solicitar la verificación crediticia a Administración antes de avanzar con financiación.', businessRules: 'Nunca prometer aprobaciones. Confirmar stock y precio. Pedir evaluación crediticia y documentación.', summary: '[QA Ciclo 2] Devolución de ejemplo construida sobre los mensajes guardados; no es una evaluación generada en una sesión real.' });
      }
      result.ids = { salesModule: modules[0].id, salesPills: salesPills.map((item) => item.id), firstPill: salesPills[0].id, draftPill: draftPill.id, employeeAccounts: Object.fromEntries(Object.entries(accounts).map(([key, account]) => [key, { id: account.id, email: account.email }])), clients: Object.fromEntries(Object.entries(customers).map(([key, client]) => [key, client.id])) };
    }, { maxWait: 10000, timeout: 60000 });

    credentials.accounts = employees.map((employee) => ({ email: employee.email, name: employee.name, sector: employee.sector, role: employee.role || 'EMPLEADO', isActiveInitially: employee.isActive !== false, initialCompletedPills: employee.progress || 0 }));
    fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    const guide = `# Accesos privados de QA Ciclo 2\n\nEntorno: https://trimia-demo.tail9126e1.ts.net/\n\nContraseña temporal de estas cuentas nuevas: \`${credentials.password}\`\n\nNo se cambiaron contraseñas de cuentas anteriores. No subir este archivo a Git ni publicarlo.\n\n| Cuenta | Perfil | Estado inicial | Píldoras completadas |\n| --- | --- | --- | --- |\n${credentials.accounts.map((account) => `| ${account.email} | ${account.role} · ${account.sector} | ${account.isActiveInitially ? 'Activo' : 'Inactivo'} | ${account.initialCompletedPills} |`).join('\n')}\n\nSofía: 2/6. qa.inicio: 0/6 para candados. qa.practica: 6/6 para simulación. qa.diagnostico: diagnóstico nuevo. vendedor.inactivo arranca activo para probar la baja. qa.baja ya está inactivo. gerente.prueba permite administrar empleados.\n`;
    fs.writeFileSync(path.join(privateDir, 'ACCESOS.md'), guide, { mode: 0o600 });
    fs.writeFileSync(path.join(privateDir, 'seed-result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ...result, credentials: 'storage/qa-cycle2/ACCESOS.md (privado)', outboundMessages: 0, externalCrmWrites: 0 }, null, 2));
  } finally { await prisma.$disconnect(); }
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { MAX_ATTEMPTS };
