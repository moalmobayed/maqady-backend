import { Injectable } from '@nestjs/common';
import { formatCairoIso } from '../../common/time/time';
import { MediaService } from '../media/media.service';
import { DayHoursResponse } from './dto/day-hours.response';
import { OpenStateResponse } from './dto/open-state.response';
import { SpecialDateResponse } from './dto/special-date.response';
import { TheaterListItemResponse } from './dto/theater-list-item.response';
import { TheaterPhoneResponse } from './dto/theater-phone.response';
import { TheaterResponse } from './dto/theater.response';
import { TodayHoursResponse } from './dto/today-hours.response';
import { ZonePricesResponse } from './dto/zone-prices.response';
import { openingMinuteToWallClock } from './opening-hours';
import type {
  CinemaDateHours,
  DayHours,
  HoursSpec,
  OpenState,
  SpecialDate,
  TheaterAdminView,
  TheaterListEntry,
  TheaterPhone,
  WallClockHours,
  ZonePrices,
} from './types';

/** `OpenState` of a response: instants in Cairo time with their offset (U8 reuses it). */
export function toOpenStateResponse(state: OpenState): OpenStateResponse {
  return Object.assign(new OpenStateResponse(), {
    isOpen: state.isOpen,
    closesAt: state.closesAt ? formatCairoIso(state.closesAt) : null,
    nextOpensAt: state.nextOpensAt ? formatCairoIso(state.nextOpensAt) : null,
  });
}

/** A `Phone` of a response (U8 reuses it). */
export function toPhoneResponse(phone: TheaterPhone): TheaterPhoneResponse {
  return Object.assign(new TheaterPhoneResponse(), { label: phone.label, number: phone.number });
}

export function toDayHoursResponse(day: DayHours): DayHoursResponse {
  return Object.assign(new DayHoursResponse(), { weekday: day.weekday, ...wallClockOf(day) });
}

export function toSpecialDateResponse(special: SpecialDate): SpecialDateResponse {
  return Object.assign(new SpecialDateResponse(), {
    id: special.id,
    cinemaDate: special.cinemaDate,
    label: special.label,
    ...wallClockOf(special),
  });
}

export function toTodayHoursResponse(today: CinemaDateHours): TodayHoursResponse {
  return Object.assign(new TodayHoursResponse(), {
    cinemaDate: today.cinemaDate,
    ...wallClockOf(today.hours ?? { closed: true, opensMinute: null, closesMinute: null }),
    specialDateLabel: today.specialDateLabel,
  });
}

function toZonePricesResponse(prices: ZonePrices | null): ZonePricesResponse | null {
  if (!prices) return null;
  return Object.assign(new ZonePricesResponse(), {
    front: { ...prices.front },
    middle: { ...prices.middle },
    back: { ...prices.back },
  });
}

/** Stored hours as the editor shows them: `HH:mm` times and the "next day" tag. */
function wallClockOf(hours: HoursSpec): WallClockHours {
  if (hours.closed || hours.opensMinute === null || hours.closesMinute === null) {
    return { closed: true, opens: null, closes: null, closesNextDay: false };
  }
  const closes = openingMinuteToWallClock(hours.closesMinute);
  return {
    closed: false,
    opens: openingMinuteToWallClock(hours.opensMinute).time,
    closes: closes.time,
    closesNextDay: closes.nextDay,
  };
}

/**
 * The admin theater responses. Images need `MediaService` for their public URLs, so this is a
 * provider; the parts without images are plain functions, exported for U8.
 */
@Injectable()
export class TheaterResponseMapper {
  constructor(private readonly media: MediaService) {}

  toTheaterResponse(view: TheaterAdminView): TheaterResponse {
    const { theater } = view;
    return Object.assign(new TheaterResponse(), {
      id: theater.id,
      name: theater.name,
      status: theater.status,
      address: theater.address,
      district: theater.district,
      city: theater.city,
      latitude: theater.latitude,
      longitude: theater.longitude,
      transitInfo: theater.transitInfo,
      parkingInfo: theater.parkingInfo,
      email: theater.email,
      showContactsPublic: theater.showContactsPublic,
      phones: theater.phones.map(toPhoneResponse),
      facilities: [...theater.facilities],
      hours: view.hours.map(toDayHoursResponse),
      specialDates: view.specialDates.map(toSpecialDateResponse),
      defaultPrices: toZonePricesResponse(theater.defaultPrices),
      cover: this.media.toImageResponse(theater.cover ?? undefined, theater.name),
      photos: theater.photos.map((photo) => ({
        id: photo.id,
        caption: photo.caption,
        position: photo.position,
        image: this.media.toImageResponse(photo.image, photo.caption ?? theater.name)!,
      })),
      openState: toOpenStateResponse(view.openState),
      publishBlockers: [...view.publishBlockers],
      createdAt: formatCairoIso(theater.createdAt),
      updatedAt: formatCairoIso(theater.updatedAt),
    });
  }

  toListItemResponse(entry: TheaterListEntry): TheaterListItemResponse {
    return Object.assign(new TheaterListItemResponse(), {
      id: entry.id,
      name: entry.name,
      status: entry.status,
      address: entry.address,
      district: entry.district,
      city: entry.city,
      cover: this.media.toImageResponse(entry.cover ?? undefined, entry.name),
      mainPhone: entry.mainPhone ? toPhoneResponse(entry.mainPhone) : null,
      openState: toOpenStateResponse(entry.openState),
      today: toTodayHoursResponse(entry.today),
      updatedAt: formatCairoIso(entry.updatedAt),
    });
  }
}
