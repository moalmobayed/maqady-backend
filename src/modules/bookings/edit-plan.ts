import { AppError } from '../../common/errors/app-error';
import { money, sumMoney } from '../../common/money/money';
import type { FieldError } from '../../common/errors/types';
import { sortedLabels } from '../seating/claim-plan';
import { allocateRefund } from './refund-allocation';
import type {
  BookingContact,
  EditDifference,
  EditedField,
  EditPlan,
  EditPlanInput,
  PlannedSeat,
} from './types';

/**
 * An admin edit as it will be applied (design §7.8; PRD "Cancellations, refunds and edits" 5),
 * decided in one pure function so the preview and the edit can never disagree:
 *
 * - every requested seat must exist in the target hall (`VALIDATION_FAILED` on `seats.<i>`);
 * - a seat kept on the same showtime keeps the price it was sold at; every other seat (a new seat,
 *   or any seat on another showtime) takes the target showtime's current zone price;
 * - the difference is the new total minus the old: `collect` it at the counter, or `refund` it
 *   across the succeeded charges newest first, each on its own rail;
 * - the changed fields are named, never their values; an edit that changes nothing is refused.
 */
export function planEdit(input: EditPlanInput): EditPlan {
  const { row, currentSeats, target } = input;
  const showtimeChanged = target.showtimeId !== row.showtime_id;
  const fields: FieldError[] = input.labels.flatMap((label, index) =>
    target.layout.has(label)
      ? []
      : [{ field: `seats.${index}`, messages: [`${label} is not a seat in this hall.`] }],
  );
  if (fields.length > 0) throw new AppError('VALIDATION_FAILED', undefined, { fields });

  const current = new Map(currentSeats.map((seat) => [seat.seat_label, seat]));
  const labels = sortedLabels(input.labels);
  const seats: PlannedSeat[] = labels.map((label) => {
    const seat = target.layout.get(label)!;
    const sold = showtimeChanged ? undefined : current.get(label);
    return {
      label,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      zone: seat.zone,
      price: sold ? money(sold.price, row.currency) : target.prices[seat.zone],
      isWheelchair: seat.isWheelchair,
      kept: sold !== undefined,
    };
  });
  const seatsChanged =
    labels.length !== current.size || labels.some((label) => !current.has(label));

  const contact: BookingContact = {
    name: input.contact?.name !== undefined ? input.contact.name : row.contact_name,
    email: input.contact?.email !== undefined ? input.contact.email : row.contact_email,
    phone: input.contact?.phone !== undefined ? input.contact.phone : row.contact_phone,
  };
  const changedFields: EditedField[] = [
    ...(showtimeChanged ? (['showtime'] as const) : []),
    ...(seatsChanged ? (['seats'] as const) : []),
    ...(contact.name !== row.contact_name ? (['contactName'] as const) : []),
    ...(contact.email !== row.contact_email ? (['contactEmail'] as const) : []),
    ...(contact.phone !== row.contact_phone ? (['contactPhone'] as const) : []),
  ];
  if (changedFields.length === 0) {
    throw new AppError('VALIDATION_FAILED', undefined, {
      fields: [{ field: 'body', messages: ['The edit changes nothing on this booking.'] }],
    });
  }

  const previousTotal = money(row.total_amount, row.currency);
  const total = sumMoney(
    seats.map((seat) => seat.price),
    row.currency,
  );
  const delta = total.amount - previousTotal.amount;
  const difference: EditDifference = {
    direction: delta > 0 ? 'collect' : delta < 0 ? 'refund' : 'none',
    amount: money(Math.abs(delta), row.currency),
  };
  return {
    seats,
    previousTotal,
    total,
    difference,
    refunds:
      difference.direction === 'refund' ? allocateRefund(input.ledger, difference.amount) : [],
    changedFields,
    contact,
    showtimeChanged,
    seatsChanged,
  };
}
