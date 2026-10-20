import { AppError } from '../../../common/errors/app-error';
import type { SupabaseStorageConfig } from '../../../common/config/types';
import {
  STORAGE_CACHE_CONTROL,
  STORAGE_DELETE_BATCH,
  STORAGE_LIST_PAGE,
  STORAGE_TIMEOUT_MS,
} from '../media.constants';
import type { StorageListEntry, StorageObject, SupabaseListItem } from '../types';
import { StorageAdapter } from './storage.adapter';
import { assertStoragePath, encodeStoragePath } from './storage-path';

/**
 * Supabase Storage through its REST API (design §4, §9), with the service role key, which only
 * the server holds. The bucket is public-read, so the browser loads files from public URLs.
 *
 * Failures: no answer (network error, 15 s timeout), `429` or `5xx` → `STORAGE_UNAVAILABLE`, which
 * a retry may fix; any other refusal (`4xx`) means our key, bucket or request is wrong →
 * `INTERNAL`. Neither the key nor the response body ever reaches an error or a log.
 */
export class SupabaseStorageAdapter extends StorageAdapter {
  private readonly storageUrl: string;

  constructor(private readonly config: SupabaseStorageConfig) {
    super();
    this.storageUrl = `${config.supabaseUrl}/storage/v1`;
  }

  async put(object: StorageObject): Promise<void> {
    assertStoragePath(object.path);
    await this.request('upload', `object/${this.bucket()}/${encodeStoragePath(object.path)}`, {
      method: 'POST',
      headers: {
        'Content-Type': object.contentType,
        'Cache-Control': STORAGE_CACHE_CONTROL,
        'x-upsert': 'false',
      },
      body: object.body,
    });
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) assertStoragePath(path);
    for (let start = 0; start < paths.length; start += STORAGE_DELETE_BATCH) {
      const prefixes = paths.slice(start, start + STORAGE_DELETE_BATCH);
      await this.request('remove', `object/${this.bucket()}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes }),
      });
    }
  }

  async list(prefix: string): Promise<readonly StorageListEntry[]> {
    assertStoragePath(prefix, { allowEmpty: true });
    const entries: StorageListEntry[] = [];
    const folders = [prefix];
    for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
      for (let offset = 0; ; offset += STORAGE_LIST_PAGE) {
        const page = await this.listPage(folder, offset);
        for (const item of page) {
          const path = folder === '' ? item.name : `${folder}/${item.name}`;
          if (item.id === null) folders.push(path);
          else entries.push(listEntryOf(path, item));
        }
        if (page.length < STORAGE_LIST_PAGE) break;
      }
    }
    return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  publicUrl(path: string): string {
    assertStoragePath(path);
    return `${this.storageUrl}/object/public/${this.bucket()}/${encodeStoragePath(path)}`;
  }

  private async listPage(prefix: string, offset: number): Promise<SupabaseListItem[]> {
    const text = await this.request('list', `object/list/${this.bucket()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        limit: STORAGE_LIST_PAGE,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw malformedListing();
    }
    if (!Array.isArray(body)) throw malformedListing();
    return body as SupabaseListItem[];
  }

  private bucket(): string {
    return encodeURIComponent(this.config.bucket);
  }

  /**
   * Sends one request and returns its body as text. A successful body is always read to the end:
   * an unread one keeps its connection out of the pool until garbage collection.
   */
  private async request(operation: string, path: string, init: RequestInit): Promise<string> {
    let status: number;
    try {
      const response = await fetch(`${this.storageUrl}/${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${this.config.serviceRoleKey}`,
          apikey: this.config.serviceRoleKey,
        },
        signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      });
      // The timeout covers the body too, so a body cut off part-way is a missing answer.
      if (response.ok) return await response.text();
      status = response.status;
      // The body may echo the request; only the status is kept.
      await response.body?.cancel();
    } catch (error) {
      // A network failure or the timeout. The error names neither the key nor the URL's query.
      throw new AppError('STORAGE_UNAVAILABLE', undefined, null, {
        cause: new Error(`Supabase Storage ${operation} got no answer (${describeFailure(error)})`),
      });
    }
    const cause = new Error(`Supabase Storage ${operation} answered ${status}`);
    if (status === 429 || status >= 500) {
      throw new AppError('STORAGE_UNAVAILABLE', undefined, null, { cause });
    }
    throw new AppError('INTERNAL', undefined, null, { cause });
  }
}

/** A listing Supabase should never send (not JSON, or not an array): a bug, not an outage. */
function malformedListing(): AppError {
  return new AppError('INTERNAL', undefined, null, {
    cause: new Error('Supabase Storage answered a list with something other than an array'),
  });
}

function listEntryOf(path: string, item: SupabaseListItem): StorageListEntry {
  const stamp = item.updated_at ?? item.created_at;
  const size = item.metadata?.size;
  return {
    path,
    updatedAt: stamp ? new Date(stamp) : new Date(0),
    bytes: typeof size === 'number' ? size : null,
  };
}

/** `TimeoutError`, or `TypeError ECONNREFUSED`: the kind of failure, never a URL or a header. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const { code } = (error.cause ?? {}) as { code?: unknown };
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}
