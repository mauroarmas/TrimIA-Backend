import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../database/prisma.service';

export interface JwtPayload {
  jti?: string;
  sub: string; // employee id
  email: string;
  name?: string;
  role: string; // EMPLEADO | SUPERVISOR
  sectorId: string;
  sectorName: string;
  isController: boolean; // Cobrador Controlador (Sprint 4)
  isGeneralSupervisor?: boolean; // Acceso total a todas las áreas (Diego Bazán)
  areasSupervisadas?: { id: string; name: string; agentType: string | null }[];
  /**
   * Vencimiento (segundos epoch). No se firma acá: lo agrega jsonwebtoken a
   * partir de `expiresIn`, y viene en el token que se verifica. Se declara
   * porque los streams del panel lo necesitan — una entrega no puede sobrevivir
   * a la sesión que la autorizó (spec 004, RF-022).
   */
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    const [totalSectorsCount, employee] = await Promise.all([
      this.prisma.sector.count(),
      this.prisma.employee.findUnique({
        where: { email },
        include: {
          sector: true,
          areasSupervisadas: {
            select: { id: true, name: true, agentType: true },
          },
        },
      }),
    ]);

    if (!employee || !employee.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(password, employee.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isGeneralSupervisor =
      employee.role === 'SUPERVISOR' &&
      (employee.email === 'diego.bazan@credimision.com' ||
        (totalSectorsCount > 0 &&
          (employee.areasSupervisadas?.length ?? 0) >= totalSectorsCount));

    const payload: JwtPayload = {
      jti: randomUUID(),
      sub: employee.id,
      email: employee.email,
      name: employee.name,
      role: employee.role,
      sectorId: employee.sectorId,
      sectorName: employee.sector.name,
      isController: employee.isController,
      isGeneralSupervisor,
      areasSupervisadas: employee.areasSupervisadas ?? [],
    };

    return {
      accessToken: this.jwt.sign(payload),
    };
  }

  /**
   * Hashea una contraseña para almacenar en DB. Salt rounds = 10.
   */
  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  /** También cubre los JWT emitidos antes de incorporar el cierre de sesión. */
  async revokeSession(sessionId: string, expiresAt: number): Promise<void> {
    const ttl = Math.ceil(expiresAt - Date.now() / 1000);
    if (ttl > 0) {
      await this.redis.set(`auth:revoked:${sessionId}`, '1', 'EX', ttl);
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(`auth:revoked:${sessionId}`)) > 0;
  }

  async currentIdentity(employeeId: string) {
    const [employee, totalSectors] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { id: employeeId },
        include: {
          sector: true,
          areasSupervisadas: {
            select: { id: true, name: true, agentType: true },
          },
        },
      }),
      this.prisma.sector.count(),
    ]);
    if (!employee?.isActive) {
      throw new UnauthorizedException('La sesión ya no está habilitada');
    }
    return {
      id: employee.id,
      email: employee.email,
      name: employee.name,
      role: employee.role,
      sectorId: employee.sectorId,
      sectorName: employee.sector.name,
      isController: employee.isController,
      isGeneralSupervisor:
        employee.role === 'SUPERVISOR' &&
        (employee.email === 'diego.bazan@credimision.com' ||
          (totalSectors > 0 &&
            employee.areasSupervisadas.length >= totalSectors)),
      areasSupervisadas: employee.areasSupervisadas,
    };
  }
}
