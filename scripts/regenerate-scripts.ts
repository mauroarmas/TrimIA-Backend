import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TrainingService } from '../src/training/training.service';
import { PrismaService } from '../src/database/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const trainingService = app.get(TrainingService);
  const prisma = app.get(PrismaService);

  const supervisor = await prisma.employee.findFirst({
    where: { role: 'SUPERVISOR' },
  });

  if (!supervisor) {
    console.error('No se encontró supervisor');
    await app.close();
    return;
  }

  const pills = await prisma.pill.findMany({
    include: { module: { include: { sector: true } } },
  });

  for (const pill of pills) {
    console.log(`\n======================================================`);
    console.log(`Generando guion a 2 voces para: ${pill.title} (${pill.id})`);
    try {
      const script = await trainingService.generatePillAudioScript(supervisor.id, pill.id);
      console.log(`✓ Guion generado exitosamente: "${script.title}"`);
      console.log(`✓ Duración estimada: ${script.estimatedDurationSeconds} segundos`);
      console.log(`✓ Turnos de diálogo (${script.dialogue.length}):`);
      for (const line of script.dialogue) {
        console.log(`   [${line.speaker}]: ${line.text}`);
      }
    } catch (err) {
      console.error(`✗ Error generando guion para ${pill.id}:`, err);
    }
  }

  await app.close();
}

bootstrap().catch(console.error);
