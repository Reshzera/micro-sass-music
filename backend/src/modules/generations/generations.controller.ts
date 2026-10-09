import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KieMusicCallbackPayload } from '../../externals/kieClient/types/kie-music.types';
import { CreateGenerationDto } from './dto/create-generation.dto';
import { KieMusicCallbackDto } from './dto/kie-music-callback.dto';
import { GenerationsService } from './generations.service';
import type {
  GenerationAccepted,
  GenerationStatus,
} from './types/generation.types';

/**
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, which would
 * reject a webhook delivery the moment KIE adds a field. Typing the body as
 * an interface makes the global pipe skip it (its metatype is `Object`), and
 * this pipe then validates against the DTO without whitelisting.
 */
const CALLBACK_PIPE = new ValidationPipe({
  expectedType: KieMusicCallbackDto,
  transform: true,
});

@Controller('generations')
export class GenerationsController {
  private readonly callbackSecret?: string;

  constructor(
    private readonly generationsService: GenerationsService,
    config: ConfigService,
  ) {
    this.callbackSecret = config.get<string>('KIE_CALLBACK_SECRET');
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateGenerationDto): Promise<GenerationAccepted> {
    return this.generationsService.create(dto);
  }

  /**
   * Webhook KIE posts to as a task progresses — the delivery path for
   * finished audio. Fires up to three times per task and is retried on
   * failure, so handling must stay idempotent.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body(CALLBACK_PIPE) payload: KieMusicCallbackPayload,
    @Query('secret') secret?: string,
  ): Promise<{ received: true }> {
    this.assertCallbackSecret(secret);
    await this.generationsService.handleCallback(payload);

    // Acknowledge regardless of the task outcome — a failed generation is
    // still a delivery we handled. A write that throws, on the other hand,
    // is left to bubble up so KIE redelivers.
    return { received: true };
  }

  @Get(':taskId')
  findOne(@Param('taskId') taskId: string): Promise<GenerationStatus> {
    return this.generationsService.findOne(taskId);
  }

  /**
   * KIE does not sign its callbacks, so the only thing guarding this public
   * endpoint is a secret embedded in `KIE_CALLBACK_URL`. Unset means no check.
   */
  private assertCallbackSecret(provided?: string): void {
    if (!this.callbackSecret) {
      return;
    }

    const expected = Buffer.from(this.callbackSecret);
    const actual = Buffer.from(provided ?? '');

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new UnauthorizedException();
    }
  }
}
