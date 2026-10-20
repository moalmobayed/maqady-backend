import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { StorageConfig } from '../../../common/config/types';
import { LOCAL_MEDIA_ROUTE, STORAGE_CACHE_MAX_AGE_SECONDS } from '../media.constants';

/**
 * Serves the local driver's directory read-only at `/media` (outside `/api/v1`), so image URLs
 * work in development exactly as Supabase's public URLs do in production. Does nothing for the
 * Supabase driver.
 *
 * - Only `GET` and `HEAD` are served; no index pages, dotfiles or redirects. Anything else (a
 *   missing file, `PUT`, `DELETE`, a path escaping the directory) falls through to the API's
 *   `404 NOT_FOUND`.
 * - `Cache-Control: public, max-age=31536000, immutable`, as the files are uploaded to Supabase.
 * - `Cross-Origin-Resource-Policy: cross-origin`: Helmet's `same-origin` default would stop the
 *   frontend, on another port, from loading the images.
 */
export function serveLocalMedia(app: NestExpressApplication, storage: StorageConfig): void {
  if (storage.driver !== 'local') return;
  // Express's own static middleware (serve-static), as Nest wires it.
  app.useStaticAssets(storage.directory, {
    prefix: LOCAL_MEDIA_ROUTE,
    index: false,
    dotfiles: 'ignore',
    redirect: false,
    fallthrough: true,
    immutable: true,
    maxAge: STORAGE_CACHE_MAX_AGE_SECONDS * 1000,
    setHeaders: (response: Response) => {
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}
