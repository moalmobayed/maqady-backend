import { AppError } from '../../common/errors/app-error';
import { REDACTED_LINK } from './messaging.constants';
import type { LinkBuilder } from './types';

/**
 * The two link builders a template renders with (design §13.1). The delivery builder writes
 * real links and is used only for the copy handed to a sender; the storage builder writes
 * `REDACTED_LINK` for one-time links and is used for every stored copy.
 */

function pageUrl(baseUrl: string, path: string, query?: Readonly<Record<string, string>>): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new AppError('INTERNAL', 'A message link path must start with a single "/".');
  }
  const search = new URLSearchParams(query ?? {}).toString();
  return `${baseUrl}${path}${search === '' ? '' : `?${search}`}`;
}

/** Real links, for the copy that is sent. */
export function deliveryLinks(baseUrl: string): LinkBuilder {
  return {
    page: (path, query) => pageUrl(baseUrl, path, query),
    oneTime: (path, token) => {
      if (token === '') throw new AppError('INTERNAL', 'A one-time link needs a token.');
      return pageUrl(baseUrl, path, { token });
    },
  };
}

/** Links for stored copies: ordinary pages stay, one-time links are redacted. */
export function storageLinks(baseUrl: string): LinkBuilder {
  return {
    page: (path, query) => pageUrl(baseUrl, path, query),
    oneTime: (path) => {
      // Validates the path the same way, so a bad template fails at queue time, not at send time.
      pageUrl(baseUrl, path);
      return REDACTED_LINK;
    },
  };
}
