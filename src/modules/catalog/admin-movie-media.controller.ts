import { Body, Controller, Delete, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
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
import { CatalogResponseMapper } from './catalog-response.mapper';
import { AdminMovieResponse } from './dto/admin-movie.response';
import { CreateMovieVideoRequest } from './dto/create-movie-video.request';
import { MovieIdParams, MoviePhotoParams, MovieVideoParams } from './dto/movie-id.params';
import { MoviePhotoFieldsRequest } from './dto/movie-photo-fields.request';
import { UpdateMoviePhotoRequest } from './dto/update-movie-photo.request';
import { UpdateMovieVideoRequest } from './dto/update-movie-video.request';
import { VideoResponse } from './dto/video.response';
import { MovieMediaService } from './movie-media.service';
import { parseYoutubeUrl } from './youtube';
import { fieldError } from './catalog-errors';
import { YOUTUBE_URL_MESSAGE } from './catalog.constants';

const ADMIN_ONLY = 'Admin only (box office staff get `FORBIDDEN`).';

@ApiTags('Admin: movies')
// `Video` is the public shape U8 answers; published here, where the admin video extends it.
@ApiExtraModels(VideoResponse)
@Controller('admin/movies/:id')
export class AdminMovieMediaController {
  constructor(
    private readonly movieMedia: MovieMediaService,
    private readonly mapper: CatalogResponseMapper,
  ) {}

  @Put('poster')
  @Admin()
  @HttpCode(200)
  @ImageUpload()
  @ApiOperation({
    summary: "Upload a movie's poster",
    description: `${ADMIN_ONLY} Sets the poster from one JPG or PNG of at most 10 MB: 2:3 (up to 2 % off, centre-cropped) and at least 400 × 600, else \`IMAGE_WRONG_SHAPE\`. Replaces any previous poster, whose files are deleted once the change commits. An unknown movie is \`NOT_FOUND\` before the image is processed. The optional \`Idempotency-Key\` replays a retried upload. Recorded in the activity log.`,
  })
  @ApiOkResponse({
    type: AdminMovieResponse,
    description: 'The movie with its new poster',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('NOT_FOUND')
  uploadMoviePoster(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
    @UploadedImage() upload: ImageUploadPayload,
  ): Promise<UploadOutcome<AdminMovieResponse>> {
    return this.movieMedia.uploadPoster(principal, params.id, upload, (movie) =>
      this.mapper.adminMovie(movie),
    );
  }

  @Delete('poster')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove a movie's poster",
    description: `${ADMIN_ONLY} Removes the poster and deletes its files once the change commits. A movie without a poster answers \`204\` too. Recorded in the activity log.`,
  })
  @ApiNoContentResponse({ description: 'Removed', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async removeMoviePoster(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
  ): Promise<void> {
    await this.movieMedia.removePoster(principal, params.id);
  }

  @Post('photos')
  @Admin()
  @Strict()
  @ImageUpload({ fields: MoviePhotoFieldsRequest })
  @ApiOperation({
    summary: 'Upload a movie photo',
    description: `${ADMIN_ONLY} Adds one photo at the end of the movie's gallery: one JPG or PNG of at most 10 MB, any shape, at least 320 pixels on the shorter side, with its type (\`still\` or \`behind_the_scenes\`) and an optional caption as form fields. Web-sized copies are kept, with location data stripped. A movie has at most 30 photos (\`CONFLICT\` with \`details.limit\`). Any photo of 16:9 and at least 1280 × 720 can later be the backdrop. Requires an \`Idempotency-Key\`. Recorded in the activity log.`,
  })
  @ApiCreatedResponse({
    type: AdminMovieResponse,
    description: 'The movie with the new photo',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('NOT_FOUND', 'CONFLICT')
  uploadMoviePhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
    @Body() fields: MoviePhotoFieldsRequest,
    @UploadedImage() upload: ImageUploadPayload,
  ): Promise<UploadOutcome<AdminMovieResponse>> {
    return this.movieMedia.uploadPhoto(
      principal,
      params.id,
      { kind: fields.kind, caption: fields.caption ?? null },
      upload,
      (movie) => this.mapper.adminMovie(movie),
    );
  }

  @Patch('photos/:photoId')
  @Admin()
  @ApiOperation({
    summary: 'Edit a movie photo',
    description: `${ADMIN_ONLY} Changes a photo's type or caption, or moves it to another place in the gallery (\`position\`, 0 first; the others keep their order). A photo of another movie is \`NOT_FOUND\`. Recorded in the activity log.`,
  })
  @ApiBody({ type: UpdateMoviePhotoRequest })
  @ApiOkResponse({
    type: AdminMovieResponse,
    description: 'The movie after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async updateMoviePhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MoviePhotoParams,
    @Body() body: UpdateMoviePhotoRequest,
  ): Promise<AdminMovieResponse> {
    const movie = await this.movieMedia.updatePhoto(principal, params.id, params.photoId, {
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.caption !== undefined ? { caption: body.caption } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
    });
    return this.mapper.adminMovie(movie);
  }

  @Delete('photos/:photoId')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a movie photo',
    description: `${ADMIN_ONLY} Deletes the photo and its files (once the deletion commits); the gallery closes the gap. If it was the backdrop, the movie no longer has one. Recorded in the activity log.`,
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async deleteMoviePhoto(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MoviePhotoParams,
  ): Promise<void> {
    await this.movieMedia.deletePhoto(principal, params.id, params.photoId);
  }

  @Post('videos')
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Add a YouTube video to a movie',
    description: `${ADMIN_ONLY} Adds a YouTube video at the end of the movie's list. Watch (\`youtube.com/watch?v=…\`), \`youtu.be\`, shorts and embed links are accepted; only the 11-character video id is stored, and the embed and thumbnail URLs are derived from it. The title, type and optional length are typed by the admin. The same video twice on one movie is \`CONFLICT\`; a movie has at most 20 videos (\`CONFLICT\` with \`details.limit\`). Requires an \`Idempotency-Key\`. Recorded in the activity log.`,
  })
  @ApiBody({ type: CreateMovieVideoRequest })
  @ApiCreatedResponse({
    type: AdminMovieResponse,
    description: 'The movie with the new video',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'CONFLICT')
  async addMovieVideo(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
    @Body() body: CreateMovieVideoRequest,
  ): Promise<AdminMovieResponse> {
    const youtubeId = parseYoutubeUrl(body.url);
    if (youtubeId === null) throw fieldError('url', YOUTUBE_URL_MESSAGE);
    const movie = await this.movieMedia.addVideo(principal, params.id, {
      youtubeId,
      title: body.title,
      kind: body.kind,
      durationSeconds: body.durationSeconds ?? null,
    });
    return this.mapper.adminMovie(movie);
  }

  @Patch('videos/:videoId')
  @Admin()
  @ApiOperation({
    summary: 'Edit a movie video',
    description: `${ADMIN_ONLY} Changes a video's title, type or length, or moves it to another place in the list (\`position\`, 0 first). The link itself can't change: delete the video and add the new one. A video of another movie is \`NOT_FOUND\`. Recorded in the activity log.`,
  })
  @ApiBody({ type: UpdateMovieVideoRequest })
  @ApiOkResponse({
    type: AdminMovieResponse,
    description: 'The movie after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async updateMovieVideo(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieVideoParams,
    @Body() body: UpdateMovieVideoRequest,
  ): Promise<AdminMovieResponse> {
    const movie = await this.movieMedia.updateVideo(principal, params.id, params.videoId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
    });
    return this.mapper.adminMovie(movie);
  }

  @Delete('videos/:videoId')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a movie video',
    description: `${ADMIN_ONLY} Removes the video from the movie; the list closes the gap. The hero video of a featured movie can't be deleted (\`MOVIE_NOT_FEATURABLE\`): unfeature the movie or pick another hero first. The hero of a movie that isn't featured is simply cleared. Recorded in the activity log.`,
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'MOVIE_NOT_FEATURABLE')
  async deleteMovieVideo(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieVideoParams,
  ): Promise<void> {
    await this.movieMedia.deleteVideo(principal, params.id, params.videoId);
  }
}
