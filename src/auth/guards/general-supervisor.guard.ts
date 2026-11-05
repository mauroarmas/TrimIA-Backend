import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class GeneralSupervisorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (user?.role !== 'SUPERVISOR' || !user.isGeneralSupervisor) {
      throw new ForbiddenException(
        'Esta operación global requiere supervisión general',
      );
    }
    return true;
  }
}
