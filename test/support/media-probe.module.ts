import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Knex } from 'knex';
import { Admin, CurrentPrincipal } from '../../src/common/auth/access.decorators';
import type { StaffPrincipal } from '../../src/common/auth/types';
import { APP_CONFIG } from '../../src/common/config/config.constants';
import type { AppConfig } from '../../src/common/config/types';
import { TransactionContext } from '../../src/common/database/transaction-context';
import { AppError } from '../../src/common/errors/app-error';
import { Strict } from '../../src/common/idempotency/idempotency.decorators';
import { ImageResponse } from '../../src/modules/media/dto/image.response';
import { ImageUpload, UploadedImage } from '../../src/modules/media/image-upload.decorators';
import { MediaModule } from '../../src/modules/media/media.module';
import { MediaService } from '../../src/modules/media/media.service';
import type { ImageUploadPayload, StoredImage } from '../../src/modules/media/types';

/**
 * Test-only upload routes under `/api/v1/test-media`, built the way U4b and U6 build theirs:
 * `@Admin()`, `@Strict()` on a `POST`, `@ImageUpload()`, and `MediaService` linking the image to
 * an owner row (`zz_media_owners`) inside the upload's short transaction.
 */

export const OWNERS_TABLE = 'zz_media_owners';

export class ProbeOwnerFields {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  caption?: string;

  /** `ok` links the image; `missing-owner` breaks the link's foreign key; `refuse` throws. */
  @IsOptional()
  @IsIn(['ok', 'missing-owner', 'refuse'])
  mode?: 'ok' | 'missing-owner' | 'refuse';
}

@Injectable()
export class ProbeOwnersRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(imageId: number, caption: string | null): Promise<number> {
    const [row] = await this.db
      .executor()(OWNERS_TABLE)
      .insert({ image_id: imageId, caption })
      .returning<{ id: number }[]>('id');
    return row!.id;
  }

  async imageOf(ownerId: number): Promise<number | undefined> {
    const row = await this.db
      .executor()(OWNERS_TABLE)
      .select<{ image_id: number }[]>('image_id')
      .where({ id: ownerId })
      .forUpdate()
      .first();
    return row?.image_id;
  }

  async setImage(ownerId: number, imageId: number): Promise<void> {
    await this.db.executor()(OWNERS_TABLE).where({ id: ownerId }).update({ image_id: imageId });
  }
}

@Admin()
@Controller('test-media')
export class MediaProbeController {
  constructor(
    private readonly media: MediaService,
    private readonly owners: ProbeOwnersRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Uploads a poster with no owner row. */
  @Post('posters')
  @Strict()
  @ImageUpload()
  @ApiOkResponse({ type: ImageResponse })
  uploadPoster(
    @UploadedImage() upload: ImageUploadPayload,
    @CurrentPrincipal() actor: StaffPrincipal,
  ) {
    return this.media.upload({
      kind: 'poster',
      upload,
      actor,
      link: (image) =>
        Promise.resolve({
          imageId: image.id,
          image: this.media.toImageResponse(image, 'Probe poster'),
        }),
    });
  }

  /** Uploads a gallery photo and links it to a new owner row, with text fields. */
  @Post('owners')
  @Strict()
  @ImageUpload({ fields: ProbeOwnerFields })
  uploadOwner(
    @Body() fields: ProbeOwnerFields,
    @UploadedImage() upload: ImageUploadPayload,
    @CurrentPrincipal() actor: StaffPrincipal,
  ) {
    return this.media.upload({
      kind: 'gallery',
      upload,
      actor,
      link: async (image: StoredImage) => {
        if (fields.mode === 'refuse') throw new AppError('NOT_FOUND');
        const imageId = fields.mode === 'missing-owner' ? image.id + 1_000_000 : image.id;
        const ownerId = await this.owners.insert(imageId, fields.caption ?? null);
        return { ownerId, imageId: image.id, caption: fields.caption ?? null };
      },
    });
  }

  /** Replaces an owner's image (a `PUT`, so the key is optional); the old one goes after commit. */
  @Put('owners/:id/image')
  @HttpCode(200)
  @ImageUpload()
  replaceOwnerImage(
    @Param('id', ParseIntPipe) ownerId: number,
    @UploadedImage() upload: ImageUploadPayload,
    @CurrentPrincipal() actor: StaffPrincipal,
  ) {
    return this.media.upload({
      kind: 'person',
      upload,
      actor,
      link: async (image) => {
        const previous = await this.owners.imageOf(ownerId);
        if (previous === undefined) throw new AppError('NOT_FOUND');
        await this.owners.setImage(ownerId, image.id);
        await this.media.delete(previous);
        return { ownerId, imageId: image.id };
      },
    });
  }

  /** Deletes an image in the request transaction and reports whether its files still exist. */
  @Delete('images/:id')
  @HttpCode(200)
  async deleteImage(@Param('id', ParseIntPipe) id: number) {
    const [image] = (await this.media.findByIds([id])).values();
    if (!image) throw new AppError('NOT_FOUND');
    await this.media.delete(id);
    return { filesPresentBeforeCommit: this.filesExist(image) };
  }

  /** Deletes an image, then fails: the request transaction rolls back. */
  @Delete('images/:id/failing')
  async deleteImageThenFail(@Param('id', ParseIntPipe) id: number): Promise<never> {
    await this.media.delete(id);
    throw new AppError('CONFLICT');
  }

  /** Returns an `Image`, so the document has the schema to compare with the home-page draft. */
  @Get('images/:id')
  @ApiOkResponse({ type: ImageResponse })
  async getImage(@Param('id', ParseIntPipe) id: number) {
    const [image] = (await this.media.findByIds([id])).values();
    return this.media.toImageResponse(image, null);
  }

  private filesExist(image: StoredImage): boolean {
    if (this.config.storage.driver !== 'local') throw new Error('local driver only');
    const { directory } = this.config.storage;
    return Object.values(image.variants).every((variant) =>
      existsSync(join(directory, ...variant.path.split('/'))),
    );
  }
}

@Module({
  imports: [MediaModule],
  controllers: [MediaProbeController],
  providers: [ProbeOwnersRepository],
})
export class MediaProbeModule {}

export async function createMediaProbeTables(knex: Knex, schema: string): Promise<void> {
  await knex.raw(
    `CREATE TABLE IF NOT EXISTS ??.?? (
       id BIGSERIAL PRIMARY KEY,
       image_id BIGINT NOT NULL REFERENCES ??.images (id),
       caption TEXT NULL
     )`,
    [schema, OWNERS_TABLE, schema],
  );
}

export async function dropMediaProbeTables(knex: Knex, schema: string): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.??', [schema, OWNERS_TABLE]);
}
