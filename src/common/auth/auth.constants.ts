import type { AccessLevel, TokenAudience } from './types';

/** Metadata key the access decorators append to (on a method or a controller class). */
export const ACCESS_METADATA = 'maqady:access';

/** OpenAPI vendor extension the access decorators set; the document builder reads and removes it. */
export const ACCESS_OPENAPI_EXTENSION = 'x-maqady-access';

/** Access tokens live 15 minutes (design §10.2). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** The only signing algorithm accepted; `none` and asymmetric algorithms are refused. */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';

/** `Authorization: Bearer <token>`. */
export const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/** A positive integer written as text, as `sub` and `sid` carry it. */
export const POSITIVE_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

/** The token audience each access level verifies against; none for public routes. */
export const AUDIENCE_OF_ACCESS: Readonly<Record<AccessLevel, TokenAudience | null>> = {
  public: null,
  guest: 'customer',
  customer: 'customer',
  staff: 'staff',
  admin: 'staff',
};
