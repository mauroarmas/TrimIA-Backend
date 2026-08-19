/**
 * Normaliza los teléfonos ya guardados a la forma canónica (549 + 10 dígitos).
 *
 * Es OBLIGATORIO correrlo junto con el cableado de `normalizePhone()` en los
 * servicios: si se normaliza la búsqueda pero no lo almacenado, se rompen los
 * matches que hoy funcionan.
 *
 *   npx ts-node prisma/normalize-phones.ts            → dry-run, no escribe
 *   npx ts-node prisma/normalize-phones.ts --apply    → aplica los cambios
 *
 * `Employee.phone` y `Client.phone` son UNIQUE, así que normalizar puede
 * generar colisiones (dos filas distintas que convergen al mismo número). El
 * dry-run las reporta y `--apply` se niega a correr mientras existan: hay que
 * resolverlas a mano, porque cuál fila sobrevive es una decisión de negocio,
 * no algo que este script deba adivinar.
 */
import { PrismaClient } from '@prisma/client';
import { analyzePhone } from '../src/common/phone';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface Change {
  table: string;
  id: string;
  label: string;
  from: string;
  to: string;
}

interface Skipped {
  table: string;
  label: string;
  value: string;
  reason: string;
}

function classify(
  table: string,
  rows: { id: string; phone: string; label: string }[],
  changes: Change[],
  skipped: Skipped[],
) {
  for (const row of rows) {
    const result = analyzePhone(row.phone);

    if (!result.canonical) {
      skipped.push({
        table,
        label: row.label,
        value: row.phone,
        reason: result.reason ?? 'sin motivo',
      });
      continue;
    }
    if (result.phone === row.phone) continue;

    changes.push({
      table,
      id: row.id,
      label: row.label,
      from: row.phone,
      to: result.phone,
    });
  }
}

/** Dos filas distintas que quedarían con el mismo teléfono. */
function findCollisions(
  changes: Change[],
  current: { id: string; phone: string; label: string }[],
  table: string,
) {
  const collisions: string[] = [];
  const target = new Map<string, string[]>();

  // Estado final: las que no cambian conservan su teléfono.
  const changedIds = new Set(
    changes.filter((c) => c.table === table).map((c) => c.id),
  );
  for (const row of current) {
    if (!changedIds.has(row.id)) {
      target.set(row.phone, [...(target.get(row.phone) ?? []), row.label]);
    }
  }
  for (const c of changes.filter((c) => c.table === table)) {
    target.set(c.to, [...(target.get(c.to) ?? []), c.label]);
  }

  for (const [phone, labels] of target) {
    if (labels.length > 1) {
      collisions.push(`${table} · ${phone} ← ${labels.join('  +  ')}`);
    }
  }
  return collisions;
}

async function main() {
  const employees = (
    await prisma.employee.findMany({
      select: {
        id: true,
        phone: true,
        name: true,
        email: true,
        isActive: true,
      },
    })
  ).map((e) => ({
    id: e.id,
    phone: e.phone,
    label: `${e.name} <${e.email}>${e.isActive ? '' : ' [inactivo]'}`,
  }));

  const clients = (
    await prisma.client.findMany({
      select: { id: true, phone: true, name: true },
    })
  ).map((c) => ({ id: c.id, phone: c.phone, label: c.name }));

  const conversations = (
    await prisma.conversation.findMany({
      select: { id: true, externalId: true, channel: true, status: true },
    })
  ).map((c) => ({
    id: c.id,
    phone: c.externalId,
    label: `${c.channel} · ${c.status}`,
  }));

  const changes: Change[] = [];
  const skipped: Skipped[] = [];

  classify('Employee', employees, changes, skipped);
  classify('Client', clients, changes, skipped);
  classify('Conversation', conversations, changes, skipped);

  const collisions = [
    ...findCollisions(changes, employees, 'Employee'),
    ...findCollisions(changes, clients, 'Client'),
  ];

  console.log(
    `\n${APPLY ? '⚙️  APLICANDO' : '🔍 DRY-RUN (no escribe nada)'}\n`,
  );

  console.log(`── Cambios (${changes.length}) ──`);
  if (!changes.length) console.log('  (ninguno: todo ya está canónico)');
  for (const c of changes) {
    console.log(
      `  ${c.table.padEnd(13)} ${c.from.padEnd(14)} → ${c.to}   ${c.label}`,
    );
  }

  console.log(`\n── Sin tocar (${skipped.length}) ──`);
  if (!skipped.length) console.log('  (ninguno)');
  for (const s of skipped) {
    console.log(
      `  ${s.table.padEnd(13)} ${s.value.padEnd(14)} ${s.label}\n${' '.repeat(16)}↳ ${s.reason}`,
    );
  }

  console.log(`\n── Colisiones con el índice UNIQUE (${collisions.length}) ──`);
  if (!collisions.length) console.log('  (ninguna)');
  for (const c of collisions) console.log(`  ⚠️  ${c}`);

  if (!APPLY) {
    console.log(
      '\nPara aplicar: npx ts-node prisma/normalize-phones.ts --apply\n',
    );
    return;
  }

  if (collisions.length) {
    console.error(
      '\n❌ Hay colisiones con el índice UNIQUE. Resolvelas a mano antes de aplicar.\n',
    );
    process.exit(1);
  }

  await prisma.$transaction(
    changes.map((c) =>
      c.table === 'Employee'
        ? prisma.employee.update({ where: { id: c.id }, data: { phone: c.to } })
        : c.table === 'Client'
          ? prisma.client.update({ where: { id: c.id }, data: { phone: c.to } })
          : prisma.conversation.update({
              where: { id: c.id },
              data: { externalId: c.to },
            }),
    ),
  );

  console.log(`\n✅ ${changes.length} filas actualizadas.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
