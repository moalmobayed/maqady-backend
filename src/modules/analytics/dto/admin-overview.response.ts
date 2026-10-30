import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MoneyResponse } from '../../../common/money/dto/money-response.dto';
import { NamedRefResponse } from '../../bookings/dto/booking-showtime.response';
import { PAYMENT_METHODS } from '../../payments/enums';
import type { PaymentMethod } from '../../payments/types';
import { COMPARISON_BASES, OVERVIEW_PERIODS, SHOWTIME_SLOTS } from '../enums';
import type { ComparisonBasis, OverviewPeriodPreset, ShowtimeSlot } from '../types';

const RATIO_DESCRIPTION = 'a ratio with 4 decimals: 0.4567 is 45.67%';

const CHANGE_DESCRIPTION =
  'The relative change against `previous`: `(value − previous) ÷ previous`, 4 decimals (0.125 is +12.5%, −0.2 is −20%). Null when `previous` is 0 or null.';

/** The Overview's period: whole cinema days, and the instants they span. */
@ApiSchema({ name: 'OverviewPeriod' })
export class OverviewPeriodResponse {
  @ApiProperty({
    enum: OVERVIEW_PERIODS,
    enumName: 'OverviewPeriodPreset',
    nullable: true,
    example: '7d',
    description: 'The preset asked for; null when the period was given as dates.',
  })
  preset!: OverviewPeriodPreset | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-10',
    description: 'The first cinema date.',
  })
  dateFrom!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The last cinema date, inclusive.',
  })
  dateTo!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 366,
    example: 7,
    description: 'How many cinema days.',
  })
  days!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-10T06:00:00+03:00',
    description: 'The period starts here: 06:00 Cairo time on `dateFrom`.',
  })
  from!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-17T06:00:00+03:00',
    description: 'The period ends here, exclusive: 06:00 Cairo time the morning after `dateTo`.',
  })
  to!: string;
}

/** What the KPI cards compare with (PRD "Comparisons"). */
@ApiSchema({ name: 'OverviewComparison' })
export class OverviewComparisonResponse {
  @ApiProperty({
    enum: COMPARISON_BASES,
    enumName: 'ComparisonBasis',
    nullable: false,
    example: 'previous_period',
    description:
      '`same_weekday_last_week` for a single day ("vs last Thursday"); `previous_period` for a longer period ("vs previous 7 days").',
  })
  basis!: ComparisonBasis;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-03',
    description: 'The first cinema date compared with.',
  })
  dateFrom!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-09',
    description: 'The last cinema date compared with, inclusive.',
  })
  dateTo!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 7,
    description: "How many cinema days: always the period's.",
  })
  days!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-03T06:00:00+03:00',
    description: '06:00 Cairo time on `dateFrom`.',
  })
  from!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-10T06:00:00+03:00',
    description: '06:00 Cairo time the morning after `dateTo`, exclusive.',
  })
  to!: string;
}

/** A money KPI card. */
@ApiSchema({ name: 'MoneyKpi' })
export class MoneyKpiResponse {
  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'In the period.' })
  value!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'In the comparison period.',
  })
  previous!: MoneyResponse;

  @ApiProperty({ type: Number, nullable: true, example: 0.125, description: CHANGE_DESCRIPTION })
  change!: number | null;
}

/** A money KPI card that can be empty (the average ticket without tickets). */
@ApiSchema({ name: 'OptionalMoneyKpi' })
export class OptionalMoneyKpiResponse {
  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description: 'In the period; null without tickets.',
  })
  value!: MoneyResponse | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description: 'In the comparison period; null without tickets.',
  })
  previous!: MoneyResponse | null;

  @ApiProperty({ type: Number, nullable: true, example: -0.04, description: CHANGE_DESCRIPTION })
  change!: number | null;
}

/** A count KPI card. */
@ApiSchema({ name: 'CountKpi' })
export class CountKpiResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 412,
    description: 'In the period.',
  })
  value!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 380,
    description: 'In the comparison period.',
  })
  previous!: number;

  @ApiProperty({ type: Number, nullable: true, example: 0.0842, description: CHANGE_DESCRIPTION })
  change!: number | null;
}

