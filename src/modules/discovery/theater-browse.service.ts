import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { Page, PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { addDays, cinemaDateOf } from '../../common/time/time';
import { TheaterHoursService } from '../theaters/theater-hours.service';
import { TheaterReadService } from '../theaters/theater-read.service';
import type { TheaterDetails } from '../theaters/types';
import { PARKING_FACILITIES, SPECIAL_DATES_AHEAD_DAYS } from './discovery.constants';
import { compareByNameThenId, pageInMemory } from './in-memory-page';
import { TheaterHallCountSource } from './theater-hall-count.source';
import type { PublicTheaterView, TheaterCardView, TheaterListFilter } from './types';

/**
 * Theaters as customers browse them (PRD C1, C4, C5), read through U4b's exported services
 * only. Only `active` theaters appear: a draft, a paused or an unknown theater is `NOT_FOUND`.
 * Open states and "today" are judged at the Clock's now by the cinema day. A theater that hides
 * its contacts shows no phone and no email. Every method costs a fixed number of queries,
 * whatever the number of theaters.
 */
@Injectable()
export class TheaterBrowseService {
  constructor(
    private readonly theaters: TheaterReadService,
    private readonly hours: TheaterHoursService,
    private readonly halls: TheaterHallCountSource,
    private readonly clock: Clock,
  ) {}

  /** Every active theater as a card at `now`, alphabetical (the home page's "Our cinemas"). */
  async cardsAt(now: Date): Promise<TheaterCardView[]> {
    const theaters = [...(await this.theaters.listActive())].sort(compareByNameThenId);
    return this.cardsOf(theaters, now);
  }

  /** `GET /theaters`: one page of the cards that pass the filters. */
  async list(filter: TheaterListFilter, page: PageRequest): Promise<Page<TheaterCardView>> {
    const cards = (await this.cardsAt(this.clock.now())).filter(
      (card) =>
        (filter.openNow !== true || card.openState.isOpen) &&
        (filter.parking !== true ||
          card.facilities.some((facility) => PARKING_FACILITIES.includes(facility))),
    );
    return pageInMemory(cards, page);
  }

  /** `GET /theaters/{id}`: an active theater's page; `NOT_FOUND` otherwise. */
  async find(id: number): Promise<PublicTheaterView> {
    const theater = await this.theaters.findActive(id);
    if (!theater) throw new AppError('NOT_FOUND');
    const now = this.clock.now();
    const [card] = await this.cardsOf([theater], now);
    const today = cinemaDateOf(now);
    const specials = await this.hours.specialDates(
      [id],
      today,
      addDays(today, SPECIAL_DATES_AHEAD_DAYS - 1),
    );
    const contacts = theater.showContactsPublic;
    return {
      ...card!,
      transitInfo: theater.transitInfo,
      parkingInfo: theater.parkingInfo,
      email: contacts ? theater.email : null,
      phones: contacts ? theater.phones : [],
      photos: theater.photos,
      specialDates: specials.get(id) ?? [],
    };
  }

  /** Cards of these theaters, in their order: hours, open states and hall counts batched. */
  private async cardsOf(
    theaters: readonly TheaterDetails[],
    now: Date,
  ): Promise<TheaterCardView[]> {
    if (theaters.length === 0) return [];
    const ids = theaters.map((theater) => theater.id);
    const today = cinemaDateOf(now);
    // One after the other: the pool is small and every read is short.
    const openStates = await this.hours.openStates(ids, now);
    const todays = await this.hours.hoursFor(ids, today, today);
    const weekly = await this.hours.weeklyHours(ids);
    const hallCounts = await this.halls.countsOf(ids);
    return theaters.map((theater) => ({
      id: theater.id,
      name: theater.name,
      district: theater.district,
      city: theater.city,
      address: theater.address,
      latitude: theater.latitude,
      longitude: theater.longitude,
      cover: theater.cover,
      openState: openStates.get(theater.id)!,
      mainPhone: theater.showContactsPublic ? (theater.phones[0] ?? null) : null,
      hallCount: hallCounts.get(theater.id) ?? 0,
      facilities: theater.facilities,
      today: todays.get(theater.id)![0]!,
      weeklyHours: weekly.get(theater.id) ?? [],
    }));
  }
}
