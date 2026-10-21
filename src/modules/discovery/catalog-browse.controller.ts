import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/access.decorators';
import { toPageRequest } from '../../common/pagination/cursor';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { MovieIdParams } from '../catalog/dto/movie-id.params';
import { DiscoveryCacheInterceptor } from './discovery-cache.interceptor';
import { DiscoveryResponseMapper } from './discovery-response.mapper';
import { PUBLIC_READ_NOTE } from './discovery.constants';
import { GenreListQuery, MovieListQuery, PublicPersonListQuery } from './dto/discovery.queries';
import { GenreWithCountPage } from './dto/genre-with-count.response';
import { MovieDetailsResponse } from './dto/movie-details.response';
import { MovieCardPageResponse, SimilarMoviesResponse } from './dto/movie-lists.response';
import { PublicPersonPageResponse } from './dto/public-person.response';
import { MovieBrowseService } from './movie-browse.service';

/** The public catalog reads (PRD C2, C3): genres, the Movies page, a movie's page and people. */
@ApiTags('Discovery')
@Public()
@UseInterceptors(DiscoveryCacheInterceptor)
@Controller()
export class CatalogBrowseController {
  constructor(
    private readonly movies: MovieBrowseService,
    private readonly mapper: DiscoveryResponseMapper,
  ) {}

  @Get('genres')
  @ApiOperation({
    summary: 'Genres with their movie counts',
    description: `${PUBLIC_READ_NOTE}\n\nEvery genre, alphabetical, with \`movieCount\`: its Coming soon plus Now showing movies, or only the tab's when \`status\` is given (the Movies page genre filter). Link a genre with its \`slug\`: \`/movies?genres=sci-fi\`. Cursor-paginated (default 20, at most 100); there are ten genres, so one page holds them all.`,
  })
  @ApiOkResponse({
    type: GenreWithCountPage,
    description: 'One page of genres',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listGenres(@Query() query: GenreListQuery): Promise<GenreWithCountPage> {
    const page = await this.movies.listGenres(query.status, toPageRequest(query, 'text'));
    return this.mapper.genrePage(page);
  }

  @Get('movies')
  @ApiOperation({
    summary: 'The Movies page: one tab, filtered',
    description: `${PUBLIC_READ_NOTE}\n\nOne page of a tab: Now showing newest release first, or Coming soon soonest release first (ties by id). The filters combine (AND): \`genres\` (slugs) and \`people\` (person ids) match any of their values, \`q\` a title or a credited person's name. \`total\` counts the tab with the filters ("Showing n of total"); \`tabCounts\` counts both tabs with the same filters, for the tab labels. Load more with \`cursor\` = \`nextCursor\`; pages never repeat or skip a movie. \`showDate\` (Now showing only) keeps the movies with a showtime still to start today, tomorrow or this weekend; with it, \`tabCounts.nowShowing\` is the filtered total and \`tabCounts.comingSoon\` ignores it, and with \`status=coming_soon\` it is \`400 VALIDATION_FAILED\`.`,
  })
  @ApiOkResponse({
    type: MovieCardPageResponse,
    description: 'One page of movie cards and the tab counts',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listPublicMovies(@Query() query: MovieListQuery): Promise<MovieCardPageResponse> {
    const view = await this.movies.listMovies(
      {
        status: query.status ?? 'now_showing',
        ...(query.genres === undefined ? {} : { genreSlugs: query.genres }),
        ...(query.people === undefined ? {} : { personIds: query.people }),
        ...(query.q === undefined ? {} : { q: query.q }),
      },
      toPageRequest(query, 'text'),
    );
    return this.mapper.moviePage(view);
  }

  @Get('movies/:id')
  @ApiOperation({
    summary: "A movie's page",
    description: `${PUBLIC_READ_NOTE}\n\nThe header, the media viewer (videos and photos in display order), the synopsis, the details table and the cast and crew. A draft, an archived or an unknown movie is \`404 NOT_FOUND\`. \`showtimeSummary\` is the side panel, from showtimes of theaters open for sales still to start in the next 7 cinema days: the next one today, how many theaters show it and the lowest "from" price (empty for Coming soon). The showtimes themselves are \`GET /movies/{id}/showtimes\`.`,
  })
  @ApiOkResponse({
    type: MovieDetailsResponse,
    description: 'The movie',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async getPublicMovie(@Param() params: MovieIdParams): Promise<MovieDetailsResponse> {
    return this.mapper.movieDetails(await this.movies.findMovie(params.id));
  }

  @Get('movies/:id/similar')
  @ApiOperation({
    summary: '"More like this" for a movie',
    description: `${PUBLIC_READ_NOTE}\n\nUp to 4 Now showing movies sharing the most genres with the movie, then newest release first; never the movie itself. Empty when none shares a genre. A movie that isn't public is \`404 NOT_FOUND\`.`,
  })
  @ApiOkResponse({
    type: SimilarMoviesResponse,
    description: 'Up to 4 movie cards',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'NOT_FOUND', 'SERVICE_UNAVAILABLE')
  async listSimilarMovies(@Param() params: MovieIdParams): Promise<SimilarMoviesResponse> {
    return this.mapper.similar(await this.movies.listSimilar(params.id));
  }

  @Get('people')
  @ApiOperation({
    summary: 'People on public movies (the cast filter)',
    description: `${PUBLIC_READ_NOTE}\n\nPeople credited on a Coming soon or Now showing movie, by name then id, with their roles. \`q\` matches part of a name; \`roleGroup\` keeps Actors, Directors, Writers or Crew. Filter the Movies page by a person with \`/movies?people=<id>\`. Cursor-paginated (default 20, at most 100).`,
  })
  @ApiOkResponse({
    type: PublicPersonPageResponse,
    description: 'One page of people',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('VALIDATION_FAILED', 'SERVICE_UNAVAILABLE')
  async listPublicPeople(@Query() query: PublicPersonListQuery): Promise<PublicPersonPageResponse> {
    const page = await this.movies.listPeople(
      {
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.roleGroup === undefined ? {} : { roleGroup: query.roleGroup }),
      },
      toPageRequest(query, 'text'),
    );
    return this.mapper.personPage(page);
  }
}
