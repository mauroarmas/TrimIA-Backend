import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Logger estructurado (pino) — reemplaza el logger por defecto de NestJS
  app.useLogger(app.get(Logger));
  const settings = app.get(ConfigService);
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', settings.get<number>('TRUST_PROXY_HOPS'));

  // Validación global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const origins = settings
    .get<string>('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length
      ? origins
      : settings.get('NODE_ENV') !== 'production',
  });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('TrimIA API')
    .setDescription('Backend de agentes IA para empresas comerciales')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
