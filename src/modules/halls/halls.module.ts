import { Module } from '@nestjs/common';
import { TheatersModule } from '../theaters/theaters.module';
import { AdminHallsController } from './admin-halls.controller';
import { AdminTheaterHallsController } from './admin-theater-halls.controller';
import { HallLayoutRepository } from './hall-layout.repository';
import { HallLayoutService } from './hall-layout.service';
import { HallLifecycleRegistry } from './hall-lifecycle.registry';
import { HallReadService } from './hall-read.service';
import { HallsRepository } from './halls.repository';
import { HallsService } from './halls.service';

/**
 * Halls (design §5, §9; PRD "Halls and seat maps", A4): the admin hall routes and the layout
 * editor, the `active_hall` publish requirement of theaters, and for later units
 *
 * - `HallReadService`: halls and layouts by id, by theater, and `lockForShare()` (U7, U8, U10);
 * - `HallLifecycleRegistry`: deletion and retirement blockers and layout participants (U7, U10).
 */
@Module({
  imports: [TheatersModule],
  controllers: [AdminTheaterHallsController, AdminHallsController],
  providers: [
    HallsRepository,
    HallLayoutRepository,
    HallLifecycleRegistry,
    HallReadService,
    HallsService,
    HallLayoutService,
  ],
  exports: [HallReadService, HallLifecycleRegistry],
})
export class HallsModule {}
