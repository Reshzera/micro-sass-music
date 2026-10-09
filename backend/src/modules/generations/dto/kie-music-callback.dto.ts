import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { KieMusicCallbackPayload } from '../../../externals/kieClient/types/kie-music.types';

export class KieCallbackTrackDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  audio_url?: string;

  @IsOptional()
  @IsString()
  stream_audio_url?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  model_name?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  tags?: string;

  @IsOptional()
  @IsInt()
  createTime?: number;

  @IsOptional()
  @IsNumber()
  duration?: number;
}

export class KieCallbackDataDto {
  /** `text` once lyrics exist, `first` once one track is ready, `complete` at the end. */
  @IsIn(['text', 'first', 'complete'])
  callbackType!: 'text' | 'first' | 'complete';

  @IsString()
  task_id!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KieCallbackTrackDto)
  data?: KieCallbackTrackDto[];
}

/**
 * Body KIE posts to `KIE_CALLBACK_URL`.
 *
 * Validated with a relaxed pipe in the controller: KIE is free to add fields,
 * and rejecting a delivery over an unknown property would lose the result.
 */
export class KieMusicCallbackDto implements KieMusicCallbackPayload {
  @IsInt()
  code!: number;

  @IsOptional()
  @IsString()
  msg?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => KieCallbackDataDto)
  data!: KieCallbackDataDto;
}
