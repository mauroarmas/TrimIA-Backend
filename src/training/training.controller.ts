import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrainingService } from './training.service';
import { VerifyQuizDto } from './dto/verify-quiz.dto';
import { DiagnosticQuizResponseDto } from './dto/diagnostic-quiz.dto';
import { SubmitDiagnosticDto } from './dto/submit-diagnostic.dto';
import { DiagnosticResultDto } from './dto/diagnostic-result.dto';
import { AudioScriptDto } from './dto/audio-script.dto';
import { AudioStatusResponseDto } from './dto/audio-status.dto';
import {
  PlaybackProgressResponseDto,
  ReportPlaybackProgressDto,
} from './dto/playback-progress.dto';

interface AuthenticatedRequest {
  user: { id: string; email?: string; role?: string };
}

@ApiTags('Capacitación - Empleados')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @UseGuards(JwtAuthGuard)
  @Get('diagnostic')
  @ApiOperation({ summary: 'Obtener cuestionario diagnóstico inicial sanitizado para el empleado' })
  @ApiResponse({ status: 200, description: 'Cuestionario generado con éxito', type: DiagnosticQuizResponseDto })
  @ApiResponse({ status: 400, description: 'El empleado ya completó su diagnóstico inicial' })
  async getDiagnostic(@Req() req: AuthenticatedRequest) {
    return this.trainingService.getDiagnosticQuestions(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Get('modules')
  @ApiOperation({ summary: 'Listar módulos y píldoras disponibles para el empleado autenticado con candados adaptativos' })
  async getMyModules(@Req() req: AuthenticatedRequest) {
    return this.trainingService.getEmployeeModules(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('pills/:id')
  @ApiOperation({ summary: 'Obtener contenido de una lección teórica (ocultando respuestas correctas)' })
  async getPill(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.trainingService.getEmployeePill(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('pills/:id/verify')
  @ApiOperation({ summary: 'Enviar respuestas al cuestionario de autoevaluación formativa' })
  async verifyQuiz(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: VerifyQuizDto,
  ) {
    return this.trainingService.verifyQuiz(req.user.id, id, dto.answers);
  }

  // ==========================================================================
  // Spec 016 — Pipeline de Audio: Lectura, Streaming y Avance (Empleado/General)
  // ==========================================================================

  @Get('pills/:id/script')
  @ApiOperation({ summary: 'Obtener el guion de audio estructurado de una píldora' })
  @ApiResponse({ status: 200, description: 'Guion obtenido exitosamente', type: AudioScriptDto })
  @ApiResponse({ status: 404, description: 'Píldora o guion no encontrado' })
  async getScript(@Param('id') id: string) {
    return this.trainingService.getPillAudioScript(id);
  }

  @Get('pills/:id/audio/status')
  @ApiOperation({ summary: 'Consultar el estado del procesamiento del audio de la píldora' })
  @ApiResponse({ status: 200, description: 'Estado actual del audio', type: AudioStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Píldora no encontrada' })
  async getAudioStatus(@Param('id') id: string) {
    return this.trainingService.getAudioStatus(id);
  }

  @Get('pills/:id/audio')
  @ApiOperation({ summary: 'Streaming continuo del archivo de audio MP3 con soporte de cabecera Range' })
  @ApiResponse({ status: 200, description: 'Audio completo' })
  @ApiResponse({ status: 206, description: 'Audio parcial (HTTP 206 Partial Content)' })
  @ApiResponse({ status: 404, description: 'Audio no encontrado' })
  async streamAudio(
    @Param('id') id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ) {
    const streamResult = await this.trainingService.getAudioStream(id, rangeHeader);

    res.setHeader('Content-Type', streamResult.contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    if (streamResult.isPartial && streamResult.contentRange) {
      res.status(206);
      res.setHeader('Content-Range', streamResult.contentRange);
      res.setHeader('Content-Length', streamResult.contentLength);
    } else {
      res.status(200);
      res.setHeader('Content-Length', streamResult.contentLength);
    }

    streamResult.stream.pipe(res);
  }

  @UseGuards(JwtAuthGuard)
  @Post('pills/:id/playback-progress')
  @ApiOperation({ summary: 'Reportar avance de reproducción de audio y verificar umbral del 80%' })
  @ApiResponse({ status: 200, description: 'Progreso registrado y evaluado', type: PlaybackProgressResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o salto temporal sospechoso' })
  @ApiResponse({ status: 404, description: 'Píldora no encontrada' })
  async reportPlaybackProgress(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReportPlaybackProgressDto,
  ) {
    return this.trainingService.recordPlaybackProgress(req.user.id, id, dto);
  }
}
