import { Body, Controller, Module, Post } from '@nestjs/common';
import { IsArray, IsInt, IsString, Min } from 'class-validator';
import { Guest } from '../../src/common/auth/access.decorators';
import { AppError } from '../../src/common/errors/app-error';
import { Strict } from '../../src/common/idempotency/idempotency.decorators';
import { SeatEventPublisher } from '../../src/modules/seating/seat-event.publisher';
import { SeatingModule } from '../../src/modules/seating/seating.module';

/**
 * A test-only write under `/api/v1/test-seat-map` (U10): it publishes a seat event through the
 * real `SeatEventPublisher` inside the request transaction, then fails, so the transaction rolls
 * back. The seat map must never send that event.
 */
export class RolledBackEventBody {
  @IsInt()
  @Min(1)
  showtimeId!: number;

  @IsArray()
  @IsString({ each: true })
  labels!: string[];
}

@Controller('test-seat-map')
export class SeatMapProbeController {
  constructor(private readonly events: SeatEventPublisher) {}

  @Post('rolled-back-events')
  @Guest()
  @Strict()
  async rolledBack(@Body() body: RolledBackEventBody): Promise<never> {
    await this.events.publishAfterCommit({
      type: 'seat.held',
      showtimeId: body.showtimeId,
      labels: body.labels,
      heldUntil: new Date(),
    });
    throw new AppError('CONFLICT');
  }
}

@Module({ imports: [SeatingModule], controllers: [SeatMapProbeController] })
export class SeatMapProbeModule {}
