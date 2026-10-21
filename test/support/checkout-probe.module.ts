import { Body, Controller, Module, Post } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsInt, IsString, Min } from 'class-validator';
import { Customer, CurrentPrincipal } from '../../src/common/auth/access.decorators';
import type { CustomerPrincipal } from '../../src/common/auth/types';
import { AppError } from '../../src/common/errors/app-error';
import { Strict } from '../../src/common/idempotency/idempotency.decorators';
import { BookingConfirmationService } from '../../src/modules/bookings/booking-confirmation.service';
import { BookingsModule } from '../../src/modules/bookings/bookings.module';

/**
 * A test-only write under `/api/v1/test-checkout` (U11): it confirms a held booking through the
 * real `BookingConfirmationService` inside the request transaction, then fails, so the
 * transaction rolls back. No tickets message may be stored or sent, and no `seat.booked` sent.
 */
export class ConfirmThenFailBody {
  @IsInt()
  @Min(1)
  bookingId!: number;

  @IsInt()
  @Min(1)
  showtimeId!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  labels!: string[];
}

@Controller('test-checkout')
export class CheckoutProbeController {
  constructor(private readonly confirmation: BookingConfirmationService) {}

  @Post('confirm-then-fail')
  @Customer()
  @Strict()
  async confirmThenFail(
    @CurrentPrincipal() principal: CustomerPrincipal,
    @Body() body: ConfirmThenFailBody,
  ): Promise<never> {
    await this.confirmation.confirm(
      [
        {
          bookingId: body.bookingId,
          showtimeId: body.showtimeId,
          channel: 'online',
          labels: body.labels,
        },
      ],
      { kind: 'customer', id: principal.id },
    );
    throw new AppError('CONFLICT');
  }
}

@Module({ imports: [BookingsModule], controllers: [CheckoutProbeController] })
export class CheckoutProbeModule {}
