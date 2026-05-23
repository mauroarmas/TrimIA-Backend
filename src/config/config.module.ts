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
        GEMINI_MODEL: Joi.string().default('gemini-3.1-flash-lite'),

        CHROMA_URL: Joi.string().uri().required(),

        N8N_WEBHOOK_SECRET: Joi.string().required(),
        N8N_BASE_URL: Joi.string().uri().required(),

        RAG_CONFIDENCE_THRESHOLD: Joi.number().min(0).max(1).default(0.7),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
  ],
})
export class AppConfigModule {}
