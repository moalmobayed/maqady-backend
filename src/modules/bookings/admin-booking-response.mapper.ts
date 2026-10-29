import { Injectable } from '@nestjs/common';
import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Money } from '../../common/money/types';
import type { Page } from '../../common/pagination/types';
import { formatCairoIso } from '../../common/time/time';
import { BookingResponseMapper, toPaymentResponse } from './booking-response.mapper';
import {
  AdminActivityEventResponse,
  AdminBookingActionsResponse,
  AdminBookingResponse,
  AdminCustomerCardResponse,
  BookingContactResponse,
} from './dto/admin-booking.response';
import {
  AdminBookingListItemPageResponse,
  AdminBookingListItemResponse,
} from './dto/admin-booking-list-item.response';
import {
  AdminBookingSummaryResponse,
  RefundedCardResponse,
} from './dto/admin-booking-summary.response';
import { AdminPaymentResponse, StaffRefResponse } from './dto/admin-payment.response';
import {
  BookingEditPreviewResponse,
  BookingEditResultResponse,
  EditDifferenceResponse,
  EditPreviewCurrentResponse,
  EditPreviewProposedResponse,
  PlannedRefundResponse,
  PlannedSeatResponse,
} from './dto/booking-edit.response';
import { BookingNotePageResponse, BookingNoteResponse } from './dto/booking-note.response';
import { BookingRefundResultResponse } from './dto/booking-refund-result.response';
import { BookingSeatResponse } from './dto/booking-seat.response';
import { ShowtimeCancellationPreviewResponse } from './dto/showtime-cancellation-preview.response';
import { StaffTicketDeliveryResponse } from './dto/staff-ticket-delivery.response';
import { PaymentCardResponse } from './dto/payment.response';
import { inSeatOrder } from './seat-lines';
import type {
  AdminBookingDetail,
  AdminBookingListItem,
  AdminBookingSummary,
  AdminLedgerEntry,
  BookingContact,
  BookingNote,
  BookingRefundResult,
  BookingSeat,
  EditDifference,
  EditPreview,
  EditResult,
  PlannedSeat,
  ShowtimeCancellationPreview,
  StaffRef,
  StaffTicketDelivery,
} from './types';
import type { LedgerEntry } from '../payments/types';

/**
 * Response DTOs of the admin booking routes (U14): times in Cairo ISO with their offset, money as
 * `{ amount, currency }`, built on `BookingResponseMapper` for every `Booking` field.
 */
@Injectable()
export class AdminBookingResponseMapper {
  constructor(private readonly bookings: BookingResponseMapper) {}