/** A ratio KPI card (occupancy, counter share). */
@ApiSchema({ name: 'RatioKpi' })
export class RatioKpiResponse {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 0.4567,
    description: `In the period, ${RATIO_DESCRIPTION}. Null when there is nothing to divide by.`,
  })
  value!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 0.41,
    description: `In the comparison period, ${RATIO_DESCRIPTION}. Null when there is nothing to divide by.`,
  })
  previous!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 0.1139, description: CHANGE_DESCRIPTION })
  change!: number | null;
}

/** The five KPI cards (PRD A1; "Dashboard numbers"). */
@ApiSchema({ name: 'OverviewKpis' })
export class OverviewKpisResponse {
  @ApiProperty({
    type: () => MoneyKpiResponse,
    nullable: false,
    description:
      'Revenue: the totals of Confirmed and Completed bookings, counted on the cinema day of their showtime. A refunded booking drops out.',
  })
  revenue!: MoneyKpiResponse;

  @ApiProperty({
    type: () => CountKpiResponse,
    nullable: false,
    description:
      'Tickets sold: the seats of those bookings. Held, Failed, Abandoned and Refunded never count.',
  })
  ticketsSold!: CountKpiResponse;

  @ApiProperty({
    type: () => RatioKpiResponse,
    nullable: false,
    description:
      "Occupancy: tickets sold ÷ seats on sale across the period's scheduled showtimes (gaps are not seats, wheelchair spaces are; cancelled showtimes are left out). Null without showtimes.",
  })
  occupancy!: RatioKpiResponse;

  @ApiProperty({
    type: () => OptionalMoneyKpiResponse,
    nullable: false,
    description: 'Avg. ticket: revenue ÷ tickets sold, in whole piastres. Null without tickets.',
  })
  averageTicket!: OptionalMoneyKpiResponse;

  @ApiProperty({
    type: () => RatioKpiResponse,
    nullable: false,
    description:
      "Counter share: the share of those bookings' money taken at the box office (cash and card terminal, net of refunds). Null without money.",
  })
  counterShare!: RatioKpiResponse;
}

/** Sold, on sale and the share between them. */
@ApiSchema({ name: 'SalesFigures' })
export class SalesFiguresResponse {
  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Revenue, by the cinema day of the showtime.',
  })
  revenue!: MoneyResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 96,
    description: 'Tickets sold.',
  })
  ticketsSold!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 384,
    description: 'Seats on sale across the scheduled showtimes.',
  })
  seatsOnSale!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 0.25,
    description: `Occupancy, ${RATIO_DESCRIPTION}: the scheduled showtimes' tickets ÷ their seats. Null without scheduled showtimes.`,
  })
  occupancy!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 2,
    description: 'Scheduled showtimes (cancelled ones are left out).',
  })
  showtimeCount!: number;
}

/** A row of "Revenue by theater" (PRD A1). */
@ApiSchema({ name: 'TheaterRevenue' })
export class TheaterRevenueResponse extends SalesFiguresResponse {
  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The theater.' })
  theater!: NamedRefResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: true,
    description: 'Avg. ticket: revenue ÷ tickets sold; null without tickets.',
  })
  averageTicket!: MoneyResponse | null;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The "Online" part: card and wallet money of these bookings, net of refunds.',
  })
  online!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'The "Counter" part: cash and card-terminal money, net of refunds owed.',
  })
  counter!: MoneyResponse;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Revenue in the comparison period.',
  })
  previousRevenue!: MoneyResponse;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0.08,
    description: `"VS PREV": ${CHANGE_DESCRIPTION}`,
  })
  change!: number | null;
}

/** A row of "Revenue by hall" (PRD A1). */
@ApiSchema({ name: 'HallRevenue' })
export class HallRevenueResponse extends SalesFiguresResponse {
  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The hall.' })
  hall!: NamedRefResponse;
}

/** A row of "Top movies by revenue" (PRD A1). */
@ApiSchema({ name: 'MovieRevenue' })
export class MovieRevenueResponse extends SalesFiguresResponse {
  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description: 'The movie: its id and title (`name`).',
  })
  movie!: NamedRefResponse;
}

