import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import type { Page, PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { cinemaDateOf } from '../../common/time/time';
import { MediaService } from '../media/media.service';
import { openStateAt, openStateDates, toHoursSpec } from './opening-hours';
import { TheaterHoursRepository } from './theater-hours.repository';
import { TheaterHoursService } from './theater-hours.service';
import { TheaterLifecycleRegistry } from './theater-lifecycle.registry';
import { TheaterPhotosRepository } from './theater-photos.repository';
import { TheaterReadService } from './theater-read.service';
import { TheaterChildren } from './theater-rows';
import { NOT_DRAFT_REASON, STATUS_CHANGE_ACTIONS, STATUS_TRANSITIONS } from './theaters.constants';
import { TheatersRepository } from './theaters.repository';
import type {
  CreateTheaterInput,
  DayHoursInput,
  Facility,
  TheaterAdminView,
  TheaterAuditDetails,
  TheaterChanges,
  TheaterFieldChanges,
  TheaterListEntry,
  TheaterListFilter,
  TheaterPhone,
  TheaterRow,
  ZonePrices,
} from './types';

/**
 * Theaters for the admin dashboard (design §9, §11; PRD A4): the list, the theater page, and
 * every write on a theater and its phones, facilities, weekly hours and prices, publishing and
 * the selling toggle, and deleting a draft.
 *
 * Every write joins the request transaction, locks the theater row first (`FOR NO KEY UPDATE`;
 * `FOR UPDATE` to delete), records an audit event with field names only, and answers the theater
 * as the admin page shows it.
 */
@Injectable()
export class TheatersService {
  constructor(
    private readonly theaters: TheatersRepository,
    private readonly hoursRepository: TheaterHoursRepository,
    private readonly photos: TheaterPhotosRepository,
    private readonly reads: TheaterReadService,
    private readonly hours: TheaterHoursService,
    private readonly lifecycle: TheaterLifecycleRegistry,
    private readonly media: MediaService,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/theaters`: by name then id, with today's hours and the open state now. */
  async list(filter: TheaterListFilter, page: PageRequest): Promise<Page<TheaterListEntry>> {
    const [rows, total] = await Promise.all([
      this.theaters.list(filter, page),
      this.theaters.count(filter),
    ]);
    const pageRows = rows.slice(0, page.limit);
    const ids = pageRows.map((row) => row.id);
    const now = this.clock.now();
    const { from, to } = openStateDates(now);
    const [phones, hours, images] = await Promise.all([
      this.theaters.phonesOf(ids),
      this.hours.hoursFor(ids, from, to),
      this.media.findByIds(pageRows.flatMap((row) => row.cover_image_id ?? [])),
    ]);
    const children = new TheaterChildren(phones, [], [], images);
    return toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.name, id: row.id }),
      (row): TheaterListEntry => {
        const details = children.details(row);
        const days = hours.get(row.id) ?? [];
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          address: row.address,
          district: row.district,
          city: row.city,
          cover: details.cover,
          mainPhone: details.phones[0] ?? null,
          openState: openStateAt(now, days),
          today: days[0]!,
          updatedAt: row.updated_at,
        };
      },
    );
  }

  /** `GET /admin/theaters/{id}` and the answer of every theater write. */
  async view(id: number): Promise<TheaterAdminView> {
    const row = await this.theaters.findById(id);
    if (!row) throw new AppError('NOT_FOUND');
    const now = this.clock.now();
    const { from, to } = openStateDates(now);
    const [[theater], weekly, specials, days, publishBlockers] = await Promise.all([
      this.reads.detailsOf([row]),
      this.hours.weeklyHours([id]),
      this.hours.specialDates([id], cinemaDateOf(now), null),
      this.hours.hoursFor([id], from, to),
      row.status === 'draft' ? this.unmetPublishRequirements(row) : Promise.resolve([]),
    ]);
    return {
      theater: theater!,
      hours: weekly.get(id) ?? [],
      specialDates: specials.get(id) ?? [],
      openState: openStateAt(now, days.get(id) ?? []),
      publishBlockers,
    };
  }

  /** `POST /admin/theaters`: a new draft. A taken name is `CONFLICT` (`uq_theaters_name`). */
  async create(actor: StaffPrincipal, input: CreateTheaterInput): Promise<TheaterAdminView> {
    const id = await this.transactions.run(async () => {
      const now = this.clock.now();
      const row = await this.theaters.insert({
        name: input.name,
        status: 'draft',
        address: input.address,
        district: input.district,
        city: input.city,
        latitude: input.latitude,
        longitude: input.longitude,
        transit_info: input.transitInfo ?? null,
        parking_info: input.parkingInfo ?? null,
        email: input.email ?? null,
        show_contacts_public: input.showContactsPublic ?? false,
        created_at: now,
        updated_at: now,
      });
      await this.record(actor, 'theater.created', row.id);
      return row.id;
    });
    return this.view(id);
  }

  /**
   * `PATCH /admin/theaters/{id}`: the fields first, then the status.
   *
   * - `draft → active` publishes, once every requirement is met (`THEATER_NOT_PUBLISHABLE` with
   *   `details.missing`); `active ↔ sales_paused` is the selling toggle; anything else is
   *   `CONFLICT` with `details.from` and `details.to`.
   * - A request that changes nothing writes nothing.
   */
  async update(
    actor: StaffPrincipal,
    id: number,
    changes: TheaterChanges,
  ): Promise<TheaterAdminView> {
    await this.transactions.run(async () => {
      const row = await this.lockForWrite(id);
      const { update, changedFields } = fieldChanges(row, changes);
      const to = changes.status ?? row.status;
      const statusChanges = to !== row.status;
      if (changedFields.length === 0 && !statusChanges) return;

      if (statusChanges) {
        if (!STATUS_TRANSITIONS[row.status].includes(to)) {
          throw new AppError(
            'CONFLICT',
            'A theater can be published from draft, and then paused or resumed; nothing else.',
            { from: row.status, to },
          );
        }
        if (to === 'active' && row.status === 'draft') {
          const missing = await this.unmetPublishRequirements(row);
          if (missing.length > 0) {
            throw new AppError('THEATER_NOT_PUBLISHABLE', undefined, { missing });
          }
        }
      }
      await this.theaters.update(id, {
        ...update,
        ...(statusChanges ? { status: to } : {}),
        updated_at: this.clock.now(),
      });
      if (changedFields.length > 0) {
        await this.record(actor, 'theater.updated', id, { changedFields });
      }
      if (statusChanges) {
        await this.record(actor, STATUS_CHANGE_ACTIONS[`${row.status}>${to}`]!, id, {
          metadata: { from: row.status, to },
        });
      }
    });
    return this.view(id);
  }

  /**
   * `DELETE /admin/theaters/{id}`: only a draft that no registered blocker keeps
   * (`THEATER_NOT_DELETABLE` with `details.reasons`). Its children go with it, and its images'
   * rows now and their files after commit.
   */
  async delete(actor: StaffPrincipal, id: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.theaters.findByIdForDelete(id);
      if (!row) throw new AppError('NOT_FOUND');
      const reasons = row.status === 'draft' ? [] : [NOT_DRAFT_REASON];
      for (const blocker of this.lifecycle.deletionBlockers()) {
        if (await blocker.blocks(id)) reasons.push(blocker.key);
      }
      if (reasons.length > 0) throw new AppError('THEATER_NOT_DELETABLE', undefined, { reasons });

      const photos = await this.photos.photosOf([id]);
      const imageIds = [
        ...(row.cover_image_id === null ? [] : [row.cover_image_id]),
        ...photos.map((photo) => photo.image_id),
      ];
      await this.theaters.deleteById(id);
      await this.media.deleteMany(imageIds);
      await this.record(actor, 'theater.deleted', id, {
        metadata: { photoCount: photos.length, hadCover: row.cover_image_id !== null },
      });
    });
  }

  /** `PUT /admin/theaters/{id}/hours`: all seven weekdays, each open or closed. */
  async replaceHours(
    actor: StaffPrincipal,
    id: number,
    days: readonly DayHoursInput[],
  ): Promise<TheaterAdminView> {
    await this.transactions.run(async () => {
      await this.lockForWrite(id);
      const rows = days.map((day) => {
        const hours = toHoursSpec(day);
        return {
          theater_id: id,
          weekday: day.weekday,
          is_closed: hours.closed,
          opens_minute: hours.opensMinute,
          closes_minute: hours.closesMinute,
        };
      });
      await this.hoursRepository.upsertWeekly(rows);
      await this.touch(id);
      await this.record(actor, 'theater.hours_replaced', id, {
        metadata: { openDays: rows.filter((row) => !row.is_closed).length },
      });
    });
    return this.view(id);
  }

  /** `PUT /admin/theaters/{id}/phones`: the whole list, in order; the first is the main phone. */
  async replacePhones(
    actor: StaffPrincipal,
    id: number,
    phones: readonly TheaterPhone[],
  ): Promise<TheaterAdminView> {
    await this.transactions.run(async () => {
      await this.lockForWrite(id);
      const now = this.clock.now();
      await this.theaters.replacePhones(
        id,
        phones.map((phone, index) => ({
          theater_id: id,
          label: phone.label,
          number: phone.number,
          sort_order: index,
          created_at: now,
        })),
      );
      await this.touch(id);
      await this.record(actor, 'theater.phones_replaced', id, {
        metadata: { count: phones.length },
      });
    });
    return this.view(id);
  }

  /** `PUT /admin/theaters/{id}/facilities`: the whole set. */
  async replaceFacilities(
    actor: StaffPrincipal,
    id: number,
    facilities: readonly Facility[],
  ): Promise<TheaterAdminView> {
    const unique = [...new Set(facilities)];
    await this.transactions.run(async () => {
      await this.lockForWrite(id);
      await this.theaters.replaceFacilities(id, unique);
      await this.touch(id);
      await this.record(actor, 'theater.facilities_replaced', id, {
        metadata: { count: unique.length },
      });
    });
    return this.view(id);
  }

  /**
   * `PUT /admin/theaters/{id}/prices`: the three default zone prices, in one currency. Showtimes
   * copy them when created (U7), so a change applies to new showtimes only.
   */
  async replacePrices(
    actor: StaffPrincipal,
    id: number,
    prices: ZonePrices,
  ): Promise<TheaterAdminView> {
    const { front, middle, back } = prices;
    if (front.currency !== middle.currency || front.currency !== back.currency) {
      throw new AppError('INTERNAL', 'Zone prices must be validated to share one currency.');
    }
    await this.transactions.run(async () => {
      await this.lockForWrite(id);
      await this.theaters.update(id, {
        default_price_front: front.amount,
        default_price_middle: middle.amount,
        default_price_back: back.amount,
        currency: front.currency,
        updated_at: this.clock.now(),
      });
      await this.record(actor, 'theater.prices_replaced', id, {
        metadata: {
          front: front.amount,
          middle: middle.amount,
          back: back.amount,
          currency: front.currency,
        },
      });
    });
    return this.view(id);
  }

  /**
   * Locks the theater for a write and returns it; `NOT_FOUND` when there is none. Every theater
   * write calls this first (theater row before children, design §7.1).
   */
  async lockForWrite(id: number): Promise<TheaterRow> {
    const row = await this.theaters.findByIdForWrite(id);
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  /** Marks the theater as changed now (its children were). */
  async touch(id: number): Promise<void> {
    await this.theaters.update(id, { updated_at: this.clock.now() });
  }

  /**
   * The publish requirements the theater does not meet, built-in first (`prices`: the three
   * zone prices are set; `hours`: all seven weekdays are set and at least one is open), then the
   * registered ones in registration order.
   */
  private async unmetPublishRequirements(row: TheaterRow): Promise<string[]> {
    const missing: string[] = [];
    if (row.currency === null) missing.push('prices');
    const weekly = (await this.hours.weeklyHours([row.id])).get(row.id) ?? [];
    if (weekly.length < 7 || weekly.every((day) => day.closed)) missing.push('hours');
    for (const requirement of this.lifecycle.publishRequirements()) {
      if (!(await requirement.isMet(row.id))) missing.push(requirement.key);
    }
    return missing;
  }

  private async record(
    actor: StaffPrincipal,
    action: string,
    id: number,
    extra: TheaterAuditDetails = {},
  ): Promise<void> {
    await this.audit.record({
      actor: { kind: 'staff', id: actor.id },
      action,
      entity: { type: 'theater', id },
      ...extra,
    });
  }
}

/** The columns a `PATCH` changes, and their API field names; unchanged values are left out. */
function fieldChanges(row: TheaterRow, changes: TheaterChanges): TheaterFieldChanges {
  const update: Record<string, unknown> = {};
  const changedFields: string[] = [];
  const columns = {
    name: 'name',
    address: 'address',
    district: 'district',
    city: 'city',
    latitude: 'latitude',
    longitude: 'longitude',
    transitInfo: 'transit_info',
    parkingInfo: 'parking_info',
    email: 'email',
    showContactsPublic: 'show_contacts_public',
  } as const;
  for (const [field, column] of Object.entries(columns) as [keyof typeof columns, string][]) {
    const value = changes[field];
    if (value === undefined || value === row[column as keyof TheaterRow]) continue;
    update[column] = value;
    changedFields.push(field);
  }
  return { update: update, changedFields };
}
