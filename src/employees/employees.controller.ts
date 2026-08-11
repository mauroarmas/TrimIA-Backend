import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

/**
 * ABM de empleados (whitelist). Solo accesible por SUPERVISOR.
 * Todos los endpoints requieren JWT + rol SUPERVISOR.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  create(@Body() dto: CreateEmployeeDto, @Req() req: any) {
    return this.employeesService.create(dto, req.user.email);
  }

  @Get()
  findAll() {
    return this.employeesService.findAll();
  }

  @Get('sectors')
  listSectors() {
    return this.employeesService.listSectors();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employeesService.findById(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: any,
  ) {
    return this.employeesService.update(id, dto, req.user.email);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.employeesService.remove(id, req.user.email);
  }
}
