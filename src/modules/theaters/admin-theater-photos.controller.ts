import { Body, Controller, Delete, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Admin, CurrentPrincipal } from '../../common/auth/access.decorators';
import type { StaffPrincipal } from '../../common/auth/types';
import { Strict } from '../../common/idempotency/idempotency.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { ImageUpload, UploadedImage } from '../media/image-upload.decorators';
import type { ImageUploadPayload, UploadOutcome } from '../media/types';
import { TheaterIdParams, TheaterPhotoParams } from './dto/theater-id.params';
import { TheaterPhotoFieldsRequest } from './dto/theater-photo-fields.request';
import { TheaterResponse } from './dto/theater.response';
import { UpdateTheaterPhotoRequest } from './dto/update-theater-photo.request';
import { TheaterPhotosService } from './theater-photos.service';
import { TheaterResponseMapper } from './theater-response.mapper';

@ApiTags('Admin: theaters')
@Controller('admin/theaters/:id')
export class AdminTheaterPhotosController {
  constructor(
    private readonly photos: TheaterPhotosService,
    private readonly mapper: TheaterResponseMapper,
  ) {}

  @Post('photos')
  @Admin()
  @Strict()
  @ImageUpload({ fields: TheaterPhotoFieldsRequest })
  @ApiOperation({
    summary: 'Upload a theater cover or gallery photo',
    description:
      'Admin only: the Photos tab. `multipart/form-data` with one JPG or PNG `file` (at most 10 MB and 40 megapixels) and `usage`.\n\n- `cover`: centre-cropped to 16:9, at least 1280 × 720 after the crop; replaces the current cover, whose files are deleted.\n- `gallery`: kept in its shape, at least 320 pixels on the shorter side, added last; at most 20 per theater (`CONFLICT` with `details.limit`).\n\nThe server strips the metadata (location included) and stores WebP copies in three web sizes. Retrying with the same `Idempotency-Key` and the same file replays the answer. Recorded in the activity log.',
  })
  @ApiCreatedResponse({
    type: TheaterResponse,
    description: 'The theater with the new photo',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('NOT_FOUND', 'CONFLICT')
  uploadPhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
    @Body() fields: TheaterPhotoFieldsRequest,
    @UploadedImage() upload: ImageUploadPayload,
  ): Promise<UploadOutcome<TheaterResponse>> {
    return this.photos.upload(
      {
        theaterId: params.id,
        usage: fields.usage,
        caption: fields.caption ?? null,
        upload,
        actor: principal,
      },
      (view) => this.mapper.toTheaterResponse(view),
    );
  }

  @Patch('photos/:photoId')
  @Admin()
  @ApiOperation({
    summary: 'Change a gallery photo',
    description:
      'Admin only: its caption (null removes it) and its place in the gallery (0 is first; past the last place means last). The other photos keep their order. A request that changes nothing answers `200` and records nothing. Recorded in the activity log.',
  })
  @ApiBody({ type: UpdateTheaterPhotoRequest })
  @ApiOkResponse({
    type: TheaterResponse,
    description: 'The theater after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async updatePhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterPhotoParams,
    @Body() body: UpdateTheaterPhotoRequest,
  ): Promise<TheaterResponse> {
    return this.mapper.toTheaterResponse(
      await this.photos.update(principal, params.id, params.photoId, body),
    );
  }

  @Delete('photos/:photoId')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a gallery photo',
    description:
      'Admin only: removes the photo and, once the change is saved, its image files. The photos after it move up one place. Recorded in the activity log.',
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async deletePhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterPhotoParams,
  ): Promise<void> {
    await this.photos.delete(principal, params.id, params.photoId);
  }

  @Delete('cover')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove a theater's cover",
    description:
      'Admin only: the theater has no cover until a new one is uploaded; its image files are deleted once the change is saved. Without a cover, this does nothing and still answers `204`. Recorded in the activity log.',
  })
  @ApiNoContentResponse({ description: 'Removed', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async deleteCover(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: TheaterIdParams,
  ): Promise<void> {
    await this.photos.deleteCover(principal, params.id);
  }
}
