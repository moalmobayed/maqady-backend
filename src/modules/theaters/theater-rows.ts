import { money } from '../../common/money/money';
import type { StoredImage } from '../media/types';
import { FACILITIES } from './enums';
import type {
  DayHours,
  Facility,
  SpecialDate,
  SpecialDateRow,
  TheaterDetails,
  TheaterFacilityRow,
  TheaterHoursRow,
  TheaterPhone,
  TheaterPhoneRow,
  TheaterPhoto,
  TheaterPhotoRow,
  TheaterRow,
  TheaterSummary,
  ZonePrices,
} from './types';

/** Rows of the theater tables as the domain types other modules and the responses read. */

export function zonePricesOf(row: TheaterRow): ZonePrices | null {
  const { default_price_front, default_price_middle, default_price_back, currency } = row;
  if (
    currency === null ||
    default_price_front === null ||
    default_price_middle === null ||
    default_price_back === null
  ) {
    return null;
  }
  return {
    front: money(default_price_front, currency),
    middle: money(default_price_middle, currency),
    back: money(default_price_back, currency),
  };
}

export function toTheaterSummary(row: TheaterRow): TheaterSummary {
  return { id: row.id, name: row.name, status: row.status, defaultPrices: zonePricesOf(row) };
}

/** What `toTheaterDetails()` needs besides the theater row, for many theaters at once. */
export class TheaterChildren {
  private readonly phones = new Map<number, TheaterPhone[]>();
  private readonly facilities = new Map<number, Set<Facility>>();
  private readonly photos = new Map<number, TheaterPhotoRow[]>();

  constructor(
    phoneRows: readonly TheaterPhoneRow[],
    facilityRows: readonly TheaterFacilityRow[],
    photoRows: readonly TheaterPhotoRow[],
    private readonly images: ReadonlyMap<number, StoredImage>,
  ) {
    for (const row of phoneRows) {
      push(this.phones, row.theater_id, { label: row.label, number: row.number });
    }
    for (const row of facilityRows) {
      const set = this.facilities.get(row.theater_id) ?? new Set<Facility>();
      set.add(row.facility);
      this.facilities.set(row.theater_id, set);
    }
    for (const row of photoRows) push(this.photos, row.theater_id, row);
  }

  details(row: TheaterRow): TheaterDetails {
    const facilities = this.facilities.get(row.id) ?? new Set<Facility>();
    const photos: TheaterPhoto[] = [];
    for (const photo of this.photos.get(row.id) ?? []) {
      const image = this.images.get(photo.image_id);
      if (image) {
        photos.push({ id: photo.id, caption: photo.caption, position: photo.sort_order, image });
      }
    }
    return {
      ...toTheaterSummary(row),
      address: row.address,
      district: row.district,
      city: row.city,
      latitude: row.latitude,
      longitude: row.longitude,
      transitInfo: row.transit_info,
      parkingInfo: row.parking_info,
      email: row.email,
      showContactsPublic: row.show_contacts_public,
      phones: this.phones.get(row.id) ?? [],
      facilities: FACILITIES.filter((facility) => facilities.has(facility)),
      cover: row.cover_image_id === null ? null : (this.images.get(row.cover_image_id) ?? null),
      photos,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function toDayHours(row: TheaterHoursRow): DayHours {
  return {
    weekday: row.weekday,
    closed: row.is_closed,
    opensMinute: row.opens_minute,
    closesMinute: row.closes_minute,
  };
}

export function toSpecialDate(row: SpecialDateRow): SpecialDate {
  return {
    id: row.id,
    theaterId: row.theater_id,
    cinemaDate: row.cinema_date,
    label: row.label,
    closed: row.is_closed,
    opensMinute: row.opens_minute,
    closesMinute: row.closes_minute,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Groups rows by theater id, keeping their order. */
export function groupByTheater<Row extends { readonly theater_id: number }, Item>(
  rows: readonly Row[],
  toItem: (row: Row) => Item,
): Map<number, Item[]> {
  const grouped = new Map<number, Item[]>();
  for (const row of rows) push(grouped, row.theater_id, toItem(row));
  return grouped;
}

function push<Item>(map: Map<number, Item[]>, key: number, item: Item): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}
