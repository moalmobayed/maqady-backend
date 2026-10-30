import type { StaffRole } from '../../common/auth/types';
import type { StaffSearchGroup } from './types';

/** The groups of the dashboard search, in display order. */
export const STAFF_SEARCH_GROUPS = [
  'bookings',
  'customers',
  'movies',
  'people',
  'theaters',
] as const;

/**
 * What each staff role may find (PRD "Admin search results … limited to what the role may see";
 * design §11): box office works the Bookings and Customers screens only, and every movies, people
 * and theaters route is admin-only. A group missing here is never queried for the role.
 */
export const STAFF_GROUPS_BY_ROLE: Readonly<Record<StaffRole, readonly StaffSearchGroup[]>> = {
  admin: STAFF_SEARCH_GROUPS,
  box_office: ['bookings', 'customers'],
};

/** Who a catalog search is for: the customer site (published only) or admins (every status). */
export const CATALOG_AUDIENCES = ['public', 'admin'] as const;
