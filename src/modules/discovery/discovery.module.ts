import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MediaModule } from '../media/media.module';
import { TheatersModule } from '../theaters/theaters.module';
import { CatalogBrowseController } from './catalog-browse.controller';
import { DiscoveryResponseMapper } from './discovery-response.mapper';
import { HomeTickerSource, NoShowtimesTickerSource } from './home-ticker.source';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { MovieBrowseService } from './movie-browse.service';
import { TheaterBrowseController } from './theater-browse.controller';
import { TheaterBrowseService } from './theater-browse.service';
import { NoHallsCountSource, TheaterHallCountSource } from './theater-hall-count.source';

/**
 * Discovery (design §5, §11; PRD C1–C5): the public home page and browsing reads. It owns no
 * table: it reads the catalog through `CatalogReadService` and theaters through
 * `TheaterReadService` and `TheaterHoursService`.
 *
 * Two seams wait for showtimes and halls (U8b swaps the providers): `HomeTickerSource` (the
 * ticker; empty for now) and `TheaterHallCountSource` (`hallCount`; 0 for now).
 */
@Module({
  imports: [CatalogModule, TheatersModule, MediaModule],
  controllers: [HomeController, CatalogBrowseController, TheaterBrowseController],
  providers: [
    { provide: HomeTickerSource, useClass: NoShowtimesTickerSource },
    { provide: TheaterHallCountSource, useClass: NoHallsCountSource },
    MovieBrowseService,
    TheaterBrowseService,
    HomeService,
    DiscoveryResponseMapper,
  ],
  exports: [HomeTickerSource, TheaterHallCountSource, DiscoveryResponseMapper],
})
export class DiscoveryModule {}
