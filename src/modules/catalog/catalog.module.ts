import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { StaffModule } from '../staff/staff.module';
import { AdminMovieMediaController } from './admin-movie-media.controller';
import { AdminMoviesController } from './admin-movies.controller';
import { AdminPeopleController } from './admin-people.controller';
import { CatalogAssembler } from './catalog-assembler.service';
import { CatalogReadService } from './catalog-read.service';
import { CatalogResponseMapper } from './catalog-response.mapper';
import { CreditsRepository } from './credits.repository';
import { CreditsService } from './credits.service';
import { GenresRepository } from './genres.repository';
import { MovieLifecycleRegistry } from './movie-lifecycle.registry';
import { MovieMediaRepository } from './movie-media.repository';
import { MovieMediaService } from './movie-media.service';
import { MoviesRepository } from './movies.repository';
import { MoviesService } from './movies.service';
import { PeopleRepository } from './people.repository';
import { PeopleService } from './people.service';

/**
 * The catalog (design §5, §9; PRD A2–A3): genres, movies, people, credits, photos and YouTube
 * videos, publishing and the home carousel, with the admin movie and people routes. Other
 * modules read it only through `CatalogReadService` (U7, U8) and refuse deletions through
 * `MovieLifecycleRegistry` (U7, U10).
 */
@Module({
  imports: [MediaModule, StaffModule],
  controllers: [AdminMoviesController, AdminMovieMediaController, AdminPeopleController],
  providers: [
    GenresRepository,
    MoviesRepository,
    MovieMediaRepository,
    PeopleRepository,
    CreditsRepository,
    CatalogAssembler,
    MovieLifecycleRegistry,
    MoviesService,
    MovieMediaService,
    CreditsService,
    PeopleService,
    CatalogReadService,
    CatalogResponseMapper,
  ],
  exports: [CatalogReadService, MovieLifecycleRegistry],
})
export class CatalogModule {}
