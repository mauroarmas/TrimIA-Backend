import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentType, Audience, FileProcessingStatus } from '@prisma/client';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeAiEditService } from './knowledge-ai-edit.service';
import { ListKnowledgeQueryDto } from './dto/list-knowledge.dto';
import { SetActiveDto } from './dto/set-active.dto';
import { UpdateKnowledgeDto } from './dto/update-knowledge.dto';
import { UploadKnowledgeDto } from './dto/upload-knowledge.dto';
import { AiEditApplyDto, AiEditPreviewDto } from './dto/ai-edit.dto';

/**
 * El tope de multer va **por encima** del límite del negocio a propósito.
 *
 * Si multer cortara justo en 20 MB, el rechazo saldría con su mensaje genérico
 * y se perdería el `reason` (`FILE_LIMIT` vs `MULTIMODAL_LIMIT`) que el panel
 * necesita para decirle al supervisor qué hacer (FR-007/FR-050). Con el margen,
 * el archivo llega a `KnowledgeIngestionService`, que rechaza con el mensaje
 * accionable; multer queda solo como red de contención contra subidas absurdas.
 */
const MULTER_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize:
      ((Number(process.env.KNOWLEDGE_MAX_FILE_MB) || 20) + 1) * 1024 * 1024,
  },
};

/**
 * Lo que el JwtStrategy deja en `req.user`.
 *
 * OJO: el `sub` del JWT se mapea a `id` en `JwtStrategy.validate()` — no hay
 * `req.user.sub`. Leerlo como `sub` da `undefined` y el fallo aparece recién
 * abajo, en Prisma, con un mensaje que no menciona la autenticación.
 */
interface AuthenticatedRequest {
  user: { id: string; role: string };
}

/**
 * Base de Conocimiento del panel del supervisor (Sprint 5A).
 *
 * **Cambio de autenticación respecto de Sprint 4**: antes iba con un secreto
 * compartido propio (`KNOWLEDGE_ADMIN_SECRET`), pensado como parche de
 * desarrollo hasta que existiera la pantalla. Ahora que el panel expone esto,
 * la protección correcta es la misma que usa el resto del panel: JWT + rol.
 * Un secreto en un header no identifica *quién* hizo el cambio, y el Sprint 5A
 * necesita saberlo (bitácora de ediciones, FR-048/FR-049).
 *
 * Sigue siendo material sensible: `/knowledge/search` permite pedir audiencia
 * INTERNO, así que exige `SUPERVISOR` y no un empleado cualquiera (OE-10).
 *
 * El **área** (`agentType`) es filtro de navegación, no permiso: cualquier
 * supervisor gestiona cualquier área (FR-045). No se introduce el sector como
 * tercera dimensión de autorización.
 */
@ApiTags('knowledge')
@Controller('knowledge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERVISOR')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly ingestion: KnowledgeIngestionService,
    private readonly aiEdit: KnowledgeAiEditService,
  ) {}

  /** Ingesta un documento. body: { title, content, category, audience?, agentType? } */
  @Post()
  ingest(
    @Body()
    body: {
      title: string;
      content: string;
      category: string;
      audience?: Audience;
      agentType?: AgentType;
    },
  ) {
    return this.knowledge.ingest(body);
  }

  /** Busca conocimiento. body: { query, audience, agentType?, k? } */
  @Post('search')
  search(
    @Body()
    body: {
      query: string;
      audience: Audience;
      agentType?: AgentType;
      k?: number;
    },
  ) {
    return this.knowledge.search(body.query, {
      audience: body.audience,
      agentType: body.agentType,
      k: body.k,
    });
  }

  // === Gestión (Sprint 5A) ===

  @Get()
  @ApiOperation({ summary: 'Lista documentos por área (FR-019)' })
  list(@Query() query: ListKnowledgeQueryDto) {
    return this.knowledge.list(query);
  }

  // === Archivos (Sprint 5A, US1) ===
  // OJO con el orden: estas rutas van ANTES de `@Get(':id')` y `@Post(':id/…')`.
  // Nest resuelve por orden de declaración, así que declaradas después,
  // `/knowledge/files` entraría por `:id` y moriría en el ParseUUIDPipe.

  @Post('upload')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', MULTER_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadKnowledgeDto })
  @ApiOperation({
    summary: 'Sube un archivo y lo procesa en segundo plano (FR-001, FR-006)',
    description:
      'Responde 202 sin esperar la extracción: puede tardar segundos ' +
      '(Principio IV). El avance se sigue por GET /knowledge/files.',
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKnowledgeDto,
    @Req() req: AuthenticatedRequest,
    @Query('force') force?: string,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Falta el archivo. Mandalo en el campo "file" del formulario.',
      );
    }
    return this.ingestion.upload(file, dto, req.user.id, force === 'true');
  }

  @Get('files')
  @ApiOperation({ summary: 'Cargas recientes y su estado (FR-006)' })
  listFiles(
    @Query('status') status?: FileProcessingStatus,
    @Query('limit') limit?: string,
  ) {
    return this.ingestion.listFiles(status, limit ? Number(limit) : undefined);
  }

  @Get('files/:id/download')
  @ApiOperation({
    summary: 'Descarga el original conservado (FR-044)',
    description: '404 si el origen fue un audio: se elimina al transcribir.',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.ingestion.getFileForDownload(id);
    res.set({
      'Content-Type': file.mimeType,
      // El nombre original vuelve acá, no en la ruta: en disco el archivo se
      // llama por UUID justamente para no confiar en este valor.
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
    });
    return new StreamableFile(file.buffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle con origen y bitácora de cambios' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.findById(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Edita un documento (FR-020)',
    description:
      'Cambiar `content`, `audience` o `agentType` dispara reindexación en ' +
      'ChromaDB; cambiar solo el título o la categoría, no.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.knowledge.update(id, dto, req.user.id);
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Activa o desactiva sin borrar (FR-022)' })
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto) {
    return this.knowledge.setActive(id, dto.isActive);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina definitivamente (FR-023)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.remove(id);
  }

  // === Editar con la IA (Sprint 5A, US6) ===
  //
  // Dos endpoints y no uno con un flag: que `preview` no persista nada es lo
  // que hace estructuralmente imposible aplicar un cambio sin aprobación
  // (FR-032, Principio III). Con un solo endpoint parametrizado, esa garantía
  // dependería de que nadie mande el flag equivocado.

  @Post(':id/ai-edit/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Propone un cambio descrito en lenguaje natural (FR-030, FR-031)',
    description:
      'NO persiste nada: es idempotente y el documento queda intacto. ' +
      'Devuelve `confident: false` cuando el pedido es ambiguo, en vez de ' +
      'alterar el texto de una forma que nadie pidió (FR-033).',
  })
  previewAiEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AiEditPreviewDto,
  ) {
    return this.aiEdit.preview(id, dto.instruction);
  }

  @Post(':id/ai-edit/apply')
  @ApiOperation({
    summary: 'Aplica el texto aprobado por el supervisor (FR-032, FR-049)',
    description:
      'Guarda el `content` del body —que puede venir editado a mano—, nunca ' +
      'uno regenerado. 409 si `baseVersion` quedó vieja.',
  })
  applyAiEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AiEditApplyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.aiEdit.apply(id, dto, req.user.id);
  }

  @Post(':id/reindex')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Reintenta la reindexación de un documento en REINDEX_FAILED',
  })
  reindex(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.requestReindex(id);
  }
}