/** One slice of "Payment methods" (PRD A1). */
@ApiSchema({ name: 'MethodRevenue' })
export class MethodRevenueResponse {
  @ApiProperty({
    enum: PAYMENT_METHODS,
    enumName: 'PaymentMethod',
    nullable: false,
    example: 'card',
    description: '`card`, `wallet`, `cash` or `card_terminal`.',
  })
  method!: PaymentMethod;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description:
      "The money of the period's bookings on this method: succeeded charges minus refunds (a counter refund still to pay out included).",
  })
  amount!: MoneyResponse;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 0.62,
    description: `This method ÷ all methods, ${RATIO_DESCRIPTION}. Null when nothing was taken.`,
  })
  share!: number | null;
}

/** One cell of the busy-times heatmap. */
@ApiSchema({ name: 'HeatmapCell' })
export class HeatmapCellResponse {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 7,
    example: 4,
    description: "The cinema date's ISO weekday: 1 Monday … 7 Sunday.",
  })
  weekday!: number;

  @ApiProperty({
    enum: SHOWTIME_SLOTS,
    enumName: 'ShowtimeSlot',
    nullable: false,
    example: '18_21',
    description:
      'By local start time: `before_15` (06:00–14:59, morning shows included), `15_18`, `18_21`, `21_24`, `after_midnight` (00:00–05:59, still the previous cinema day).',
  })
  slot!: ShowtimeSlot;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 3,
    description: 'Scheduled showtimes in the cell.',
  })
  showtimeCount!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 210,
    description: 'Their tickets sold.',
  })
  ticketsSold!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 576,
    description: 'Their seats on sale.',
  })
  seatsOnSale!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 0.3646,
    description: `"% of seats sold", ${RATIO_DESCRIPTION}. Null for an empty cell.`,
  })
  occupancy!: number | null;
}

/** Revenue on one cinema day. */
@ApiSchema({ name: 'RevenuePoint' })
export class RevenuePointResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'The cinema date.',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => MoneyResponse,
    nullable: false,
    description: 'Revenue of the showtimes on that cinema date (0 when none).',
  })
  revenue!: MoneyResponse;
}

/** One theater's line of "Revenue · last 30 days". */
@ApiSchema({ name: 'TheaterRevenueSeries' })
export class TheaterRevenueSeriesResponse {
  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The theater.' })
  theater!: NamedRefResponse;

  @ApiProperty({
    type: () => RevenuePointResponse,
    isArray: true,
    nullable: false,
    description: 'Every cinema date of the window, oldest first.',
  })
  points!: RevenuePointResponse[];
}

/** "Revenue · last 30 days" (PRD A1). */
@ApiSchema({ name: 'RevenueTrend' })
export class RevenueTrendResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-09-17',
    description: 'The first cinema date: 29 days before `dateTo`.',
  })
  dateFrom!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: "The last cinema date: the period's `dateTo`.",
  })
  dateTo!: string;

  @ApiProperty({
    type: () => RevenuePointResponse,
    isArray: true,
    nullable: false,
    description: 'All theaters in scope: 30 points, oldest first.',
  })
  totals!: RevenuePointResponse[];

  @ApiProperty({
    type: () => TheaterRevenueSeriesResponse,
    isArray: true,
    nullable: false,
    description:
      'One line per theater with revenue in the window (and the selected theater), by name: the legend.',
  })
  theaters!: TheaterRevenueSeriesResponse[];
}

