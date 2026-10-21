import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { HallsModule } from '../halls/halls.module';
import { MediaModule } from '../media/media.module';
import { ShowtimesModule } from '../showtimes/showtimes.module';
import { TheatersModule } from '../theaters/theaters.module';
import { CatalogBrowseController } from './catalog-browse.controller';
import { DiscoveryResponseMapper } from './discovery-response.mapper';
import { HomeTickerSource, ShowtimesTickerSource } from './home-ticker.source';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { MovieBrowseService } from './movie-browse.service';
import { ShowtimeBrowseController } from './showtime-browse.controller';
import { ShowtimeBrowseService } from './showtime-browse.service';
import { TheaterBrowseController } from './theater-browse.controller';
import { TheaterBrowseService } from './theater-browse.service';
import { ActiveHallCountSource, TheaterHallCountSource } from './theater-hall-count.source';

/**
 * Discovery (design §5, §11; PRD C1–C5): the public home page and browsing reads. It owns no
 * table: it reads the catalog through `CatalogReadService`, theaters through
 * `TheaterReadService` and `TheaterHoursService`, halls through `HallReadService` and showtimes
 * through `ShowtimeReadService`.
 *
 * The U8a seams are bound to the real sources (U8b): `HomeTickerSource` to the showtimes
 * (`ShowtimesTickerSource`) and `TheaterHallCountSource` to the active halls
 * (`ActiveHallCountSource`).
 */
@Module({
  imports: [CatalogModule, TheatersModule, HallsModule, ShowtimesModule, MediaModule],
  controllers: [
    HomeController,
    CatalogBrowseController,
    TheaterBrowseController,
    ShowtimeBrowseController,
  ],
  providers: [
    { provide: HomeTickerSource, useClass: ShowtimesTickerSource },
    { provide: TheaterHallCountSource, useClass: ActiveHallCountSource },
    MovieBrowseService,
    TheaterBrowseService,
    ShowtimeBrowseService,
    HomeService,
    DiscoveryResponseMapper,
  ],
  exports: [
    HomeTickerSource,
    TheaterHallCountSource,
    ShowtimeBrowseService,
    DiscoveryResponseMapper,
  ],
})
export class DiscoveryModule {}
