import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  KiePersonaModel,
  KieSunoModel,
  KieVocalGender,
} from '../../../externals/kieClient/types/kie-music.types';

const SUNO_MODELS: KieSunoModel[] = [
  'V4',
  'V4_5',
  'V4_5PLUS',
  'V4_5ALL',
  'V5',
  'V5_5',
  'V6',
  'V6_MINI',
  'V6_WILD',
];

const VOCAL_GENDERS: KieVocalGender[] = ['m', 'f'];

const PERSONA_MODELS: KiePersonaModel[] = ['style_persona', 'voice_persona'];

/**
 * Public request body for `POST /generations`.
 *
 * camelCase on our side; `GenerationsService` translates to the snake_case
 * `input` KIE expects. In custom mode `title` and `style` carry the brief and
 * `lyrics` the words; otherwise `prompt` alone describes the track.
 */
export class CreateGenerationDto {
  @IsIn(SUNO_MODELS)
  model!: KieSunoModel;

  @IsBoolean()
  instrumental!: boolean;

  /** Defaults to false — a single `prompt` describes the whole track. */
  @IsOptional()
  @IsBoolean()
  customMode?: boolean;

  @ValidateIf((dto: CreateGenerationDto) => !dto.customMode)
  @IsString()
  @MaxLength(3000)
  prompt?: string;

  @ValidateIf((dto: CreateGenerationDto) => dto.customMode === true)
  @IsString()
  @MaxLength(80)
  title?: string;

  @ValidateIf((dto: CreateGenerationDto) => dto.customMode === true)
  @IsString()
  @MaxLength(1000)
  style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  lyrics?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  negativeTags?: string;

  @IsOptional()
  @IsIn(VOCAL_GENDERS)
  vocalGender?: KieVocalGender;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  styleWeight?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  weirdnessConstraint?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  audioWeight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  variety?: number;

  @IsOptional()
  @IsString()
  personaId?: string;

  @IsOptional()
  @IsIn(PERSONA_MODELS)
  personaModel?: KiePersonaModel;

  /** Seconds. Custom mode only, on V5_5 and the V6 family. */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(360)
  duration?: number;

  /** Up to 5 reference images. */
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  @Type(() => String)
  imageUrls?: string[];

  /** Up to 1 reference video. */
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  @Type(() => String)
  videoUrls?: string[];

  /** Reference audio, 6s–30min. */
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  @Type(() => String)
  audioUrls?: string[];
}
