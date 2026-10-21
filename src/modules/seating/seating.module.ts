import { Module } from '@nestjs/common';
import { HoldRefusalService } from './hold-refusal.service';
import { HoldRefusalsRepository } from './hold-refusals.repository';
import { SeatAvailabilityService } from './seat-availability.service';
import { SeatClaimService } from './seat-claim.service';
import { SeatClaimsRepository } from './seat-claims.repository';
import { SeatEventBus } from './seat-event.bus';
import { SeatEventPublisher } from './seat-event.publisher';
import { SeatMapConnections } from './seat-map.connections';
import { SeatMapGateway } from './seat-map.gateway';

/**
 * Seating (design §5, §7.2, §12): `seat_claims` and `hold_refusals`, the in-process seat event
 * bus and the `/ws` seat-map gateway. It depends on no feature module. Bookings (holds, U10;
 * checkout, U11; counter sales, U13; edits and refunds, U14) write claims through
 * `SeatClaimService` and announce them through `SeatEventPublisher`; showtimes (U7's
 * `HALL_IN_USE`), discovery (sold out) and admin screens read `SeatAvailabilityService`.
 */
@Module({
  providers: [
    SeatClaimsRepository,
    HoldRefusalsRepository,
    SeatClaimService,
    SeatAvailabilityService,
    HoldRefusalService,
    SeatEventBus,
    SeatEventPublisher,
    SeatMapConnections,
    SeatMapGateway,
  ],
  exports: [SeatClaimService, SeatAvailabilityService, HoldRefusalService, SeatEventPublisher],
})
export class SeatingModule {}
