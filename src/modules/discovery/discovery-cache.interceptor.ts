import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { catchError, type Observable, tap, throwError } from 'rxjs';
import { DISCOVERY_CACHE_CONTROL, DISCOVERY_ERROR_CACHE_CONTROL } from './discovery.constants';

/**
 * The caching of every discovery read: a successful response may be kept by any cache for 60
 * seconds (`Cache-Control: public, max-age=60`), an error never (`no-store`). Nest's `@Header()`
 * sets its header before the handler runs, so a `404`, a `400` or a `503` would carry the public
 * header too and a shared cache would keep serving the error after the movie is published or
 * the database is back. Validation runs inside the handler, so its errors reach `catchError`.
 */
@Injectable()
export class DiscoveryCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => response.setHeader('Cache-Control', DISCOVERY_CACHE_CONTROL)),
      catchError((error: unknown) => {
        response.setHeader('Cache-Control', DISCOVERY_ERROR_CACHE_CONTROL);
        return throwError(() => error);
      }),
    );
  }
}
