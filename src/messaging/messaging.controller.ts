import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WebhookMessageDto } from './dto/webhook-message.dto';
import { N8nAuthGuard } from './guards/n8n-auth.guard';
import { MessagingService } from './messaging.service';

@ApiTags('messaging')
@Controller('messaging')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post('webhook')
  @HttpCode(202)
  @UseGuards(N8nAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Recibe mensajes desde n8n/WhatsApp' })
  async webhook(@Body() dto: WebhookMessageDto) {
    await this.messagingService.enqueue(dto);
    return { queued: true };
  }

}