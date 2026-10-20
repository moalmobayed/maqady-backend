import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
import { toPageRequest } from '../../common/pagination/cursor';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { CatalogResponseMapper } from './catalog-response.mapper';
import { CreditsService } from './credits.service';
import { AdminMovieListQuery } from './dto/admin-movie-list.query';
import { AdminMoviePageResponse } from './dto/admin-movie-page.response';
import { AdminMovieResponse } from './dto/admin-movie.response';
import { BulkArchiveMoviesRequest } from './dto/bulk-archive-movies.request';
import { BulkArchiveMoviesResponse } from './dto/bulk-archive-movies.response';
import { CreateMovieRequest } from './dto/create-movie.request';
import { MovieIdParams } from './dto/movie-id.params';
import { ReplaceMovieCreditsRequest } from './dto/replace-movie-credits.request';
import { UpdateMovieRequest } from './dto/update-movie.request';
import { MoviesService } from './movies.service';

const ADMIN_ONLY = 'Admin only (box office staff get `FORBIDDEN`).';

@ApiTags('Admin: movies')
@Controller('admin/movies')
export class AdminMoviesController {
  constructor(
    private readonly movies: MoviesService,
    private readonly credits: CreditsService,
    private readonly mapper: CatalogResponseMapper,
  ) {}

