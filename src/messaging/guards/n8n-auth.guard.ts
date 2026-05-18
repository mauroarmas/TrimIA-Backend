import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class N8nAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secret = request.headers['x-n8n-secret'];

    if (secret !== this.config.get<string>('N8N_WEBHOOK_SECRET')) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}