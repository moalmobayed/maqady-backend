import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IMAGE_VARIANT_NAMES } from '../enums';
import type { ImageVariantName } from '../types';

/** One web size of an image (home-page contract `ImageVariant`). */
@ApiSchema({ name: 'ImageVariant' })
export class ImageVariantResponse {
  @ApiProperty({
    enum: IMAGE_VARIANT_NAMES,
    description: 'Which size this is: `small`, `medium` or `large`.',
    example: 'medium',
  })
  name!: ImageVariantName;

  @ApiProperty({
    type: 'string',
    format: 'uri',
    description: 'Public URL of the WebP file. The browser loads it directly; it never changes.',
    example:
      'https://example.supabase.co/storage/v1/object/public/media/poster/9f8e2a4c-1b3d-4e5f-8a7b-6c5d4e3f2a1b/medium.webp',
  })
  url!: string;

  @ApiProperty({ type: 'integer', description: 'Width in pixels.', example: 400 })
  width!: number;

  @ApiProperty({ type: 'integer', description: 'Height in pixels.', example: 600 })
  height!: number;
}

/**
 * A picture in its web sizes (home-page contract `Image`), built by `MediaService.toImageResponse`
 * for every response that shows one: posters, backdrops, covers, people and gallery photos.
 */
@ApiSchema({ name: 'Image' })
export class ImageResponse {
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Alternative text for the picture, or null when it is decorative.',
    example: 'The Last Lighthouse poster',
  })
  alt!: string | null;

  @ApiProperty({
    type: () => [ImageVariantResponse],
    minItems: 1,
    description: 'The same picture in web sizes, smallest first. Use them for `srcset`.',
  })
  variants!: ImageVariantResponse[];
}