  @Get()
  @Admin()
  @ApiOperation({
    summary: 'List movies',
    description: `${ADMIN_ONLY} The Movies screen: every movie, newest first, with its poster, genres, status, carousel position and media and credit counts.\n\n- \`q\` matches a title or the name of anyone credited on the movie, case-insensitively.\n- \`status\` filters the list; \`statusCounts\` gives the count of every status for the same \`q\`, for the filter tabs.\n- Cursor-paginated: pass \`nextCursor\` back as \`cursor\`.`,
  })
  @ApiOkResponse({
    type: AdminMoviePageResponse,
    description: 'One page of movies',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async listMovies(@Query() query: AdminMovieListQuery): Promise<AdminMoviePageResponse> {
    const page = await this.movies.list(
      {
        ...(query.q !== undefined ? { q: query.q } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
      },
      toPageRequest(query, 'instant'),
    );
    return this.mapper.adminMoviePage(page);
  }

  @Post()
  @Admin()
  @Strict()
  @ApiOperation({
    summary: 'Create a movie',
    description: `${ADMIN_ONLY} "Add movie": creates a **draft** that only admins see. Only \`title\` is required; \`ageRating\` defaults to \`12+\`. Publish it later with \`PATCH /admin/movies/{id}\`. Requires an \`Idempotency-Key\`. Recorded in the activity log.`,
  })
  @ApiBody({ type: CreateMovieRequest })
  @ApiCreatedResponse({
    type: AdminMovieResponse,
    description: 'The new draft',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED')
  async createMovie(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: CreateMovieRequest,
  ): Promise<AdminMovieResponse> {
    const movie = await this.movies.create(principal, {
      title: body.title,
      ...detailsOf(body),
    });
    return this.mapper.adminMovie(movie);
  }

  @Patch()
  @Admin()
  @ApiOperation({
    summary: 'Archive several movies',
    description: `${ADMIN_ONLY} The list's bulk action: archives every selected movie in one transaction, all or nothing. Archived movies are hidden from customers; their history and tickets stay.\n\n- Any unknown id is \`NOT_FOUND\` with \`details.missingIds\`, and nothing changes.\n- Movies already archived are reported in \`alreadyArchivedIds\`, not refused.\n- A featured movie leaves the home carousel.\n- Recorded in the activity log, one entry per archived movie.`,
  })
  @ApiBody({ type: BulkArchiveMoviesRequest })
  @ApiOkResponse({
    type: BulkArchiveMoviesResponse,
    description: 'What was archived',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async bulkArchiveMovies(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Body() body: BulkArchiveMoviesRequest,
  ): Promise<BulkArchiveMoviesResponse> {
    const result = await this.movies.bulkArchive(principal, body.movieIds);
    return Object.assign(new BulkArchiveMoviesResponse(), {
      archivedIds: [...result.archivedIds],
      alreadyArchivedIds: [...result.alreadyArchivedIds],
    });
  }

  @Get(':id')
  @Admin()
  @ApiOperation({
    summary: 'Get a movie for the editor',
    description: `${ADMIN_ONLY} Everything the movie editor shows: details, genres, poster, photos (and which is the backdrop), YouTube videos (and which is the hero), cast and crew, publishing state, what still blocks publishing (\`publishBlockers\`), and the real "Last edited by".`,
  })
  @ApiOkResponse({
    type: AdminMovieResponse,
    description: 'The movie',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async getMovie(@Param() params: MovieIdParams): Promise<AdminMovieResponse> {
    return this.mapper.adminMovie(await this.movies.get(params.id));
  }

  @Patch(':id')
  @Admin()
  @ApiOperation({
    summary: 'Edit or publish a movie',
    description: `${ADMIN_ONLY} Changes any details, the genres, the backdrop and hero video, the status and the home carousel position. Absent fields stay; null clears a nullable one. The rules are judged on the movie as it would be after the change:\n\n- **Status.** draft → coming soon, now showing or archived; coming soon → draft, now showing or archived; now showing → archived; archived → coming soon or now showing. Anything else is \`CONFLICT\` with \`details.from\` and \`details.to\`.\n- **Publishing.** A Coming soon or Now showing movie needs a synopsis, runtime, release date and at least one genre (a poster is optional): \`MOVIE_NOT_PUBLISHABLE\` with \`details.missing\`. Clearing one of them on a public movie is refused the same way.\n- **Carousel.** \`featuredPosition\` 1 to 5 needs a public movie with a hero video (\`MOVIE_NOT_FEATURABLE\` with \`details.reasons\`), and a position no other movie holds (\`FEATURED_POSITION_TAKEN\` with the holder's \`movieId\`). Moving to draft or archived frees the position.\n- **Media.** \`heroVideoId\` and \`backdropPhotoId\` must be this movie's own (\`VALIDATION_FAILED\`); a backdrop must be 16:9 and at least 1280 × 720 (\`IMAGE_WRONG_SHAPE\`).\n- An unknown genre id is \`VALIDATION_FAILED\` on \`genreIds\`. A change to the values the movie already has answers \`200\` and changes nothing.\n- Recorded in the activity log with the names of the changed fields.`,
  })
  @ApiBody({ type: UpdateMovieRequest })
  @ApiOkResponse({
    type: AdminMovieResponse,
    description: 'The movie after the change',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses(
    'VALIDATION_FAILED',
    'NOT_FOUND',
    'CONFLICT',
    'MOVIE_NOT_PUBLISHABLE',
    'MOVIE_NOT_FEATURABLE',
    'FEATURED_POSITION_TAKEN',
    'IMAGE_WRONG_SHAPE',
  )
  async updateMovie(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
    @Body() body: UpdateMovieRequest,
  ): Promise<AdminMovieResponse> {
    const movie = await this.movies.update(principal, params.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...detailsOf(body),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.featuredPosition !== undefined ? { featuredPosition: body.featuredPosition } : {}),
      ...(body.heroVideoId !== undefined ? { heroVideoId: body.heroVideoId } : {}),
      ...(body.backdropPhotoId !== undefined ? { backdropPhotoId: body.backdropPhotoId } : {}),
    });
    return this.mapper.adminMovie(movie);
  }

  @Delete(':id')
  @Admin()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a movie',
    description: `${ADMIN_ONLY} Deletes a movie with its genres, photos, videos and credits; the image files go once the deletion commits. A movie that ever had a booking can't be deleted (\`MOVIE_NOT_DELETABLE\` with \`details.reasons\`): archive it instead. Recorded in the activity log.`,
  })
  @ApiNoContentResponse({ description: 'Deleted', headers: REQUEST_ID_RESPONSE_HEADER })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'MOVIE_NOT_DELETABLE')
  async deleteMovie(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
  ): Promise<void> {
    await this.movies.delete(principal, params.id);
  }

  @Put(':id/credits')
  @Admin()
  @ApiOperation({
    summary: "Replace a movie's cast and crew",
    description: `${ADMIN_ONLY} The Cast & crew tab: the movie's whole list in display order, replacing the previous one. A person may have several roles, each once; \`characterName\` is only for \`actor\` and \`voice\`. An unknown person is \`VALIDATION_FAILED\` on \`credits.<i>.personId\`, and nothing changes. Recorded in the activity log.`,
  })
  @ApiBody({ type: ReplaceMovieCreditsRequest })
  @ApiOkResponse({
    type: AdminMovieResponse,
    description: 'The movie with its new credits',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND')
  async replaceMovieCredits(
    @CurrentPrincipal() principal: StaffPrincipal,
    @Param() params: MovieIdParams,
    @Body() body: ReplaceMovieCreditsRequest,
  ): Promise<AdminMovieResponse> {
    const movie = await this.credits.replaceForMovie(
      principal,
      params.id,
      body.credits.map((credit) => ({
        personId: credit.personId,
        role: credit.role,
        characterName: credit.characterName ?? null,
      })),
    );
    return this.mapper.adminMovie(movie);
  }
}

/** The detail fields a create or update request sent. */
function detailsOf(body: CreateMovieRequest | UpdateMovieRequest) {
  return {
    ...(body.synopsis !== undefined ? { synopsis: body.synopsis } : {}),
    ...(body.runtimeMinutes !== undefined ? { runtimeMinutes: body.runtimeMinutes } : {}),
    ...(body.releaseDate !== undefined ? { releaseDate: body.releaseDate } : {}),
    ...(body.ageRating !== undefined ? { ageRating: body.ageRating } : {}),
    ...(body.language !== undefined ? { language: body.language } : {}),
    ...(body.country !== undefined ? { country: body.country } : {}),
    ...(body.productionCompany !== undefined ? { productionCompany: body.productionCompany } : {}),
    ...(body.budgetLabel !== undefined ? { budgetLabel: body.budgetLabel } : {}),
    ...(body.filmingLocations !== undefined ? { filmingLocations: body.filmingLocations } : {}),
    ...(body.genreIds !== undefined ? { genreIds: body.genreIds } : {}),
  };
}
