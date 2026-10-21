import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsInt, IsString, Max, Min, ValidateIf } from 'class-validator';
import { MAX_GALLERY_PHOTOS, TEXT_LIMITS } from '../theaters.constants';
import { HasLength, Trim } from './validators';

/** `PATCH /admin/theaters/{id}/photos/{photoId}`: the caption, the place in the gallery, or both. */
export class UpdateTheaterPhotoRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: TEXT_LIMITS.photoCaption.min,
    maxLength: TEXT_LIMITS.photoCaption.max,
    example: 'The lobby',
    description: 'The new caption; null removes it. Trimmed.',
  })
  // Validated when sent as text, and when nothing is sent, so an empty body names a field.
  @ValidateIf(
    (body: UpdateTheaterPhotoRequest) =>
      (body.caption === undefined && body.position === undefined) ||
      (body.caption !== undefined && body.caption !== null),
  )
  @IsDefined({ message: 'send caption, position or both' })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.photoCaption.min, TEXT_LIMITS.photoCaption.max)
  caption?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 0,
    maximum: MAX_GALLERY_PHOTOS - 1,
    example: 0,
    description:
      'The place in the gallery, from 0 (first). Past the last place means last. The other photos keep their order.',
  })
  @ValidateIf((_: object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_GALLERY_PHOTOS - 1)
  position?: number;
}
