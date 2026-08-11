import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WebhookSecretGuard } from './webhook-secret.guard';

/**
 * Fix de seguridad (2026-08-11): antes, /messaging/webhook y /knowledge
 * compartían el mismo N8N_WEBHOOK_SECRET — quien lo tuviera podía suplantar
 * cualquier teléfono (incluido un empleado) O volcar todo el conocimiento
 * INTERNO por /knowledge/search. Ahora WebhookSecretGuard lee la variable de
 * entorno según @WebhookSecretEnv() (default: N8N_WEBHOOK_SECRET), así que
 * cada superficie tiene su propio secreto.
 */
describe('WebhookSecretGuard', () => {
  function buildContext(headerValue?: string, metadataEnvVar?: string) {
    const request = {
      headers: headerValue !== undefined ? { 'x-n8n-secret': headerValue } : {},
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(metadataEnvVar),
    } as unknown as Reflector;

    return { context, reflector };
  }

  it('acepta cuando el header coincide con N8N_WEBHOOK_SECRET (default, sin decorador)', () => {
    const config = { get: jest.fn().mockReturnValue('el-secreto-correcto') };
    const { context, reflector } = buildContext('el-secreto-correcto');
    const guard = new WebhookSecretGuard(config as any, reflector);

    expect(guard.canActivate(context)).toBe(true);
    expect(config.get).toHaveBeenCalledWith('N8N_WEBHOOK_SECRET');
  });

  it('usa la variable de entorno que indica @WebhookSecretEnv en vez del default', () => {
    const config = { get: jest.fn().mockReturnValue('secreto-de-knowledge') };
    const { context, reflector } = buildContext(
      'secreto-de-knowledge',
      'KNOWLEDGE_ADMIN_SECRET',
    );
    const guard = new WebhookSecretGuard(config as any, reflector);

    expect(guard.canActivate(context)).toBe(true);
    expect(config.get).toHaveBeenCalledWith('KNOWLEDGE_ADMIN_SECRET');
  });

  it('rechaza si falta el header', () => {
    const config = { get: jest.fn().mockReturnValue('el-secreto-correcto') };
    const { context, reflector } = buildContext(undefined);
    const guard = new WebhookSecretGuard(config as any, reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rechaza si el header no coincide con el secreto esperado', () => {
    const config = { get: jest.fn().mockReturnValue('el-secreto-correcto') };
    const { context, reflector } = buildContext('otro-valor-cualquiera');
    const guard = new WebhookSecretGuard(config as any, reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rechaza si la variable de entorno esperada no está configurada', () => {
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const { context, reflector } = buildContext('cualquier-valor');
    const guard = new WebhookSecretGuard(config as any, reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('un secreto correcto para el webhook NO sirve para la variable de knowledge (superficies separadas)', () => {
    // Simula: el atacante tiene el secreto del webhook y prueba usarlo
    // contra una ruta protegida con KNOWLEDGE_ADMIN_SECRET.
    const config = {
      get: jest.fn((envVar: string) =>
        envVar === 'N8N_WEBHOOK_SECRET' ? 'secreto-webhook' : 'secreto-knowledge-distinto',
      ),
    };
    const { context, reflector } = buildContext(
      'secreto-webhook',
      'KNOWLEDGE_ADMIN_SECRET',
    );
    const guard = new WebhookSecretGuard(config as any, reflector);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
