import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3000),

        DATABASE_URL: Joi.string().required(),
        POSTGRES_USER: Joi.string().required(),
        POSTGRES_PASSWORD: Joi.string().required(),
        POSTGRES_DB: Joi.string().required(),
        POSTGRES_SAVER_POOL_MAX: Joi.number().default(5),

        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.number().default(6379),

        GOOGLE_API_KEY: Joi.string().required(),
        GEMINI_MODEL: Joi.string().default('gemini-3.5-flash-lite'),
        EMBEDDING_MODEL: Joi.string().default('gemini-embedding-001'),

        CHROMA_URL: Joi.string().uri().required(),

        N8N_WEBHOOK_SECRET: Joi.string().min(32).required(),
        N8N_BASE_URL: Joi.string().uri().required(),
        // Secreto propio para /knowledge (ingesta + búsqueda, incluye
        // INTERNO): antes compartía N8N_WEBHOOK_SECRET con el webhook de
        // WhatsApp. Si ese secreto se filtra (ej. queda en un log o en un
        // export de n8n), no debería alcanzar también para volcar todo el
        // conocimiento confidencial — son superficies de riesgo distintas.
        KNOWLEDGE_ADMIN_SECRET: Joi.string().min(32).required(),

        RAG_CONFIDENCE_THRESHOLD: Joi.number().min(0).max(1).default(0.65),

        JWT_SECRET: Joi.string().min(32).required(),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
  ],
})
export class AppConfigModule {}
