import type { AdminBookingsService } from '../../../../src/modules/bookings/admin-bookings.service';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import type { AdminBookingListItem } from '../../../../src/modules/bookings/types';
import type { MediaService } from '../../../../src/modules/media/media.service';
import type { StoredImage } from '../../../../src/modules/media/types';
import type { SearchRepository } from '../../../../src/modules/search/search.repository';
import { SearchService } from '../../../../src/modules/search/search.service';
import type {
  CustomerHitRow,
  MovieHitRow,
  PersonHitRow,
  TheaterHitRow,
} from '../../../../src/modules/search/types';

function movieRow(id: number, overrides: Partial<MovieHitRow> = {}): MovieHitRow {
  return {
    id,
    title: `Movie ${id}`,
    status: 'now_showing',
    release_date: '2026-10-01',
    runtime_minutes: 120,
    age_rating: '12+',
    poster_image_id: null,
    matched_person_id: null,
    matched_person_name: null,
    ...overrides,
  };
}

function personRow(id: number, overrides: Partial<PersonHitRow> = {}): PersonHitRow {
  return { id, full_name: `Person ${id}`, photo_image_id: null, roles: [], ...overrides };
}

function theaterRow(id: number, overrides: Partial<TheaterHitRow> = {}): TheaterHitRow {
  return {
    id,
    name: `Theater ${id}`,
    status: 'active',
    district: 'Zamalek',
    city: 'Cairo',
    cover_image_id: null,
    ...overrides,
  };
}

