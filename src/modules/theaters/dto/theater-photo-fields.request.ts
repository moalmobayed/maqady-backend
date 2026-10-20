import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString, ValidateBy, ValidateIf } from 'class-validator';
import { PHOTO_USAGES } from '../enums';
import { TEXT_LIMITS } from '../theaters.constants';
import type { PhotoUsage } from '../types';
import { HasLength, Trim } from './validators';

/** The text fields sent with the file of `POST /admin/theaters/{id}/photos`. */
export class TheaterPhotoFieldsRequest {
  @ApiProperty({
    enum: PHOTO_USAGES,
    enumName: 'TheaterPhotoUsage',
    nullable: false,
    example: 'gallery',
    description:
      '`cover`: the 16:9 header and card photo, centre-cropped, at least 1280 × 720 after the crop; it replaces the current cover. `gallery`: one more gallery photo, kept in its shape, at least 320 pixels on the shorter side; at most 20 per theater.',
  })
  @IsIn(PHOTO_USAGES)
  usage!: PhotoUsage;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.photoCaption.min,
    maxLength: TEXT_LIMITS.photoCaption.max,
    example: 'The lobby',
    description:
      'Gallery photos only: shown with the photo and used as its alternative text. Trimmed.',
  })
  @ValidateIf((_: object, value: unknown) => value !== undefined)
  @ValidateBy({
    name: 'captionOnlyForGallery',
    validator: {
      validate: (_: unknown, args) =>
        (args?.object as Partial<TheaterPhotoFieldsRequest> | undefined)?.usage !== 'cover',
      defaultMessage: () => 'caption is for gallery photos only; a cover has none',
    },
  })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.photoCaption.min, TEXT_LIMITS.photoCaption.max)
  caption?: string;
}
