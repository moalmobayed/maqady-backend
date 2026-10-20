import { randomUUID } from 'node:crypto';
import type { SeedApi, SeedApiFailure, SeedUpload, SeedWriteMethod } from './types';

/**
 * The admin HTTP API of an in-process app, as `npm run seed` calls it with Node's `fetch`. Every
 * write carries a fresh `Idempotency-Key`, so strict routes accept it. A failed call throws an
 * error naming the method, the route, the status and the error code, never a response value.
 */
export class SeedApiClient implements SeedApi {
  private authorization: string | null = null;

  constructor(private readonly baseUrl: string) {}

  /** Signs in through `POST /admin/auth/sessions`; later calls carry the access token. */
  async signIn(email: string, password: string): Promise<void> {
    const body = await this.request<{ accessToken: string }>(
      'POST',
      '/admin/auth/sessions',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ email, password }),
    );
    this.authorization = `Bearer ${body.accessToken}`;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path, {});
  }

  write<T>(method: SeedWriteMethod, path: string, body: unknown): Promise<T> {
    return this.request<T>(
      method,
      path,
      { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      JSON.stringify(body),
    );
  }

  upload<T>(method: 'POST' | 'PUT', path: string, upload: SeedUpload): Promise<T> {
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append(
      'file',
      new Blob([new Uint8Array(upload.file)], { type: 'image/jpeg' }),
      upload.filename,
    );
    return this.request<T>(method, path, { 'Idempotency-Key': randomUUID() }, form);
  }

  private async request<T>(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string | FormData,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        ...(this.authorization === null ? {} : { Authorization: this.authorization }),
      },
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    if (!response.ok) {
      const failure = failureOf(response.status, text);
      throw new Error(
        `Seed: ${method} ${path.split('?')[0]} answered ${failure.status}${failure.code ? ` ${failure.code}` : ''}`,
      );
    }
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }
}

function failureOf(status: number, text: string): SeedApiFailure {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown } };
    const code = parsed.error?.code;
    return { status, code: typeof code === 'string' ? code : null };
  } catch {
    return { status, code: null };
  }
}
