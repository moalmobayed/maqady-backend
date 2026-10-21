import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AdminTheaterPhotosController } from './admin-theater-photos.controller';
import { AdminTheaterSpecialDatesController } from './admin-theater-special-dates.controller';
import { AdminTheatersController } from './admin-theaters.controller';
import { TheaterHoursRepository } from './theater-hours.repository';
import { TheaterHoursService } from './theater-hours.service';
import { TheaterLifecycleRegistry } from './theater-lifecycle.registry';
import { TheaterPhotosRepository } from './theater-photos.repository';
import { TheaterPhotosService } from './theater-photos.service';
import { TheaterReadService } from './theater-read.service';
import { TheaterResponseMapper } from './theater-response.mapper';
import { TheaterSpecialDatesService } from './theater-special-dates.service';
import { TheatersRepository } from './theaters.repository';
import { TheatersService } from './theaters.service';

/**
 * Theaters (design §5, §9; PRD A4): the admin theater routes, and for later units
 *
 * - `TheaterReadService`: theaters by id, `lockForShare()`, and the active ones (U5, U7, U8);
 * - `TheaterHoursService`: opening windows, resolved hours and open states (U7, U8);
 * - `TheaterLifecycleRegistry`: publish requirements (U5's `active_hall`) and deletion
 *   blockers (U7's `has_showtimes`).
 */
@Module({
  imports: [MediaModule],
  controllers: [
    AdminTheatersController,
    AdminTheaterSpecialDatesController,
    AdminTheaterPhotosController,
  ],
  providers: [
    TheatersRepository,
    TheaterHoursRepository,
    TheaterPhotosRepository,
    TheaterLifecycleRegistry,
    TheaterReadService,
    TheaterHoursService,
    TheatersService,
    TheaterSpecialDatesService,
    TheaterPhotosService,
    TheaterResponseMapper,
  ],
  exports: [TheaterReadService, TheaterHoursService, TheaterLifecycleRegistry],
})
export class TheatersModule {}
