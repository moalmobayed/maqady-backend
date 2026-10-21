import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIObject } from '@nestjs/swagger';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';
import { HomeTickerSource } from '../../src/modules/discovery/home-ticker.source';
import type { HomeTickerEntry } from '../../src/modules/discovery/types';
import { adminWrite, expectStatus } from './catalog';
import { jpeg } from './media-fixtures';
import type { StaffSession, TestApp } from './types';

/**
 * Helpers of the discovery suites (U8a): the home-page contract agreed with the frontend, read
 * as data, and tools to compare and validate against it.
 */

export const HOME_PAGE_DRAFT = join(
  __dirname,
  '..',
  '..',
  'contracts',
  'drafts',
  'home-page.openapi.yaml',
);

export function loadHomePageDraft(): OpenAPIObject {
  return load(readFileSync(HOME_PAGE_DRAFT, 'utf8')) as OpenAPIObject;
}

/**
 * The shape of a schema without its prose (`description`, `example`) and the default
 * `nullable: false`, with a lone `allOf: [$ref]` read as the `$ref` it wraps: @nestjs/swagger
 * wraps every reference that carries a description that way (OpenAPI 3.0 ignores siblings of a
 * `$ref`), which is the same shape.
 */
export function schemaStructure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(schemaStructure);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value).filter(
    ([key, child]) =>
      key !== 'description' &&
      key !== 'example' &&
      key !== 'examples' &&
      !(key === 'nullable' && child === false),
  );
  const shape = Object.fromEntries(entries.map(([key, child]) => [key, schemaStructure(child)]));
  const keys = Object.keys(shape);
  const allOf = shape.allOf as unknown[] | undefined;
  if (keys.length === 1 && keys[0] === 'allOf' && Array.isArray(allOf) && allOf.length === 1) {
    return allOf[0];
  }
  return shape;
}

/** Every component schema `root` reaches through `$ref`s, itself included, sorted. */
export function referencedSchemaNames(document: OpenAPIObject, root: string): string[] {
  const schemas = (document.components?.schemas ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') {
        const name = child.split('/').pop()!;
        if (!seen.has(name)) {
          seen.add(name);
          visit(schemas[name]);
        }
      } else {
        visit(child);
      }
    }
  };
  seen.add(root);
  visit(schemas[root]);
  return [...seen].sort();
}

/**
 * An OpenAPI 3.0 schema as JSON Schema for ajv: `nullable: true` becomes "or null" (ajv's own
 * `nullable` needs a `type` beside it, and a nullable `allOf` of a non-null schema would still
 * refuse null), `$ref`s point at `#/definitions/<name>`.
 */
export function toJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (value === null || typeof value !== 'object') return value;
  const { nullable, example: _example, ...rest } = value as Record<string, unknown>;
  const converted = Object.fromEntries(
    Object.entries(rest).map(([key, child]) => [
      key,
      key === '$ref' && typeof child === 'string'
        ? child.replace('#/components/schemas/', '#/definitions/')
        : toJsonSchema(child),
    ]),
  );
  return nullable === true ? { anyOf: [{ type: 'null' }, converted] } : converted;
}

/** A validator of the draft's `name` schema, strict about formats (`date-time`, `date`, `uri`). */
export function draftValidator(name: string): ValidateFunction {
  const draft = loadHomePageDraft();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile({
    definitions: toJsonSchema(draft.components?.schemas) as Record<string, object>,
    $ref: `#/definitions/${name}`,
  });
}

/**
 * Media for catalog and theater fixtures, uploaded through the real admin routes and the real
 * pipeline (local storage driver): a poster, a still set as the backdrop, and a theater cover
 * or gallery photo.
 */
export async function uploadPoster(
  testApp: TestApp,
  admin: StaffSession,
  movieId: number,
): Promise<void> {
  const response = await testApp
    .http()
    .put(`/api/v1/admin/movies/${movieId}/poster`)
    .set('Authorization', admin.authorization)
    .attach('file', await jpeg(800, 1200, '#7a2e2e'), 'poster.jpg');
  expectStatus(response, 200);
}

export async function uploadBackdrop(
  testApp: TestApp,
  admin: StaffSession,
  movieId: number,
): Promise<void> {
  const upload = await adminWrite(testApp, admin, 'post', `/api/v1/admin/movies/${movieId}/photos`)
    .field('kind', 'still')
    .field('caption', 'A still')
    .attach('file', await jpeg(1600, 900, '#1f4e79'), 'still.jpg');
  const photos = expectStatus(upload, 201).body.photos as { id: number }[];
  const patch = await adminWrite(testApp, admin, 'patch', `/api/v1/admin/movies/${movieId}`).send({
    backdropPhotoId: photos[photos.length - 1]!.id,
  });
  expectStatus(patch, 200);
}

export async function uploadTheaterPhoto(
  testApp: TestApp,
  admin: StaffSession,
  theaterId: number,
  usage: 'cover' | 'gallery',
  caption?: string,
): Promise<void> {
  const request = adminWrite(
    testApp,
    admin,
    'post',
    `/api/v1/admin/theaters/${theaterId}/photos`,
  ).field('usage', usage);
  if (caption !== undefined) request.field('caption', caption);
  const file = usage === 'cover' ? await jpeg(1920, 1080) : await jpeg(800, 600);
  expectStatus(await request.attach('file', file, `${usage}.jpg`), 201);
}

/**
 * A home ticker source for the suites (U8b's seam, like `theaters-probe.module.ts` stands in for
 * the hall rules): it answers the entries it was given, so the `TickerItem` mapping and schema
 * are exercised before showtimes exist.
 */
export class FixedTickerSource extends HomeTickerSource {
  constructor(private readonly entries: readonly HomeTickerEntry[]) {
    super();
  }

  tickerFor(): Promise<readonly HomeTickerEntry[]> {
    return Promise.resolve(this.entries);
  }
}

/** How many queries `run` sends through the app's Knex (the "no N+1" checks). */
export async function countQueries(testApp: TestApp, run: () => Promise<unknown>): Promise<number> {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  testApp.knex.on('query', listener);
  try {
    await run();
  } finally {
    testApp.knex.removeListener('query', listener);
  }
  return count;
}
