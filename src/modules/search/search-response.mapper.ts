import { Injectable } from '@nestjs/common';
import { formatCairoIso } from '../../common/time/time';
import { AdminBookingResponseMapper } from '../bookings/admin-booking-response.mapper';
import type { ImageResponse } from '../media/dto/image.response';
import { MediaService } from '../media/media.service';
import type { StoredImage } from '../media/types';
import {
  AdminSearchBookingGroupResponse,
  AdminSearchCustomerGroupResponse,
  AdminSearchCustomerResponse,
  AdminSearchResultsResponse,
} from './dto/admin-search.response';
import {
  SearchMatchedPersonResponse,
  SearchMovieGroupResponse,
  SearchMovieResponse,
  SearchPersonGroupResponse,
  SearchPersonResponse,
  SearchResultsResponse,
  SearchTheaterGroupResponse,
  SearchTheaterResponse,
} from './dto/search.response';
import type {
  CustomerHit,
  MovieHit,
  PersonHit,
  PublicSearchResult,
  SearchGroup,
  StaffSearchResult,
  TheaterHit,
} from './types';

/**
 * Response DTOs of the two searches: images through `MediaService` (alt texts as discovery
 * gives them), times in Cairo ISO with their offset, booking rows through U14's mapper so they
 * read as the Bookings table does.
 */
@Injectable()
export class SearchResponseMapper {
  constructor(
    private readonly media: MediaService,
    private readonly bookings: AdminBookingResponseMapper,
  ) {}

  publicResults(result: PublicSearchResult): SearchResultsResponse {
    return Object.assign(new SearchResultsResponse(), {
      q: result.q,
      movies: this.movies(result.movies),
      people: this.people(result.people),
      theaters: this.theaters(result.theaters),
    });
  }

  staffResults(result: StaffSearchResult): AdminSearchResultsResponse {
    return Object.assign(new AdminSearchResultsResponse(), {
      q: result.q,
      bookings: Object.assign(new AdminSearchBookingGroupResponse(), {
        items: result.bookings.items.map((item) => this.bookings.listItem(item)),
        hasMore: result.bookings.hasMore,
      }),
      customers: Object.assign(new AdminSearchCustomerGroupResponse(), {
        items: result.customers.items.map((hit) => customer(hit)),
        hasMore: result.customers.hasMore,
      }),
      movies: result.movies === null ? null : this.movies(result.movies),
      people: result.people === null ? null : this.people(result.people),
      theaters: result.theaters === null ? null : this.theaters(result.theaters),
    });
  }

  private movies(group: SearchGroup<MovieHit>): SearchMovieGroupResponse {
    return Object.assign(new SearchMovieGroupResponse(), {
      hasMore: group.hasMore,
      items: group.items.map((hit) =>
        Object.assign(new SearchMovieResponse(), {
          id: hit.id,
          title: hit.title,
          status: hit.status,
          releaseDate: hit.releaseDate,
          runtimeMinutes: hit.runtimeMinutes,
          ageRating: hit.ageRating,
          poster: this.image(hit.poster, `${hit.title} poster`),
          matchedPerson:
            hit.matchedPerson === null
              ? null
              : Object.assign(new SearchMatchedPersonResponse(), hit.matchedPerson),
        }),
      ),
    });
  }

  private people(group: SearchGroup<PersonHit>): SearchPersonGroupResponse {
    return Object.assign(new SearchPersonGroupResponse(), {
      hasMore: group.hasMore,
      items: group.items.map((hit) =>
        Object.assign(new SearchPersonResponse(), {
          id: hit.id,
          fullName: hit.fullName,
          photo: this.image(hit.photo, hit.fullName),
          roles: [...hit.roles],
        }),
      ),
    });
  }

  private theaters(group: SearchGroup<TheaterHit>): SearchTheaterGroupResponse {
    return Object.assign(new SearchTheaterGroupResponse(), {
      hasMore: group.hasMore,
      items: group.items.map((hit) =>
        Object.assign(new SearchTheaterResponse(), {
          id: hit.id,
          name: hit.name,
          status: hit.status,
          district: hit.district,
          city: hit.city,
          cover: this.image(hit.cover, hit.name),
        }),
      ),
    });
  }

  private image(image: StoredImage | null, alt: string): ImageResponse | null {
    return this.media.toImageResponse(image ?? undefined, alt);
  }
}

function customer(hit: CustomerHit): AdminSearchCustomerResponse {
  return Object.assign(new AdminSearchCustomerResponse(), {
    id: hit.id,
    fullName: hit.fullName,
    email: hit.email,
    phone: hit.phone,
    status: hit.status,
    emailVerified: hit.emailVerifiedAt !== null,
    joinedAt: formatCairoIso(hit.joinedAt),
  });
}
