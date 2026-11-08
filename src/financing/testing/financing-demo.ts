/** Harness local del flujo completo: nunca se importa desde AppModule. */
import { financingTestPrisma } from './financing-test-harness';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../../ai/llm/llm.service';
import { KnowledgeService } from '../../ai/knowledge/knowledge.service';
import { WhatsappSenderService } from '../../messaging/whatsapp-sender.service';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
async function main() {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Harness exclusivo de NODE_ENV=test');
  const prisma = financingTestPrisma(); // falla antes de escribir si no es base/Redis local aislado
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    POSTGRES_USER: 'trimia020',
    POSTGRES_PASSWORD: 'local020',
    POSTGRES_DB: 'trimia_020_test',
    GOOGLE_API_KEY: 'fixture-no-network',
    GEMINI_MODEL: 'gemini-3.5-flash-lite',
    EMBEDDING_MODEL: 'gemini-embedding-001',
    CHROMA_URL: 'http://127.0.0.1:59998',
    N8N_BASE_URL: 'http://127.0.0.1:59999',
    N8N_WEBHOOK_SECRET: 'fixture-020-secret-never-production-000',
    KNOWLEDGE_ADMIN_SECRET: 'fixture-020-knowledge-never-production',
    JWT_SECRET: 'fixture-020-jwt-never-production-0000',
    FINANCING_NOTICE_TRANSPORT: 'simulated',
  });
  let sector = await prisma.sector.findFirst({
    where: { name: 'Administración demo 020' },
  });
  if (!sector)
    sector = await prisma.sector.create({
      data: { name: 'Administración demo 020', agentType: 'ADMIN' },
    });
  const sectors = await prisma.sector.findMany({ select: { id: true } });
  const email = 'financing.supervisor@example.invalid';
  const password = 'Demo020-local';
  await prisma.employee.upsert({
    where: { email },
    create: {
      name: 'Supervisor Demo 020',
      phone: '5490000000020',
      email,
      password: await bcrypt.hash(password, 10),
      role: 'SUPERVISOR',
      sectorId: sector.id,
      areasSupervisadas: { connect: sectors },
    },
    update: { areasSupervisadas: { set: sectors } },
  });
  await prisma.$disconnect();
  const { AppModule } = await import('../../app.module');
  const llm = new LlmService(
    new ConfigService({
      GOOGLE_API_KEY: 'fixture-no-network',
      GEMINI_MODEL: process.env.GEMINI_MODEL,
    }),
  );
  (llm as any).classifierChat = {
    withStructuredOutput: () => ({
      invoke: async (messages: any[]) => {
        const text = String(messages[messages.length - 1][1] ?? '');
        const intent = /cancelar/i.test(text)
          ? 'CANCEL'
          : /^(confirmo|sí|si)\b/i.test(text)
            ? 'CONFIRM'
            : /quiero.*(financi|cuotas)/i.test(text)
              ? 'REQUEST'
              : 'PROVIDE_DATA';
        const out: any = { intent };
        for (const [key, pattern] of Object.entries({
          name: /Nombre:\s*([^;]+)/i,
          dni: /DNI:\s*(\d{7,8})/i,
          productSummary: /Producto:\s*([^;]+)/i,
        })) {
          const value = text.match(pattern)?.[1]?.trim();
          if (value) out[key] = { value, evidence: value };
        }
        return out;
      },
    }),
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LlmService)
    .useValue(llm)
    .overrideProvider(KnowledgeService)
    .useValue({ onModuleInit: async () => undefined, search: async () => [] })
    .overrideProvider(WhatsappSenderService)
    .useValue({
      send: async () => undefined,
      sendTemplate: async () => undefined,
    })
    .compile();
  const app = module.createNestApplication({ logger: ['error', 'warn'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(3014, '127.0.0.1');
  console.log(
    `Harness 020 listo solo en http://127.0.0.1:3014; usuario ficticio ${email}, contraseña ${password}. LLM/RAG/canal controlados sin red externa; CRM apunta a puerto local inactivo para probar recuperación.`,
  );
}
if (require.main === module)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
