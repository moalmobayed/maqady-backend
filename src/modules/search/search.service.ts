import { Injectable } from '@nestjs/common';
import type { StaffRole } from '../../common/auth/types';
import { AdminBookingsService } from '../bookings/admin-bookings.service';
import { SettlementService } from '../bookings/settlement.service';
import type { AdminBookingListItem } from '../bookings/types';
import { inRoleOrder } from '../catalog/catalog-assembler.service';
import { MediaService } from '../media/media.service';
import type { StoredImage } from '../media/types';
import { STAFF_GROUPS_BY_ROLE } from './enums';
import { PUBLIC_GROUP_LIMIT, STAFF_GROUP_LIMIT } from './search.constants';
import { SearchRepository } from './search.repository';
import { searchTermsOf } from './search-terms';
import type {
  CatalogAudience,
  CustomerHit,
  LimitedRows,
  MovieHit,
  PersonHit,
  PublicSearchResult,
  SearchGroup,
  SearchTerms,
  StaffSearchResult,
  TheaterHit,
} from './types';

/**
 * The search of the customer site and of the dashboard (design §13.2; PRD "Search"), read-only.
 * Each group is one ranked query of at most `limit + 1` rows (the extra one only says whether
 * there are more), then one image lookup: a fixed number of queries whatever matches. Queries run
 * one after the other, as every read of this codebase does.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly search: SearchRepository,
    private readonly media: MediaService,
    private readonly adminBookings: AdminBookingsService,
    private readonly settlement: SettlementService,
  ) {}

  /**
   * `GET /search`: published movies by title or cast, the people credited on them and active
   * theaters by name or district, up to 5 of each.
   */
  async searchPublic(q: string): Promise<PublicSearchResult> {
    const terms = searchTermsOf(q);
    const movies = await this.movies(terms, 'public', PUBLIC_GROUP_LIMIT);
    const people = await this.people(terms, 'public', PUBLIC_GROUP_LIMIT);
    const theaters = await this.theaters(terms, 'public', PUBLIC_GROUP_LIMIT);
    return { q: terms.text, movies, people, theaters };
  }

  /**
   * `GET /admin/search`: up to 10 bookings and customers for both roles, and for admins up to 10
   * movies, people and theaters in any status. A group the role may not see is never queried and
   * answers null. Due payments are settled first, so booking statuses are fresh (as the Bookings
   * list does).
   */
  async searchStaff(q: string, role: StaffRole): Promise<StaffSearchResult> {
    const terms = searchTermsOf(q);
    const groups = new Set(STAFF_GROUPS_BY_ROLE[role]);
    await this.settlement.settleAllDue();
    const bookings = await this.bookings(terms);
    const customers = await this.customers(terms);
    return {
      q: terms.text,
      bookings,
      customers,
      movies: groups.has('movies') ? await this.movies(terms, 'admin', STAFF_GROUP_LIMIT) : null,
      people: groups.has('people') ? await this.people(terms, 'admin', STAFF_GROUP_LIMIT) : null,
      theaters: groups.has('theaters')
        ? await this.theaters(terms, 'admin', STAFF_GROUP_LIMIT)
        : null,
    };
  }

  private async movies(
    terms: SearchTerms,
    audience: CatalogAudience,
    limit: number,
  ): Promise<SearchGroup<MovieHit>> {
    const { rows, hasMore } = groupOf(await this.search.movies(terms, audience, limit + 1), limit);
    const images = await this.images(rows.map((row) => row.poster_image_id));
    return {
      hasMore,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        releaseDate: row.release_date,
        runtimeMinutes: row.runtime_minutes,
        ageRating: row.age_rating,
        poster: imageOf(images, row.poster_image_id),
        matchedPerson:
          row.matched_person_id === null
            ? null
            : { id: row.matched_person_id, fullName: row.matched_person_name ?? '' },
      })),
    };
  }

  private async people(
    terms: SearchTerms,
    audience: CatalogAudience,
    limit: number,
  ): Promise<SearchGroup<PersonHit>> {
    const { rows, hasMore } = groupOf(await this.search.people(terms, audience, limit + 1), limit);
    const images = await this.images(rows.map((row) => row.photo_image_id));
    return {
      hasMore,
      items: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        photo: imageOf(images, row.photo_image_id),
        roles: inRoleOrder(row.roles),
      })),
    };
  }

  private async theaters(
    terms: SearchTerms,
    audience: CatalogAudience,
    limit: number,
  ): Promise<SearchGroup<TheaterHit>> {
    const { rows, hasMore } = groupOf(
      await this.search.theaters(terms, audience, limit + 1),
      limit,
    );
    const images = await this.images(rows.map((row) => row.cover_image_id));
    return {
      hasMore,
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        district: row.district,
        city: row.city,
        cover: imageOf(images, row.cover_image_id),
      })),
    };
  }

  private async customers(terms: SearchTerms): Promise<SearchGroup<CustomerHit>> {
    const { rows, hasMore } = groupOf(
      await this.search.customers(terms, STAFF_GROUP_LIMIT + 1),
      STAFF_GROUP_LIMIT,
    );
    return {
      hasMore,
      items: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        emailVerifiedAt: row.email_verified_at,
        joinedAt: row.created_at,
      })),
    };
  }

  private async bookings(terms: SearchTerms): Promise<SearchGroup<AdminBookingListItem>> {
    const { rows, hasMore } = groupOf(
      await this.search.bookings(terms, STAFF_GROUP_LIMIT + 1),
      STAFF_GROUP_LIMIT,
    );
    return { hasMore, items: await this.adminBookings.itemsByIds(rows.map((row) => row.id)) };
  }

  /** The images of a group in one lookup (none when no hit has one). */
  private async images(ids: readonly (number | null)[]): Promise<ReadonlyMap<number, StoredImage>> {
    const present = ids.filter((id): id is number => id !== null);
    return present.length === 0 ? new Map() : this.media.findByIds(present);
  }
}

/** The first `limit` rows, and whether the query found more (it asked for `limit + 1`). */
function groupOf<T>(rows: readonly T[], limit: number): LimitedRows<T> {
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

function imageOf(images: ReadonlyMap<number, StoredImage>, id: number | null): StoredImage | null {
  return id === null ? null : (images.get(id) ?? null);
}
