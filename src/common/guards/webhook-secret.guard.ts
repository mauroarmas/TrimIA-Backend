import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Protege endpoints internos (webhook de n8n, carga de conocimiento) con un
 * secreto compartido en el header `x-n8n-secret`.
 *
 * La comparación es de tiempo constante (timingSafeEqual) para no filtrar el
 * largo/contenido del secreto por análisis de tiempos.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-n8n-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    const expected = this.config.get<string>('N8N_WEBHOOK_SECRET');

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
