import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { InterviewsService } from './interviews.service';
import { InterviewsCandidatesService } from './interviews-candidates.service';
import { OpenInterviewDto } from './dto/open-interview.dto';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { SkipQuestionDto } from './dto/skip-question.dto';
import { FinishInterviewDto } from './dto/finish-interview.dto';
import { PatchCandidateDto } from './dto/patch-candidate.dto';
import { ApproveCandidatesDto } from './dto/approve-candidates.dto';

interface AuthenticatedRequest {
  user: { id: string; role: string };
}

/**
 * La entrevista de capacitación por chat (spec 010, RF11). Rol y área son
 * dos gates distintos (FR-036): `@Roles('SUPERVISOR')` acá abre la
 * pantalla, la responsabilidad de área — verificada en el servicio — decide
 * sobre qué se puede entrevistar.
 */
@ApiTags('interviews')
@Controller('interviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class InterviewsController {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly candidates: InterviewsCandidatesService,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Abre una entrevista para un área (US1)',
    description:
      'Encola la redacción de preguntas y responde sin esperar (Principio IV).\n\n' +
      '**409** `SESSION_ALREADY_OPEN` — ya hay una sesión sin cerrar de esta ' +
      'persona para esta área; viene con esa sesión, no se crea una segunda.\n\n' +
      '**422** — no hay material, con `reason` distinguido: `SIN_CORRIDA` ' +
      '(nunca se corrió el barrido de cobertura), `SIN_MUESTRA_SUFICIENTE` ' +
      '(hay tráfico pero no alcanza) o `TODO_CUBIERTO` (corrió y no hay ' +
      'huecos ni escalados de respaldo). Los tres dan cero preguntas y no ' +
      'son intercambiables.',
  })
  open(@Body() dto: OpenInterviewDto, @Req() req: AuthenticatedRequest) {
    return this.interviews.open(dto.sectorId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'El estado de la sesión (US1/US4)',
    description:
      'Poll, no stream (D4): para consultar mientras `PREPARANDO` o `CERRANDO`.\n\n' +
      '`current.kind` decide qué trae la pregunta — `PEDIR_NUEVO`/`ABIERTA` ' +
      'traen `quotes`; `CORREGIR` trae además `document` con su contenido ' +
      'entero; `GENERALIZAR` trae `resolutionText`. `current` es `null` si ' +
      'no quedan pendientes o el estado no es `EN_CURSO` — una sesión ' +
      'cerrada anticipadamente llega a `EN_REVISION` con pendientes.\n\n' +
      'Detecta acá, al consultar, si la sesión pasó a `ABANDONADA` por ' +
      'inactividad (FR-022) — no hay barrido programado para eso.',
  })
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.interviews.get(id, req.user.id);
  }

  @Post(':id/answer')
  @ApiOperation({
    summary: 'Contesta la pregunta actual (US1)',
    description:
      'Sin llamada al modelo: la pregunta ya está redactada. `retry: true` ' +
      'en la respuesta significa que se consideró vacía y se repregunta — ' +
      'solo pasa una vez por pregunta (FR-018).',
  })
  answer(
    @Param('id') id: string,
    @Body() dto: AnswerQuestionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.interviews.answer(id, dto.questionId, dto.text, req.user.id);
  }

  @Post(':id/skip')
  @ApiOperation({
    summary: 'Saltea la pregunta actual — no produce candidato (US1)',
  })
  skip(
    @Param('id') id: string,
    @Body() dto: SkipQuestionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.interviews.skip(id, dto.questionId, req.user.id);
  }

  @Post(':id/finish')
  @ApiOperation({
    summary: 'Termina la sesión ahora (US2/US4)',
    description:
      'Disponible con la sesión `EN_CURSO` **o** `ABANDONADA` (FR-022a) — ' +
      'una sesión abandonada no se cierra sola, pero se puede cerrar igual ' +
      'que una en curso para que sus respuestas útiles lleguen a revisión.\n\n' +
      '**400** `PENDING_QUESTIONS` si quedan preguntas sin responder y no ' +
      'vino `confirmPending: true` — el body dice cuántas quedan.',
  })
  finish(
    @Param('id') id: string,
    @Body() dto: FinishInterviewDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.interviews.finish(id, !!dto.confirmPending, req.user.id);
  }

  @Get(':id/candidates')
  @ApiOperation({
    summary: 'La pantalla de revisión (US2)',
    description:
      '`candidateKind` (`NUEVO`/`CORRECCION`, derivado de `targetDocumentId`) ' +
      'no es el mismo eje que el `kind` de la pregunta — dice qué se va a ' +
      'escribir, no qué se preguntó. `similar` se calcula acá, antes de ' +
      'aprobar nada (FR-029) — vacío en los candidatos que ya son corrección.',
  })
  listCandidates(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.candidates.list(id, req.user.id);
  }

  @Patch('candidates/:candidateId')
  @ApiOperation({
    summary: 'Edita un candidato antes de aprobarlo (US2)',
    description:
      'Mandar `targetDocumentId` convierte un candidato nuevo en corrección ' +
      'de ese documento (desde el aviso de parecido, FR-029); en `null` lo ' +
      'devuelve a nuevo.',
  })
  patchCandidate(
    @Param('candidateId') candidateId: string,
    @Body() dto: PatchCandidateDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.candidates.patch(candidateId, dto, req.user.id);
  }

  @Post('candidates/:candidateId/approve')
  @ApiOperation({
    summary: 'Aprueba un candidato — al corpus (US2)',
    description:
      'Resultado por candidato, nunca una excepción de conjunto (FR-027). ' +
      '`code` en el fallo: `NOT_FOUND`, `ALREADY_RESOLVED`, `AREA_AJENA` ' +
      '(se perdió la responsabilidad del área desde que se abrió la sesión), ' +
      '`VERSION_CAMBIO` (el documento a corregir cambió — trae ' +
      '`currentVersion`), `DOCUMENTO_AUSENTE` (se borró o desactivó), ' +
      '`DUPLICADO_EXACTO`, o `ERROR`. `action` en el éxito: `CREATED` o ' +
      '`CORRECTED`.',
  })
  approveOne(
    @Param('candidateId') candidateId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.candidates.approve([candidateId], req.user.id);
  }

  @Post(':id/candidates/approve')
  @ApiOperation({
    summary: 'Aprueba varios candidatos de una sesión — "aprobar todo" (US2)',
    description: 'Mismos códigos que aprobar uno solo, un resultado por id.',
  })
  approveMany(
    @Body() dto: ApproveCandidatesDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.candidates.approve(dto.ids, req.user.id);
  }

  @Post('candidates/:candidateId/discard')
  @ApiOperation({
    summary: 'Descarta un candidato (US2)',
    description: 'No se borra: queda `DESCARTADO` con su respuesta cruda.',
  })
  discardCandidate(
    @Param('candidateId') candidateId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.candidates.discard(candidateId, req.user.id);
  }
}
