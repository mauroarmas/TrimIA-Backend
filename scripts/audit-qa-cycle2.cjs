// Auditoría de solo lectura. Ejecutar con el entorno del backend seleccionado.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const [employees, clients, modules, invalidProofs] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, name: true, email: true, phone: true, isActive: true, role: true, isController: true, areasSupervisadas: { select: { name: true, agentType: true } } } }),
    prisma.client.findMany({ select: { id: true, name: true, phone: true } }),
    prisma.trainingModule.findMany({ select: { id: true, title: true, isActive: true, sectorId: true, pills: { select: { id: true, status: true, audioStatus: true } } } }),
    prisma.paymentProof.findMany({
      where: { status: 'ACCEPTED', OR: [{ extractedAmount: { lte: 0 } }, { extractedAmount: null }] },
      select: { id: true, extractedAmount: true, impactStatus: true, quotaId: true },
    }),
  ]);
  const normalizePhone = (phone) => String(phone).replace(/\D/g, '');
  const collisions = clients.flatMap((client) => employees
    .filter((employee) => normalizePhone(employee.phone) === normalizePhone(client.phone))
    .map((employee) => ({ client, employee })));
  const byName = new Map();
  for (const client of clients) {
    const key = client.name.trim().toLocaleLowerCase('es-AR');
    byName.set(key, [...(byName.get(key) ?? []), client]);
  }
  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    employeeClientPhoneCollisions: collisions,
    repeatedClientNames: [...byName.values()].filter((group) => group.length > 1),
    inactiveLoginTest: employees.find((employee) => employee.email === 'test.supervisor2@credimision.com') ?? null,
    fixturePermissions: employees.filter((employee) => ['diego.bazan@credimision.com', 'silvia.rios@credimision.com', 'marisa.paz@credimision.com'].includes(employee.email)),
    trainingModules: modules,
    acceptedProofsWithInvalidAmount: invalidProofs,
  }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