function customerRow(id: number, overrides: Partial<CustomerHitRow> = {}): CustomerHitRow {
  return {
    id,
    full_name: `Customer ${id}`,
    email: `customer${id}@example.com`,
    phone: null,
    status: 'active',
    email_verified_at: null,
    created_at: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

const image = (id: number) => ({ id }) as unknown as StoredImage;
const rows = <T>(count: number, make: (id: number) => T): T[] =>
  Array.from({ length: count }, (_value, index) => make(index + 1));

describe('SearchService', () => {
  let repository: jest.Mocked<SearchRepository>;
  let media: jest.Mocked<MediaService>;
  let adminBookings: jest.Mocked<AdminBookingsService>;
  let settlement: jest.Mocked<SettlementService>;
  let order: string[];
  let service: SearchService;

  beforeEach(() => {
    order = [];
    const logged =
      <T>(name: string, value: T) =>
      (..._args: unknown[]) => {
        order.push(name);
        return Promise.resolve(value);
      };
    repository = {
      movies: jest.fn(logged('movies', [])),
      people: jest.fn(logged('people', [])),
      theaters: jest.fn(logged('theaters', [])),
      customers: jest.fn(logged('customers', [])),
      bookings: jest.fn(logged('bookings', [])),
    } as unknown as jest.Mocked<SearchRepository>;
    media = {
      findByIds: jest.fn((ids: readonly number[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, image(id)]))),
      ),
    } as unknown as jest.Mocked<MediaService>;
    adminBookings = {
      itemsByIds: jest.fn(logged('itemsByIds', [])),
    } as unknown as jest.Mocked<AdminBookingsService>;
    settlement = {
      settleAllDue: jest.fn(logged('settleAllDue', undefined)),
    } as unknown as jest.Mocked<SettlementService>;
    service = new SearchService(repository, media, adminBookings, settlement);
  });

  describe('searchPublic', () => {
    it('searches the public catalog, 5 per group, asking for one more to know if there are more', async () => {
      repository.movies.mockResolvedValueOnce(rows(6, (id) => movieRow(id)));
      repository.people.mockResolvedValueOnce(rows(5, (id) => personRow(id)));
      const result = await service.searchPublic('  nile ');

      expect(result.q).toBe('nile');
      expect(result.movies.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
      expect(result.movies.hasMore).toBe(true);
      expect(result.people.items).toHaveLength(5);
      expect(result.people.hasMore).toBe(false);
      expect(result.theaters).toEqual({ items: [], hasMore: false });
      for (const query of [repository.movies, repository.people, repository.theaters]) {
        expect(query).toHaveBeenCalledWith(expect.objectContaining({ text: 'nile' }), 'public', 6);
      }
      expect(repository.customers).not.toHaveBeenCalled();
      expect(repository.bookings).not.toHaveBeenCalled();
      expect(settlement.settleAllDue).not.toHaveBeenCalled();
    });

    it("resolves each group's images in one lookup, and none for a group without images", async () => {
      repository.movies.mockResolvedValueOnce([
        movieRow(1, { poster_image_id: 11 }),
        movieRow(2),
        movieRow(3, { poster_image_id: 13 }),
      ]);
      repository.theaters.mockResolvedValueOnce([theaterRow(1, { cover_image_id: 21 })]);
      repository.people.mockResolvedValueOnce([personRow(1)]);
      const result = await service.searchPublic('nile');

      expect(media.findByIds).toHaveBeenCalledTimes(2);
      expect(media.findByIds).toHaveBeenCalledWith([11, 13]);
      expect(media.findByIds).toHaveBeenCalledWith([21]);
      expect(result.movies.items.map((item) => item.poster)).toEqual([image(11), null, image(13)]);
      expect(result.theaters.items[0]!.cover).toEqual(image(21));
      expect(result.people.items[0]!.photo).toBeNull();
    });

    it('maps the rows: the matched person, and the roles in the credit role order', async () => {
      repository.movies.mockResolvedValueOnce([
        movieRow(1, { matched_person_id: 4, matched_person_name: 'Ahmed Helmy' }),
        movieRow(2, { status: 'coming_soon', release_date: null, runtime_minutes: null }),
      ]);
      repository.people.mockResolvedValueOnce([
        personRow(4, { full_name: 'Ahmed Helmy', roles: ['writer', 'actor', 'director'] }),
      ]);
      const result = await service.searchPublic('helmy');

      expect(result.movies.items).toEqual([
        {
          id: 1,
          title: 'Movie 1',
          status: 'now_showing',
          releaseDate: '2026-10-01',
          runtimeMinutes: 120,
          ageRating: '12+',
          poster: null,
          matchedPerson: { id: 4, fullName: 'Ahmed Helmy' },
        },
        expect.objectContaining({
          id: 2,
          status: 'coming_soon',
          releaseDate: null,
          runtimeMinutes: null,
          matchedPerson: null,
        }),
      ]);
      expect(result.people.items[0]!.roles).toEqual(['actor', 'director', 'writer']);
    });
  });

  describe('searchStaff', () => {
    it('gives admins every group, 10 each, the catalog in every status', async () => {
      repository.customers.mockResolvedValueOnce(rows(11, (id) => customerRow(id)));
      const result = await service.searchStaff('layla', 'admin');

      expect(result.customers.items).toHaveLength(10);
      expect(result.customers.hasMore).toBe(true);
      expect(result.movies).toEqual({ items: [], hasMore: false });
      expect(result.people).toEqual({ items: [], hasMore: false });
      expect(result.theaters).toEqual({ items: [], hasMore: false });
      for (const query of [repository.movies, repository.people, repository.theaters]) {
        expect(query).toHaveBeenCalledWith(expect.objectContaining({ text: 'layla' }), 'admin', 11);
      }
      expect(repository.customers).toHaveBeenCalledWith(expect.anything(), 11);
      expect(repository.bookings).toHaveBeenCalledWith(expect.anything(), 11);
    });

    it('gives box office bookings and customers only: the catalog is never queried and answers null', async () => {
      const result = await service.searchStaff('layla', 'box_office');

      expect(result).toMatchObject({ movies: null, people: null, theaters: null });
      expect(repository.movies).not.toHaveBeenCalled();
      expect(repository.people).not.toHaveBeenCalled();
      expect(repository.theaters).not.toHaveBeenCalled();
      expect(result.bookings).toEqual({ items: [], hasMore: false });
      expect(result.customers).toEqual({ items: [], hasMore: false });
    });

    it('settles due payments before reading bookings, and keeps the ranked order of the hits', async () => {
      repository.bookings.mockImplementationOnce(() => {
        order.push('bookings');
        return Promise.resolve([{ id: 9 }, { id: 3 }, { id: 5 }]);
      });
      const items = [{ checkedInAt: null }] as unknown as AdminBookingListItem[];
      adminBookings.itemsByIds.mockImplementationOnce((ids) => {
        order.push('itemsByIds');
        expect(ids).toEqual([9, 3, 5]);
        return Promise.resolve(items);
      });
      const result = await service.searchStaff('MQ-7K3P9Q', 'box_office');

      expect(order).toEqual(['settleAllDue', 'bookings', 'itemsByIds', 'customers']);
      expect(repository.bookings).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'MQ-7K3P9Q' }),
        11,
      );
      expect(result.bookings).toEqual({ items, hasMore: false });
    });

    it('reports more bookings when the extra row came back, and drops it', async () => {
      repository.bookings.mockResolvedValueOnce(rows(11, (id) => ({ id })));
      const result = await service.searchStaff('layla', 'admin');
      expect(adminBookings.itemsByIds).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(result.bookings.hasMore).toBe(true);
    });

    it('maps a customer row to the account fields', async () => {
      const joined = new Date('2026-09-02T15:20:00Z');
      const verified = new Date('2026-09-03T08:00:00Z');
      repository.customers.mockResolvedValueOnce([
        customerRow(42, {
          full_name: 'Layla Hassan',
          email: 'layla@example.com',
          phone: '+201012345678',
          status: 'blocked',
          email_verified_at: verified,
          created_at: joined,
        }),
      ]);
      const result = await service.searchStaff('layla', 'box_office');
      expect(result.customers.items).toEqual([
        {
          id: 42,
          fullName: 'Layla Hassan',
          email: 'layla@example.com',
          phone: '+201012345678',
          status: 'blocked',
          emailVerifiedAt: verified,
          joinedAt: joined,
        },
      ]);
    });
  });
});