/** A showtime of the "Tonight" list. */
@ApiSchema({ name: 'TonightShowtime' })
export class TonightShowtimeResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 81, description: 'Showtime id.' })
  showtimeId!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T21:30:00+03:00',
    description: 'Starts at.',
  })
  startsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T23:38:00+03:00',
    description: 'Ends at.',
  })
  endsAt!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: 'Its cinema date: today.',
  })
  cinemaDate!: string;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description: 'True once it has started (it stays listed until it ends).',
  })
  hasStarted!: boolean;

  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: false,
    description: 'The movie: id and title (`name`).',
  })
  movie!: NamedRefResponse;

  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The theater.' })
  theater!: NamedRefResponse;

  @ApiProperty({ type: () => NamedRefResponse, nullable: false, description: 'The hall.' })
  hall!: NamedRefResponse;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 54,
    description: 'Seats in Confirmed bookings (holds do not count).',
  })
  ticketsSold!: number;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 192,
    description: 'Seats on sale.',
  })
  seatCapacity!: number;

  @ApiProperty({
    type: Number,
    nullable: false,
    minimum: 0,
    example: 0.2813,
    description: `"% sold", ${RATIO_DESCRIPTION}. The dashboard marks above 0.85 and below 0.35.`,
  })
  soldShare!: number;

  @ApiProperty({ type: () => MoneyResponse, nullable: false, description: 'Its revenue.' })
  revenue!: MoneyResponse;
}

/** "Tonight" (PRD A1): today's showtimes still to end, whatever the period. */
@ApiSchema({ name: 'TonightList' })
export class TonightListResponse {
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: "Today's cinema date.",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: () => TonightShowtimeResponse,
    isArray: true,
    nullable: false,
    description: 'Up to 20, soonest first.',
  })
  items!: TonightShowtimeResponse[];

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 26,
    description: "Today's scheduled showtimes still to end in scope, beyond the 20 too.",
  })
  total!: number;
}

/** `GET /admin/overview` (PRD A1). */
@ApiSchema({ name: 'AdminOverview' })
export class AdminOverviewResponse {
  @ApiProperty({ type: () => OverviewPeriodResponse, nullable: false, description: 'The period.' })
  period!: OverviewPeriodResponse;

  @ApiProperty({
    type: () => OverviewComparisonResponse,
    nullable: false,
    description: 'What the KPI cards and "VS PREV" compare with.',
  })
  comparison!: OverviewComparisonResponse;

  @ApiProperty({
    type: () => NamedRefResponse,
    nullable: true,
    description: 'The selected theater; null for all theaters.',
  })
  theater!: NamedRefResponse | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description: "Today's cinema date.",
  })
  cinemaDate!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T15:10:00+03:00',
    description: 'When the numbers were computed ("Updated 15:10").',
  })
  serverTime!: string;

  @ApiProperty({ type: () => OverviewKpisResponse, nullable: false, description: 'The KPI cards.' })
  kpis!: OverviewKpisResponse;

  @ApiProperty({
    type: () => TheaterRevenueResponse,
    isArray: true,
    nullable: false,
    description:
      '"Revenue by theater": every theater in scope with a showtime in the period (or revenue in the comparison), highest revenue first.',
  })
  byTheater!: TheaterRevenueResponse[];

  @ApiProperty({
    type: () => HallRevenueResponse,
    isArray: true,
    nullable: true,
    description:
      '"Revenue by hall", only with `theaterId`: each hall with a showtime in the period, highest revenue first. Null for all theaters.',
  })
  byHall!: HallRevenueResponse[] | null;

  @ApiProperty({
    type: () => MethodRevenueResponse,
    isArray: true,
    nullable: false,
    description: '"Payment methods": card, wallet, cash, card terminal, always all four.',
  })
  paymentMethods!: MethodRevenueResponse[];

  @ApiProperty({
    type: () => MovieRevenueResponse,
    isArray: true,
    nullable: false,
    description:
      '"Top movies by revenue": at most 5 movies with a showtime in the period, highest revenue first (then tickets, then title).',
  })
  topMovies!: MovieRevenueResponse[];

  @ApiProperty({
    type: () => HeatmapCellResponse,
    isArray: true,
    nullable: false,
    description:
      'The busy-times heatmap: 35 cells, weekday 1 (Monday) to 7, each with the 5 slots in order.',
  })
  heatmap!: HeatmapCellResponse[];

  @ApiProperty({
    type: () => RevenueTrendResponse,
    nullable: false,
    description: '"Revenue · last 30 days": the 30 cinema days ending on `period.dateTo`.',
  })
  revenueTrend!: RevenueTrendResponse;

  @ApiProperty({
    type: () => TonightListResponse,
    nullable: false,
    description: '"Tonight": today\'s showtimes in scope still to end, whatever the period.',
  })
  tonight!: TonightListResponse;
}
