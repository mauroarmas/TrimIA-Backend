import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { EmployeeRole } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString()
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @IsString()
  sectorId: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(EmployeeRole)
  role?: EmployeeRole;

  @IsOptional()
  @IsString()
  sectorId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async create(dto: CreateEmployeeDto, createdBy: string) {
    // Verificar que no exista un empleado con el mismo teléfono o email
    const existing = await this.prisma.employee.findFirst({
      where: {
        OR: [{ phone: dto.phone }, { email: dto.email }],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.phone === dto.phone
          ? 'Ya existe un empleado con ese teléfono'
          : 'Ya existe un empleado con ese email',
      );
    }

    const hashedPassword = await this.authService.hashPassword(dto.password);

    const employee = await this.prisma.employee.create({
      data: {
        phone: dto.phone,
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
        role: dto.role ?? 'EMPLEADO',
        sectorId: dto.sectorId,
      },
      include: { sector: true },
    });

    this.logger.log(
      `Empleado creado: ${employee.name} (${employee.role}) por ${createdBy}`,
    );

    // No devolver el hash del password
    const { password: _, ...safe } = employee;
    return safe;
  }

  async findAll() {
    const employees = await this.prisma.employee.findMany({
      include: { sector: true },
      orderBy: { name: 'asc' },
    });

    return employees.map(({ password: _, ...safe }) => safe);
  }

  async findById(id: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: { sector: true },
    });

    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    const { password: _, ...safe } = employee;
    return safe;
  }

  /**
   * Busca un empleado por teléfono. Usado por MessageProcessor para
   * determinar userType (EMPLEADO vs CLIENTE).
   */
  async findByPhone(phone: string) {
    return this.prisma.employee.findUnique({
      where: { phone },
      select: {
        id: true,
        role: true,
        isActive: true,
        sectorId: true,
        sector: { select: { name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateEmployeeDto, updatedBy: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    const data: any = { ...dto };
    if (dto.password) {
      data.password = await this.authService.hashPassword(dto.password);
    }

    const updated = await this.prisma.employee.update({
      where: { id },
      data,
      include: { sector: true },
    });

    this.logger.log(
      `Empleado actualizado: ${updated.name} por ${updatedBy}. ` +
        `Campos: ${Object.keys(dto).join(', ')}`,
    );

    const { password: _, ...safe } = updated;
    return safe;
  }

  async remove(id: string, removedBy: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    // Soft delete: desactivar, no borrar.
    await this.prisma.employee.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(
      `Empleado desactivado: ${employee.name} por ${removedBy}`,
    );

    return { message: 'Empleado desactivado' };
  }

  async listSectors() {
    return this.prisma.sector.findMany({
      orderBy: { name: 'asc' },
    });
  }
}
