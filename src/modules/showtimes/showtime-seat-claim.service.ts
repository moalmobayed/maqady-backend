import { Injectable } from '@nestjs/common';

/**
 * The seam through which the hall lock learns about live seat claims (PRD "Halls and seat maps"
 * 4, design §9): which of these showtimes have a seat held or sold right now. Seating (U10)
 * provides it from `seat_claims`, judging holds by their stored expiry, in one batched query.
 * The `hall_in_use` layout participant calls it with the hall locked `FOR UPDATE`, for the hall's
 * showtimes that have not ended, and refuses the layout save with `HALL_IN_USE` for every one
 * named.
 *
 * `ShowtimesModule` binds `NoSeatClaims` until seat claims exist; U10 rebinds the token.
 */
export abstract class ShowtimeSeatClaimService {
  abstract showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>>;
}

/** Before seat claims exist, no seat is held or sold. */
@Injectable()
export class NoSeatClaims extends ShowtimeSeatClaimService {
  showtimeIdsWithLiveClaims(): Promise<ReadonlySet<number>> {
    return Promise.resolve(new Set<number>());
  }
}
