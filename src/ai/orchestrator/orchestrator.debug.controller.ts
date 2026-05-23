import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrchestratorService } from './orchestrator.service';
import { ClassifyDebugDto } from './dto/classify-debug.dto';

/**
 * Controller TEMPORAL para probar el orquestador de forma aislada.
 * Se elimina cuando el orquestador esté enchufado al MessageProcessor (paso 3.6).
 */
@ApiTags('orchestrator-debug')
@Controller('orchestrator')
export class OrchestratorDebugController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post('classify')
  @ApiOperation({ summary: '[DEBUG] Corre el flujo completo: clasifica → rutea → responde' })
  async classify(@Body() dto: ClassifyDebugDto) {
    const result = await this.orchestrator.invoke('debug-thread', dto.message);
    return {
      message: dto.message,
      agentType: result.agentType,
      response: result.response,
    };
  }
}
