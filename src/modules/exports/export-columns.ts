import type { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { AdminCustomerResponse } from '../admin-customers/dto/admin-customer.response';
import type { AdminTransactionResponse } from '../analytics/dto/admin-transaction.response';
import type { AdminBookingListItemResponse } from '../bookings/dto/admin-booking-list-item.response';
import { decimalOf } from './csv';
import { LIST_SEPARATOR } from './exports.constants';
import type { CsvColumn, CsvValue, OverviewFigureRow } from './types';

/**
 * The columns of each CSV file, read from the response DTO its list route answers, so a file's
 * row is the screen's row (U19): times in Cairo ISO with their offset, money in pounds as a
 * decimal number with its currency in a column of its own.
 */

function amountOf(value: MoneyResponse | null): CsvValue {
  return value === null ? null : decimalOf(value.amount);
}

/** `GET /admin/exports/bookings.csv`: a row of `GET /admin/bookings`. */
export const BOOKING_COLUMNS: readonly CsvColumn<AdminBookingListItemResponse>[] = [
  { header: 'Reference', value: (row) => row.reference },
  { header: 'Status', value: (row) => row.status },
  { header: 'Payment status', value: (row) => row.paymentStatus },
  { header: 'Channel', value: (row) => row.channel },
  { header: 'Owner', value: (row) => row.owner },
  { header: 'Contact name', value: (row) => row.contact.name },
  { header: 'Contact email', value: (row) => row.contact.email },
  { header: 'Contact phone', value: (row) => row.contact.phone },
  { header: 'Movie', value: (row) => row.showtime.movie.title },
  { header: 'Theater', value: (row) => row.showtime.theater.name },
  { header: 'Hall', value: (row) => row.showtime.hall.name },
  { header: 'Starts at', value: (row) => row.showtime.startsAt },
  { header: 'Cinema date', value: (row) => row.showtime.cinemaDate },
  { header: 'Seats', value: (row) => row.seatLabels.join(LIST_SEPARATOR) },
  { header: 'Seat count', value: (row) => row.seatCount },
  { header: 'Total', value: (row) => amountOf(row.total) },
  { header: 'Currency', value: (row) => row.total.currency },
  { header: 'Payment method', value: (row) => row.payment?.method ?? null },
  { header: 'Card brand', value: (row) => row.payment?.card?.brand ?? null },
  { header: 'Card last 4', value: (row) => row.payment?.card?.last4 ?? null },
  { header: 'Wallet', value: (row) => row.payment?.walletType ?? null },
  { header: 'Receipt reference', value: (row) => row.payment?.receiptReference ?? null },
  { header: 'Created at', value: (row) => row.createdAt },
  { header: 'Confirmed at', value: (row) => row.confirmedAt },
  { header: 'Checked in at', value: (row) => row.checkedInAt },
];

/** `GET /admin/exports/customers.csv`: a row of `GET /admin/customers`. */
export const CUSTOMER_COLUMNS: readonly CsvColumn<AdminCustomerResponse>[] = [
  { header: 'ID', value: (row) => row.id },
  { header: 'Full name', value: (row) => row.fullName },
  { header: 'Email', value: (row) => row.email },
  { header: 'Phone', value: (row) => row.phone },
  { header: 'Status', value: (row) => row.status },
  { header: 'Email verified', value: (row) => row.emailVerified },
  { header: 'Email verified at', value: (row) => row.emailVerifiedAt },
  { header: 'Joined at', value: (row) => row.joinedAt },
  { header: 'Last sign-in at', value: (row) => row.lastSignInAt },
  { header: 'Updated at', value: (row) => row.updatedAt },
  { header: 'Bookings', value: (row) => row.stats.bookings },
  { header: 'Spent', value: (row) => amountOf(row.stats.spent) },
  { header: 'Currency', value: (row) => row.stats.spent.currency },
  { header: 'No-shows', value: (row) => row.stats.noShows },
  { header: 'Last booking at', value: (row) => row.stats.lastBookingAt },
];

/** `GET /admin/exports/payments.csv`: a row of `GET /admin/payments`; a refund is negative. */
export const PAYMENT_COLUMNS: readonly CsvColumn<AdminTransactionResponse>[] = [
  { header: 'ID', value: (row) => row.id },
  { header: 'Occurred at', value: (row) => row.occurredAt },
  { header: 'Cinema date', value: (row) => row.cinemaDate },
  { header: 'Kind', value: (row) => row.kind },
  { header: 'Purpose', value: (row) => row.purpose },
  { header: 'Method', value: (row) => row.method },
  { header: 'Channel', value: (row) => row.channel },
  { header: 'Status', value: (row) => row.status },
  { header: 'Failure reason', value: (row) => row.failureReason },
  { header: 'Ledger status', value: (row) => row.ledgerStatus },
  { header: 'Amount', value: (row) => amountOf(row.amount) },
  { header: 'Currency', value: (row) => row.amount.currency },
  { header: 'Refund of payment', value: (row) => row.refundOfPaymentId },
  { header: 'Refunded amount', value: (row) => amountOf(row.refundedAmount) },
  { header: 'Pending refund amount', value: (row) => amountOf(row.pendingRefundAmount) },
  { header: 'Booking reference', value: (row) => row.booking.reference },
  { header: 'Booking channel', value: (row) => row.booking.channel },
  { header: 'Contact name', value: (row) => row.booking.contactName },
  { header: 'Theater ID', value: (row) => row.theater.id },
  { header: 'Theater', value: (row) => row.theater.name },
  { header: 'Card brand', value: (row) => row.card?.brand ?? null },
  { header: 'Card last 4', value: (row) => row.card?.last4 ?? null },
  { header: 'Wallet', value: (row) => row.walletType },
  { header: 'Receipt reference', value: (row) => row.receiptReference },
  { header: 'Collected by', value: (row) => row.collectedBy?.fullName ?? null },
  { header: 'Paid out at', value: (row) => row.paidOutAt },
  { header: 'Paid out by', value: (row) => row.paidOutBy?.fullName ?? null },
  { header: 'Created at', value: (row) => row.createdAt },
  { header: 'Completed at', value: (row) => row.completedAt },
];

/** `GET /admin/exports/overview.csv`: one figure of `GET /admin/overview` per row. */
export const OVERVIEW_COLUMNS: readonly CsvColumn<OverviewFigureRow>[] = [
  { header: 'Section', value: (row) => row.section },
  { header: 'Cinema date', value: (row) => row.cinemaDate },
  { header: 'Subject ID', value: (row) => row.subjectId },
  { header: 'Subject', value: (row) => row.subject },
  { header: 'Metric', value: (row) => row.metric },
  { header: 'Unit', value: (row) => row.unit },
  { header: 'Value', value: (row) => row.value },
  { header: 'Previous', value: (row) => row.previous },
  { header: 'Change', value: (row) => row.change },
];
