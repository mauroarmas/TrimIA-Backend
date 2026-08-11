import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

const SECRET_ENV_KEY = 'webhookSecretEnvVar';
const DEFAULT_SECRET_ENV = 'N8N_WEBHOOK_SECRET';

/**
 * Elige qué variable de entorno valida WebhookSecretGuard en esta ruta/
 * controller. Sin este decorador, usa N8N_WEBHOOK_SECRET (el webhook de
 * WhatsApp). Cada superficie protegida con su propio secreto: si uno se
 * filtra, no habilita las demás.
 */
export const WebhookSecretEnv = (envVar: string) =>
  SetMetadata(SECRET_ENV_KEY, envVar);

/**
 * Protege endpoints internos (webhook de n8n, carga de conocimiento) con un
 * secreto compartido en el header `x-n8n-secret`.
 *
 * La comparación es de tiempo constante (timingSafeEqual) para no filtrar el
 * largo/contenido del secreto por análisis de tiempos.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const envVar =
      this.reflector.getAllAndOverride<string>(SECRET_ENV_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_SECRET_ENV;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-n8n-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    const expected = this.config.get<string>(envVar);

    if (!provided || !expected || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }

  /** Comparación de tiempo constante; tolera largos distintos sin lanzar. */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
