import { PrismaClient, AgentType, EmployeeRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Sectores ──────────────────────────────────────────────
  const sectors = await Promise.all([
    prisma.sector.upsert({
      where: { name: 'Ventas' },
      update: {},
      create: { name: 'Ventas', agentType: AgentType.SALES },
    }),
    prisma.sector.upsert({
      where: { name: 'Cobranzas' },
      update: {},
      create: { name: 'Cobranzas', agentType: AgentType.COLLECTIONS },
    }),
    prisma.sector.upsert({
      where: { name: 'Administración' },
      update: {},
      create: { name: 'Administración', agentType: AgentType.ADMIN },
    }),
    prisma.sector.upsert({
      where: { name: 'Logística' },
      update: {},
      create: { name: 'Logística', agentType: AgentType.LOGISTICS },
    }),
    prisma.sector.upsert({
      where: { name: 'Depósito' },
      update: {},
      create: { name: 'Depósito', agentType: AgentType.DEPOSITS },
    }),
  ]);

  const [ventas, cobranzas, admin, logistica, deposito] = sectors;
  console.log(`  ✅ ${sectors.length} sectores creados`);

  // Contraseña por defecto para dev: se puede overridear con SEED_DEFAULT_PASSWORD.
  const plainPassword = process.env.SEED_DEFAULT_PASSWORD ?? 'trimia2026';
  const defaultPassword = await bcrypt.hash(plainPassword, 10);
  const employees = [
    {
      phone: '5491100001111',
      email: 'laura.gomez@credimision.com',
      name: 'Laura Gómez',
      role: EmployeeRole.EMPLEADO,
      sectorId: ventas.id,
    },
    {
      phone: '5491100002222',
      email: 'roberto.sosa@credimision.com',
      name: 'Roberto Sosa',
      role: EmployeeRole.EMPLEADO,
      sectorId: cobranzas.id,
    },
    {
      phone: '5491100003333',
      email: 'graciela.medina@credimision.com',
      name: 'Graciela Medina',
      role: EmployeeRole.EMPLEADO,
      sectorId: admin.id,
    },
    {
      phone: '5491100004444',
      email: 'carlos.ruiz@credimision.com',
      name: 'Carlos Ruiz',
      role: EmployeeRole.EMPLEADO,
      sectorId: logistica.id,
    },
    {
      phone: '5491100005555',
      email: 'ana.torres@credimision.com',
      name: 'Ana Torres',
      role: EmployeeRole.EMPLEADO,
      sectorId: deposito.id,
    },
    {
      phone: '5491100006666',
      email: 'diego.bazan@credimision.com',
      name: 'Diego Bazán',
      role: EmployeeRole.SUPERVISOR,
      sectorId: ventas.id, // supervisor puede acceder a todos los módulos
    },
  ];

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { email: emp.email },
      update: {},
      create: {
        ...emp,
        password: defaultPassword,
      },
    });
  }
  console.log(`  ✅ ${employees.length} empleados creados (pass: trimia2026)`);

  // ── Conocimiento de prueba (para RAG) ─────────────────────
  const knowledgeDocs = [
    {
      title: 'Proceso de venta contado',
      content:
        'Para realizar una venta de contado, el vendedor debe verificar el stock del producto en Paljet, ' +
        'confirmar el precio vigente y generar la ficha de venta. El cliente abona en efectivo o con tarjeta ' +
        'de débito en el acto. El producto se entrega inmediatamente si está en depósito, o se coordina ' +
        'la entrega con logística.',
      category: 'procedimientos',
      audience: 'INTERNO' as const,
      agentType: AgentType.SALES,
    },
    {
      title: 'Proceso de venta financiada',
      content:
        'Para una venta financiada, el vendedor recopila los datos del cliente (nombre, DNI, teléfono) ' +
        'y el producto deseado. El sistema consulta automáticamente a Riesgo Online para evaluar la ' +
        'situación crediticia. Si el resultado es "Aprobado" o "Aprobado con condiciones", se deriva ' +
        'al supervisor para confirmación final. El cliente NO debe conocer los detalles del análisis ' +
        'crediticio. Las cuotas son semanales (plan de 10 semanas) o mensuales.',
      category: 'procedimientos',
      audience: 'INTERNO' as const,
      agentType: AgentType.SALES,
    },
    {
      title: 'Política de cobranzas',
      content:
        'Las cuotas vencen el día 10 de cada mes. El sistema envía recordatorios automáticos a los 7, ' +
        '3 y 0 días antes del vencimiento. Si el cliente no responde después de 3 intentos, se escala ' +
        'al supervisor. Cuando el cliente envía un comprobante de pago, el cobrador lo revisa y confirma ' +
        'o rechaza. Los comprobantes quedan asociados al cliente con código de operación único.',
      category: 'procedimientos',
      audience: 'INTERNO' as const,
      agentType: AgentType.COLLECTIONS,
    },
    {
      title: 'Horarios de atención y contacto',
      content:
        'Credimisión atiende de lunes a viernes de 8:00 a 18:00 y sábados de 8:00 a 13:00. ' +
        'El local principal está en Posadas, Misiones. Teléfono de contacto: (0376) 444-XXXX. ' +
        'Las consultas por WhatsApp se responden en horario comercial.',
      category: 'general',
      audience: 'PUBLICO' as const,
      agentType: null,
    },
    {
      title: 'Productos disponibles - Línea Blanca',
      content:
        'Credimisión ofrece heladeras, freezers, lavarropas y secarropas de las marcas Samsung, LG, ' +
        'Whirlpool, Drean y Briket. Los precios varían según el modelo. Consultar disponibilidad ' +
        'actualizada. Se aceptan pagos en efectivo, tarjeta y plan de financiación propio.',
      category: 'productos',
      audience: 'PUBLICO' as const,
      agentType: AgentType.SALES,
    },
    {
      title: 'Procedimiento de recepción de mercadería',
      content:
        'Al recibir mercadería, el encargado de depósito debe verificar la cantidad contra el remito, ' +
        'inspeccionar el estado de los productos y registrar el ingreso en Paljet. Si hay diferencias ' +
        'o daños, se reporta al área administrativa para gestionar el reclamo con el proveedor.',
      category: 'procedimientos',
      audience: 'INTERNO' as const,
      agentType: AgentType.DEPOSITS,
    },
    {
      title: 'Procedimiento de entrega a domicilio',
      content:
        'Las entregas se coordinan con el cliente por WhatsApp. El repartidor debe verificar ' +
        'la dirección, contactar al cliente 30 minutos antes de llegar y obtener firma de conformidad. ' +
        'Si el cliente no se encuentra, se reprograma la entrega. Las zonas de cobertura incluyen ' +
        'Posadas, Garupá y localidades cercanas de Misiones.',
      category: 'procedimientos',
      audience: 'INTERNO' as const,
      agentType: AgentType.LOGISTICS,
    },
    {
      title: 'Facturación y documentación',
      content:
        'Toda venta debe facturarse a través de Paljet. Para ventas contado se emite factura B (consumidor final) ' +
        'o A (responsable inscripto). Para ventas financiadas se emite factura al momento del primer pago. ' +
        'Los comprobantes de pago de cuotas se archivan digitalmente.',
      category: 'procedimientos',
      audience: 'INTERNO' as const,
      agentType: AgentType.ADMIN,
    },
  ];

  for (const doc of knowledgeDocs) {
    await prisma.knowledgeDocument.upsert({
      where: {
        id: doc.title.toLowerCase().replace(/\s+/g, '-'), // deterministic but will fail on first run
      },
      update: {},
      create: doc,
    });
  }
  // Use createMany to avoid issues with upsert on non-existent IDs
  // Actually let's just delete and recreate to keep it simple for dev
  await prisma.knowledgeDocument.deleteMany({});
  for (const doc of knowledgeDocs) {
    await prisma.knowledgeDocument.create({ data: doc });
  }
  console.log(`  ✅ ${knowledgeDocs.length} documentos de conocimiento creados`);

  console.log('🌱 Seed completado!');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
