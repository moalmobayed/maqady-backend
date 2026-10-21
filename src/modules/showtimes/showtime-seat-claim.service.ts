/**
 * The seam through which the hall lock learns about live seat claims (PRD "Halls and seat maps"
 * 4, design §9): which of these showtimes have a seat held or sold right now. Seating (U10)
 * provides it from `seat_claims`, judging holds by their stored expiry, in one batched query.
 * The `hall_in_use` layout participant calls it with the hall locked `FOR UPDATE`, for the hall's
 * showtimes that have not ended, and refuses the layout save with `HALL_IN_USE` for every one
 * named.
 *
 * `ShowtimesModule` binds this token to seating's `SeatAvailabilityService` (`useExisting`, in
 * its own `providers`), which has the same method; seating imports nothing from showtimes.
 */
export abstract class ShowtimeSeatClaimService {
  abstract showtimeIdsWithLiveClaims(showtimeIds: readonly number[]): Promise<ReadonlySet<number>>;
}
