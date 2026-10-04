import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrainingService } from './training.service';
import { VerifyQuizDto } from './dto/verify-quiz.dto';

interface AuthenticatedRequest {
  user: { id: string; email?: string; role?: string };
}

@ApiTags('Capacitación - Empleados')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Get('modules')
  @ApiOperation({ summary: 'Listar módulos y píldoras disponibles para el empleado autenticado' })
  async getMyModules(@Req() req: AuthenticatedRequest) {
    return this.trainingService.getEmployeeModules(req.user.id);
  }

  @Get('pills/:id')
  @ApiOperation({ summary: 'Obtener contenido de una lección teórica (ocultando respuestas correctas)' })
  async getPill(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.trainingService.getEmployeePill(req.user.id, id);
  }

  @Post('pills/:id/verify')
  @ApiOperation({ summary: 'Enviar respuestas al cuestionario de autoevaluación' })
  async verifyQuiz(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: VerifyQuizDto,
  ) {
    return this.trainingService.verifyQuiz(req.user.id, id, dto.answers);
  }
}
