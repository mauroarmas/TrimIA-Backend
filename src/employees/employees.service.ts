import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { analyzePhone, normalizePhone } from '../common/phone';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

export { CreateEmployeeDto, UpdateEmployeeDto };

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async create(dto: CreateEmployeeDto, createdBy: string) {
    // El DTO ya normaliza, pero create() también se llama desde código
    // interno (seed, dev-tools) que no pasa por el ValidationPipe.
    const phone = normalizePhone(dto.phone);

    // Verificar que no exista un empleado con el mismo teléfono o email
    const existing = await this.prisma.employee.findFirst({
      where: {
        OR: [{ phone }, { email: dto.email }],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.phone === phone
          ? 'Ya existe un empleado con ese teléfono'
          : 'Ya existe un empleado con ese email',
      );
    }

    const hashedPassword = await this.authService.hashPassword(dto.password);

    const employee = await this.prisma.employee.create({
      data: {
        phone,
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
        role: dto.role ?? 'EMPLEADO',
        sectorId: dto.sectorId,
        isController: dto.isController ?? false,
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
   * Busca un empleado por teléfono — ESTA es la whitelist que consulta el
   * MessageProcessor para decidir el userType.
   *
   * El número se normaliza antes de buscar: si el guardado y el que manda
   * Meta difieren en el formato (el `549` vs `54` que ya nos mordió), el
   * findUnique no encuentra nada y el empleado queda tratado como cliente,
   * con conocimiento PUBLICO y sin los 5 agentes. Lo peor es que falla sin
   * ruido, así que además se avisa cuando el número entrante era raro.
   */
  async findByPhone(phone: string) {
    const analyzed = analyzePhone(phone);
    if (!analyzed.canonical) {
      this.logger.warn(
        `Teléfono no canónico en la búsqueda de whitelist ("${phone}"): ${analyzed.reason}`,
      );
    }

    return this.prisma.employee.findUnique({
      where: { phone: analyzed.phone },
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

    // Lista explícita: `{ ...dto }` dejaba pasar cualquier campo del body
    // directo al `data` de Prisma. Con los DTOs como clases el
    // ValidationPipe ya filtra, pero update() también se llama desde código
    // interno (dev-tools) que no pasa por el pipe.
    const data: Record<string, unknown> = {};
    if (dto.phone !== undefined) data.phone = normalizePhone(dto.phone);
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.sectorId !== undefined) data.sectorId = dto.sectorId;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isController !== undefined) data.isController = dto.isController;
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
