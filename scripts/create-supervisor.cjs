// Alta inicial explícita. No ejecuta el seed de desarrollo ni modifica usuarios existentes.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const { BOOTSTRAP_EMAIL: email, BOOTSTRAP_NAME: name, BOOTSTRAP_PHONE: phone,
    BOOTSTRAP_PASSWORD: password } = process.env;
  if (!email || !name || !/^549\d{10}$/.test(phone || '') || (password || '').length < 12) {
    throw new Error('Definí BOOTSTRAP_EMAIL, BOOTSTRAP_NAME, BOOTSTRAP_PHONE (549 + 10 dígitos) y BOOTSTRAP_PASSWORD (mínimo 12 caracteres).');
  }
  const hash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (db) => {
    const sectors = [];
    for (const [sectorName, agentType] of [
      ['Ventas', 'SALES'], ['Cobranzas', 'COLLECTIONS'], ['Administración', 'ADMIN'],
      ['Logística', 'LOGISTICS'], ['Depósito', 'DEPOSITS'],
    ]) {
      sectors.push(await db.sector.upsert({ where: { name: sectorName }, update: {}, create: { name: sectorName, agentType } }));
    }
    await db.employee.create({ data: {
      email, name, phone, password: hash, role: 'SUPERVISOR', sectorId: sectors[0].id,
      areasSupervisadas: { connect: sectors.map(({ id }) => ({ id })) },
    } });
  });
  console.log('Supervisor inicial creado. No se cargaron clientes ni datos de prueba.');
}
main().catch((error) => {
  console.error(error.code === 'P2002' ? 'Ya existe el email o teléfono; no se modificó ningún usuario.' : (error.code ? `No se pudo crear el supervisor (${error.code}).` : error.message));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
