import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import type { CatalogBody, CatalogMovieFixture, StaffSession, TestApp } from './types';

/**
 * Catalog fixtures for integration tests (U6), built through the real admin routes so every
 * rule and audit row applies. U7 and U8 use `createPublishedMovie()` for movies to schedule and
 * list. Genres are seeded by migration and survive `resetDatabase()`.
 *
 * @example
 * const admin = await staffSession(testApp, 'admin');
 * const movie = await createPublishedMovie(testApp, admin, { status: 'now_showing' });
 */

const MOVIES = '/api/v1/admin/movies';

/** The id of a seeded genre by slug (`action`, `drama`, `sci-fi`, …). */
export async function genreId(testApp: TestApp, slug: string): Promise<number> {
  const row = await testApp.knex('genres').select<{ id: number }[]>('id').where({ slug }).first();
  if (!row) throw new Error(`No seeded genre "${slug}"`);
  return row.id;
}

/** A write request with the admin's token and a fresh `Idempotency-Key`. */
export function adminWrite(
  testApp: TestApp,
  admin: StaffSession,
  method: 'post' | 'put' | 'patch' | 'delete',
  path: string,
) {
  return testApp
    .http()
    [method](path)
    .set('Authorization', admin.authorization)
    .set('Idempotency-Key', randomUUID());
}

/** The ids of a list of response items, in order. */
export function idsOf(items: unknown): number[] {
  return (items as { id: number }[]).map((item) => item.id);
}

/** Fails with the response body when the status isn't the expected one. */
export function expectStatus(response: Response, status: number): Response {
  if (response.status !== status) {
    throw new Error(`Expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response;
}

/** A draft movie with only a title (and any other create fields). */
export async function createDraftMovie(
  testApp: TestApp,
  admin: StaffSession,
  body: Record<string, unknown> = {},
): Promise<CatalogBody> {
  const response = await adminWrite(testApp, admin, 'post', MOVIES).send({
    title: `Test movie ${randomUUID().slice(0, 8)}`,
    ...body,
  });
  return expectStatus(response, 201).body as CatalogBody;
}

/**
 * A Coming soon or Now showing movie with a synopsis, runtime, release date and genres, and,
 * when `featuredPosition` is given, a hero video and that carousel position.
 */
export async function createPublishedMovie(
  testApp: TestApp,
  admin: StaffSession,
  fixture: CatalogMovieFixture = {},
): Promise<CatalogBody> {
  const genreIds = await Promise.all(
    (fixture.genres ?? ['drama']).map((slug) => genreId(testApp, slug)),
  );
  const movie = await createDraftMovie(testApp, admin, {
    title: fixture.title ?? `Published movie ${randomUUID().slice(0, 8)}`,
    synopsis: fixture.synopsis ?? 'A test synopsis.',
    runtimeMinutes: fixture.runtimeMinutes ?? 120,
    releaseDate: fixture.releaseDate ?? '2026-10-01',
    ageRating: fixture.ageRating ?? '12+',
    genreIds,
  });
  let heroVideoId: number | undefined;
  if (fixture.featuredPosition !== undefined) {
    const video = await adminWrite(testApp, admin, 'post', `${MOVIES}/${movie.id}/videos`).send({
      url: `https://youtu.be/${fixture.heroYoutubeId ?? 'aBcDeFgHiJk'}`,
      title: 'Official trailer',
      kind: 'trailer',
      durationSeconds: 134,
    });
    heroVideoId = (expectStatus(video, 201).body.videos as { id: number }[])[0]!.id;
  }
  const published = await adminWrite(testApp, admin, 'patch', `${MOVIES}/${movie.id}`).send({
    status: fixture.status ?? 'now_showing',
    ...(heroVideoId === undefined
      ? {}
      : { heroVideoId, featuredPosition: fixture.featuredPosition }),
  });
  return expectStatus(published, 200).body as CatalogBody;
}

/** A person through `POST /admin/people`. */
export async function createPerson(
  testApp: TestApp,
  admin: StaffSession,
  body: Record<string, unknown> = {},
): Promise<CatalogBody> {
  const response = await adminWrite(testApp, admin, 'post', '/api/v1/admin/people').send({
    fullName: `Test person ${randomUUID().slice(0, 8)}`,
    ...body,
  });
  return expectStatus(response, 201).body as CatalogBody;
}
