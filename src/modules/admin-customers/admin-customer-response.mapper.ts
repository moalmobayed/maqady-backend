import { Injectable } from '@nestjs/common';
import { MoneyResponse } from '../../common/money/dto/money-response.dto';
import type { Page } from '../../common/pagination/types';
import { formatCairoIso } from '../../common/time/time';
import { AdminBookingResponseMapper } from '../bookings/admin-booking-response.mapper';
import type { CustomerBookingStats } from '../bookings/types';
import type { Customer } from '../customers/types';
import {
  AdminCustomerDetailResponse,
  AdminCustomerPageResponse,
  AdminCustomerResponse,
  CustomerStatsResponse,
} from './dto/admin-customer.response';
import {
  AnonymisationRemovalsResponse,
  CustomerAnonymisationResponse,
} from './dto/customer-anonymisation.response';
import { CustomerPasswordResetResponse } from './dto/customer-password-reset.response';
import type {
  AdminCustomerDetail,
  AdminCustomerListItem,
  CustomerAnonymisationResult,
  CustomerPasswordResetResult,
} from './types';

/**
 * Response DTOs of the admin customer routes (U15): times in Cairo ISO with their offset, money
 * as `{ amount, currency }`; recent bookings through U14's mapper, so they read as the Bookings
 * table does.
 */
@Injectable()
export class AdminCustomerResponseMapper {
  constructor(private readonly bookings: AdminBookingResponseMapper) {}

  page(page: Page<AdminCustomerListItem>): InstanceType<typeof AdminCustomerPageResponse> {
    return Object.assign(new AdminCustomerPageResponse(), {
      items: page.items.map((item) => this.item(item)),
      nextCursor: page.nextCursor,
      total: page.total,
    });
  }

  item({ customer, stats }: AdminCustomerListItem): AdminCustomerResponse {
    return Object.assign(new AdminCustomerResponse(), fieldsOf(customer, stats));
  }

  detail({ customer, stats, recentBookings }: AdminCustomerDetail): AdminCustomerDetailResponse {
    return Object.assign(new AdminCustomerDetailResponse(), {
      ...fieldsOf(customer, stats),
      recentBookings: recentBookings.map((item) => this.bookings.listItem(item)),
    });
  }

  anonymisation(result: CustomerAnonymisationResult): CustomerAnonymisationResponse {
    return Object.assign(new CustomerAnonymisationResponse(), {
      customerId: result.customerId,
      anonymisedAt: formatCairoIso(result.anonymisedAt),
      bookingsKept: result.bookingsKept,
      removed: Object.assign(new AnonymisationRemovalsResponse(), result.removed),
    });
  }

  passwordReset(result: CustomerPasswordResetResult): CustomerPasswordResetResponse {
    return Object.assign(new CustomerPasswordResetResponse(), {
      channel: result.channel,
      queuedAt: formatCairoIso(result.queuedAt),
    });
  }
}

/** A live customer's fields; the service never hands over an anonymised one. */
function fieldsOf(customer: Customer, stats: CustomerBookingStats): AdminCustomerResponse {
  return {
    id: customer.id,
    fullName: customer.fullName ?? '',
    email: customer.email ?? '',
    phone: customer.phone,
    status: customer.status,
    emailVerified: customer.emailVerifiedAt !== null,
    emailVerifiedAt:
      customer.emailVerifiedAt === null ? null : formatCairoIso(customer.emailVerifiedAt),
    joinedAt: formatCairoIso(customer.createdAt),
    lastSignInAt: customer.lastSignInAt === null ? null : formatCairoIso(customer.lastSignInAt),
    updatedAt: formatCairoIso(customer.updatedAt),
    stats: Object.assign(new CustomerStatsResponse(), {
      bookings: stats.bookings,
      spent: Object.assign(new MoneyResponse(), stats.spent),
      noShows: stats.noShows,
      lastBookingAt: stats.lastBookingAt === null ? null : formatCairoIso(stats.lastBookingAt),
    }),
  };
}