  listPage(
    page: Page<AdminBookingListItem>,
  ): InstanceType<typeof AdminBookingListItemPageResponse> {
    return Object.assign(new AdminBookingListItemPageResponse(), {
      items: page.items.map((item) => this.listItem(item)),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  listItem({ booking, contact, checkedInAt }: AdminBookingListItem): AdminBookingListItemResponse {
    return Object.assign(new AdminBookingListItemResponse(), {
      reference: booking.reference,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      channel: booking.channel,
      owner: booking.owner,
      contact: toContact(contact),
      showtime: this.bookings.showtime(booking.showtime),
      seatLabels: inSeatOrder(booking.seats).map((seat) => seat.label),
      seatCount: booking.seatCount,
      total: toMoney(booking.total),
      payment: booking.payment === null ? null : toPaymentResponse(booking.payment),
      createdAt: formatCairoIso(booking.createdAt),
      confirmedAt: booking.confirmedAt === null ? null : formatCairoIso(booking.confirmedAt),
      checkedInAt: checkedInAt === null ? null : formatCairoIso(checkedInAt),
    });
  }

  detail(detail: AdminBookingDetail): AdminBookingResponse {
    const { customer } = detail;
    return Object.assign(new AdminBookingResponse(), {
      ...this.bookings.booking(detail.booking),
      contact: toContact(detail.contact),
      customer:
        customer === null
          ? null
          : Object.assign(new AdminCustomerCardResponse(), {
              id: customer.id,
              fullName: customer.fullName,
              email: customer.email,
              phone: customer.phone,
              status: customer.status,
              anonymised: customer.anonymised,
            }),
      soldBy: toStaffRef(detail.soldBy),
      checkedInAt: detail.checkedInAt === null ? null : formatCairoIso(detail.checkedInAt),
      checkedInBy: toStaffRef(detail.checkedInBy),
      payments: detail.ledger.map((entry) => toAdminPayment(entry)),
      refundable: toMoney(detail.refundable),
      actions: Object.assign(new AdminBookingActionsResponse(), detail.actions),
      activity: detail.activity.map((event) =>
        Object.assign(new AdminActivityEventResponse(), {
          action: event.action,
          occurredAt: formatCairoIso(event.occurredAt),
          actorKind: event.actorKind,
          staff: toStaffRef(event.staff),
          changedFields: [...event.changedFields],
          metadata: { ...event.metadata },
        }),
      ),
    });
  }

  summary(summary: AdminBookingSummary): AdminBookingSummaryResponse {
    return Object.assign(new AdminBookingSummaryResponse(), {
      cinemaDate: summary.cinemaDate,
      serverTime: formatCairoIso(summary.serverTime),
      todayBookings: summary.todayBookings,
      collectedToday: toMoney(summary.collectedToday),
      failedPaymentsToday: summary.failedPaymentsToday,
      refundedLast7Days: Object.assign(new RefundedCardResponse(), {
        bookingCount: summary.refundedLast7Days.bookingCount,
        amount: toMoney(summary.refundedLast7Days.amount),
      }),
    });
  }

  notePage(page: Page<BookingNote>): InstanceType<typeof BookingNotePageResponse> {
    return Object.assign(new BookingNotePageResponse(), {
      items: page.items.map((note) => this.note(note)),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  note(note: BookingNote): BookingNoteResponse {
    return Object.assign(new BookingNoteResponse(), {
      id: note.id,
      body: note.body,
      author: toStaffRef(note.author),
      createdAt: formatCairoIso(note.createdAt),
    });
  }

  delivery(delivery: StaffTicketDelivery): StaffTicketDeliveryResponse {
    return Object.assign(new StaffTicketDeliveryResponse(), {
      channels: [...delivery.channels],
      queuedAt: formatCairoIso(delivery.queuedAt),
    });
  }

  payment(entry: AdminLedgerEntry): AdminPaymentResponse {
    return toAdminPayment(entry);
  }

  refundResult(result: BookingRefundResult): BookingRefundResultResponse {
    return Object.assign(new BookingRefundResultResponse(), {
      refunds: result.refunds.map((refund) => toAdminPayment(withoutStaff(refund))),
      booking: this.bookings.booking(result.booking),
    });
  }

  editPreview(preview: EditPreview): BookingEditPreviewResponse {
    return Object.assign(new BookingEditPreviewResponse(), {
      current: Object.assign(new EditPreviewCurrentResponse(), {
        showtime: this.bookings.showtime(preview.current.showtime),
        seats: inSeatOrder(preview.current.seats).map(toSeat),
        total: toMoney(preview.current.total),
      }),
      proposed: Object.assign(new EditPreviewProposedResponse(), {
        showtime: this.bookings.showtime(preview.proposed.showtime),
        seats: inSeatOrder(preview.proposed.seats).map(toPlannedSeat),
        total: toMoney(preview.proposed.total),
      }),
      difference: toDifference(preview.difference),
      refunds: preview.refunds.map((refund) =>
        Object.assign(new PlannedRefundResponse(), {
          paymentId: refund.charge.id,
          method: refund.charge.method,
          amount: toMoney(refund.amount),
        }),
      ),
      changedFields: [...preview.changedFields],
      unavailableSeats: [...preview.unavailableSeats],
    });
  }

  editResult(result: EditResult): BookingEditResultResponse {
    return Object.assign(new BookingEditResultResponse(), {
      booking: this.bookings.booking(result.booking),
      difference: toDifference(result.difference),
      changedFields: [...result.changedFields],
      payments: result.payments.map((entry) => toAdminPayment(withoutStaff(entry))),
    });
  }

  cancellationPreview(preview: ShowtimeCancellationPreview): ShowtimeCancellationPreviewResponse {
    return Object.assign(new ShowtimeCancellationPreviewResponse(), {
      ...preview,
      refundedOnline: toMoney(preview.refundedOnline),
      owedAtCounter: toMoney(preview.owedAtCounter),
    });
  }
}

/** A ledger entry whose staff are not named (rows just written by the caller's request). */
function withoutStaff(entry: LedgerEntry): AdminLedgerEntry {
  return { entry, collectedBy: null, paidOutBy: null };
}

function toAdminPayment({ entry, collectedBy, paidOutBy }: AdminLedgerEntry): AdminPaymentResponse {
  return Object.assign(new AdminPaymentResponse(), {
    id: entry.id,
    kind: entry.kind,
    purpose: entry.purpose,
    method: entry.method,
    status: entry.status,
    amount: toMoney(entry.amount),
    refundOfPaymentId: entry.refundOfPaymentId,
    refundable: entry.refundable === null ? null : toMoney(entry.refundable),
    receiptReference:
      entry.kind === 'charge' && entry.method === 'card_terminal' ? entry.providerReference : null,
    card:
      entry.card === null
        ? null
        : Object.assign(new PaymentCardResponse(), {
            brand: entry.card.brand,
            last4: entry.card.last4,
          }),
    walletType: entry.walletType,
    collectedBy: toStaffRef(collectedBy),
    paidOutAt: entry.paidOutAt === null ? null : formatCairoIso(entry.paidOutAt),
    paidOutBy: toStaffRef(paidOutBy),
    createdAt: formatCairoIso(entry.createdAt),
    completedAt: entry.completedAt === null ? null : formatCairoIso(entry.completedAt),
  });
}

function toStaffRef(ref: StaffRef | null): StaffRefResponse | null {
  return ref === null
    ? null
    : Object.assign(new StaffRefResponse(), { id: ref.id, fullName: ref.fullName });
}

function toContact(contact: BookingContact): BookingContactResponse {
  return Object.assign(new BookingContactResponse(), {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
  });
}

function toSeat(seat: BookingSeat): BookingSeatResponse {
  return Object.assign(new BookingSeatResponse(), {
    label: seat.label,
    rowLabel: seat.rowLabel,
    seatNumber: seat.seatNumber,
    zone: seat.zone,
    price: toMoney(seat.price),
    isWheelchair: seat.isWheelchair,
  });
}

function toPlannedSeat(seat: PlannedSeat): PlannedSeatResponse {
  return Object.assign(new PlannedSeatResponse(), { ...toSeat(seat), kept: seat.kept });
}

function toDifference(difference: EditDifference): EditDifferenceResponse {
  return Object.assign(new EditDifferenceResponse(), {
    direction: difference.direction,
    amount: toMoney(difference.amount),
  });
}

function toMoney(value: Money): MoneyResponse {
  return Object.assign(new MoneyResponse(), { amount: value.amount, currency: value.currency });
}
