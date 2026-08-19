import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';

export interface JwtPayload {
  sub: string; // employee id
  email: string;
  role: string; // EMPLEADO | SUPERVISOR
  sectorId: string;
  sectorName: string;
  isController: boolean; // Cobrador Controlador (Sprint 4)
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
  ) {}

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    const employee = await this.prisma.employee.findUnique({
      where: { email },
      include: { sector: true },
    });

    if (!employee || !employee.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await bcrypt.compare(password, employee.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload: JwtPayload = {
      sub: employee.id,
      email: employee.email,
      role: employee.role,
      sectorId: employee.sectorId,
      sectorName: employee.sector.name,
      isController: employee.isController,
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
}
