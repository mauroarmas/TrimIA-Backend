import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrainingService } from './training.service';
import { VerifyQuizDto } from './dto/verify-quiz.dto';
import { DiagnosticQuizResponseDto } from './dto/diagnostic-quiz.dto';
import { SubmitDiagnosticDto } from './dto/submit-diagnostic.dto';
import { DiagnosticResultDto } from './dto/diagnostic-result.dto';

interface AuthenticatedRequest {
  user: { id: string; email?: string; role?: string };
}

@ApiTags('Capacitación - Empleados')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Get('diagnostic')
  @ApiOperation({ summary: 'Obtener cuestionario diagnóstico inicial sanitizado para el empleado' })
  @ApiResponse({ status: 200, description: 'Cuestionario generado con éxito', type: DiagnosticQuizResponseDto })
  @ApiResponse({ status: 400, description: 'El empleado ya completó su diagnóstico inicial' })
  async getDiagnostic(@Req() req: AuthenticatedRequest) {
    return this.trainingService.getDiagnosticQuestions(req.user.id);
  }

  @Post('diagnostic/submit')
  @ApiOperation({ summary: 'Enviar respuestas del diagnóstico inicial y calcular exenciones automáticas' })
  @ApiResponse({ status: 200, description: 'Diagnóstico evaluado y procesado exitosamente', type: DiagnosticResultDto })
  @ApiResponse({ status: 400, description: 'Cuestionario ya completado o respuestas inválidas' })
  async submitDiagnostic(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitDiagnosticDto,
  ) {
    return this.trainingService.submitDiagnostic(req.user.id, dto);
  }

  @Get('modules')
  @ApiOperation({ summary: 'Listar módulos y píldoras disponibles para el empleado autenticado con candados adaptativos' })
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
  @ApiOperation({ summary: 'Enviar respuestas al cuestionario de autoevaluación formativa' })
  async verifyQuiz(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: VerifyQuizDto,
  ) {
    return this.trainingService.verifyQuiz(req.user.id, id, dto.answers);
  }
}
