import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { MediaModule } from '../media/media.module';
import { AdminSearchController } from './admin-search.controller';
import { SearchResponseMapper } from './search-response.mapper';
import { SearchController } from './search.controller';
import { SearchRepository } from './search.repository';
import { SearchService } from './search.service';

/**
 * Search (U18, `docs/gh-19-search/spec.md`; design §13.2; PRD "Search"): the customer site's
 * `GET /search` and the dashboard's `GET /admin/search`, filtered by role.
 *
 * Read-only and owns no table (design §5, like `analytics`): its repository reads the catalog,
 * theater, customer and booking tables in ranked trigram queries; booking rows come from bookings'
 * `AdminBookingsService.itemsByIds()` after `SettlementService.settleAllDue()`, images from
 * `MediaService`. Exported: `SearchService`.
 */
@Module({
  imports: [BookingsModule, MediaModule],
  controllers: [SearchController, AdminSearchController],
  providers: [SearchRepository, SearchService, SearchResponseMapper],
  exports: [SearchService],
})
export class SearchModule {}
