import { ApiProperty } from '@nestjs/swagger';
import { AgentType, Audience, CandidateApplyMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Corregir un documento existente en vez de crear uno nuevo (spec 007, US1).
 *
 * Es la alternativa a `teachAgent`: cuando el caso escaló porque un documento
 * quedó CORTO, crear otro sobre el mismo tema hace que los dos se repartan la
 * señal y ninguno gane. El propio aviso de baja confianza ya lo dice —"lo que
 * conviene es corregir ese documento, no cargar otro"— y hasta esta spec no
 * había forma de hacerlo.
 */
export class CorrectKnowledgeDto {
  @ApiProperty({
    description:
      'Documento a corregir. Sale de ' +
      'GET /supervisor/escalations/:id/knowledge-candidates.',
  })
  @IsUUID()
  documentId: string;

  @ApiProperty({
    description:
      'Versión sobre la que se preparó la corrección (la que devolvió ' +
      'correction-preview). Si el documento cambió mientras tanto, se rechaza ' +
      'con 409 en vez de pisar la edición de otro.',
  })
  @IsInt()
  baseVersion: number;

  @ApiProperty({
    description:
      'El texto aprobado por el supervisor. Qué se hace con él lo decide ' +
      '`applyMode`: con REEMPLAZAR (default) es el contenido FINAL del ' +
      'documento; con AGREGAR es el bloque que se suma al final de lo que el ' +
      'documento ya dice. En los dos casos se guarda esto y nunca se regenera ' +
      'con el modelo, porque eso metería contenido que nadie aprobó.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    required: false,
    enum: CandidateApplyMode,
    description:
      'AGREGAR suma `content` al final del documento; REEMPLAZAR lo pisa ' +
      'entero. Mismo par que ya usan las fichas de entrevista, y la misma ' +
      'regla de composición.',
  })
  @IsEnum(CandidateApplyMode)
  @IsOptional()
  applyMode?: CandidateApplyMode;
}

export class ResolveEscalationDto {
  @ApiProperty({ example: 'Sí, la tenemos en 12 cuotas sin interés.' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    required: false,
    description:
      'Si true, ingesta la respuesta al RAG como conocimiento reutilizable.',
  })
  @IsBoolean()
  @IsOptional()
  teachAgent?: boolean;

  @ApiProperty({
    required: false,
    example: 'Financiación de heladeras exhibidoras en cuotas',
    description:
      'Título del documento de conocimiento (igual que en POST /knowledge). Requerido si teachAgent=true.',
  })
  @ValidateIf((o: ResolveEscalationDto) => o.teachAgent === true)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiProperty({
    required: false,
    example: 'productos',
    description:
      'Categoría del documento de conocimiento (igual que en POST /knowledge). Requerida si teachAgent=true.',
  })
  @ValidateIf((o: ResolveEscalationDto) => o.teachAgent === true)
  @IsString()
  @IsNotEmpty()
  category?: string;

  @ApiProperty({
    required: false,
    enum: Audience,
    description:
      'Por defecto INTERNO (el más restrictivo), sin importar el tipo de ' +
      'usuario de la conversación: para que quede disponible como respuesta ' +
      'a cualquier cliente hay que pedirlo a propósito con PUBLICO.',
  })
  @IsEnum(Audience)
  @IsOptional()
  audience?: Audience;

  @ApiProperty({
    required: false,
    enum: AgentType,
    description: 'Por defecto se usa el agente activo de la conversación.',
  })
  @IsEnum(AgentType)
  @IsOptional()
  agentType?: AgentType;

  @ApiProperty({
    required: false,
    type: () => CorrectKnowledgeDto,
    description:
      'Spec 007: en vez de CREAR un documento (teachAgent), corregir uno que ' +
      'ya existía y quedó corto. Excluyente con teachAgent — pedir las dos ' +
      'cosas no tiene sentido: o se mejora lo que hay, o se agrega algo nuevo.',
  })
  @ValidateIf((o: ResolveEscalationDto) => o.correctKnowledge !== undefined)
  @ValidateNested()
  @Type(() => CorrectKnowledgeDto)
  @IsOptional()
  correctKnowledge?: CorrectKnowledgeDto;
}
