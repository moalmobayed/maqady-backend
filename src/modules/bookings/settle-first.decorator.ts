/**
 * `@SettleFirst()` (design §7.1 step 1, §7.5), kept at this path for the bookings controllers. It
 * lives in `common/settlement` since U14, so showtimes' routes can use it without importing
 * bookings.
 */
export { SettleFirst } from '../../common/settlement/settle-first.decorator';
