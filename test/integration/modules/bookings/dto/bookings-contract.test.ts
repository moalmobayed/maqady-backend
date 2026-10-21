import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { SeatMapGateway } from '../../../../../src/modules/seating/seat-map.gateway';
import { listHttpRoutes } from '../../../../support/routes';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { pattern?: string };
}

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  security?: Record<string, unknown>[];
  responses: Record<string, { content?: Record<string, { examples?: Record<string, unknown> }> }>;
}

interface Schema {
  required?: string[];
  properties?: Record<string, { enum?: unknown[]; nullable?: boolean; allOf?: unknown[] }>;
  allOf?: unknown[];
}

const ROUTES = [
  ['GET', '/showtimes/{id}', 'public'],
  ['GET', '/showtimes/{id}/seats', 'public'],
  ['POST', '/showtimes/{id}/holds', 'guest'],
  ['POST', '/holds/{ref}/claims', 'customer'],
  ['DELETE', '/holds/{ref}', 'guest'],
  ['GET', '/bookings/{ref}', 'guest'],
] as const;

describe('Seats and holds in the OpenAPI document and the router', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;

  const operation = (path: string, method: string): Operation =>
    (document.paths[path] as Record<string, Operation>)[method.toLowerCase()]!;
  const examples = (path: string, method: string, status: string): string[] =>
    Object.keys(
      operation(path, method).responses[status]?.content?.['application/json']?.examples ?? {},
    );
  const schema = (name: string): Schema => document.components!.schemas![name] as Schema;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    document = buildOpenApiDocument(testApp.app);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('serves the 6 routes with exactly the access the design gives them, and the gateway', () => {
    const routes = listHttpRoutes(testApp).filter((route) =>
      /^\/api\/v1\/(showtimes|holds|bookings)\//.test(route.path),
    );
    expect(routes.map((route) => [route.method, route.path, route.access]).sort()).toEqual(
      ROUTES.map(([method, path, access]) => [
        method,
        `/api/v1${path.replace(/\{(\w+)\}/g, ':$1')}`,
        access,
      ]).sort(),
    );
    expect(testApp.app.get(SeatMapGateway)).toBeInstanceOf(SeatMapGateway);
  });

  it('documents every operation with its tag, prose, errors and the X-Hold-Token header', () => {
    for (const [method, path] of ROUTES) {
      const value = operation(path, method);
      expect(value.tags).toEqual(['Seats and holds']);
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(80);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining(['400', '404', '429', '500']),
      );
    }
    const withToken = ROUTES.filter(([method, path]) =>
      operation(path, method).parameters?.some((parameter) => parameter.name === 'X-Hold-Token'),
    ).map(([method, path]) => `${method} ${path}`);
    expect(withToken.sort()).toEqual(
      [
        'POST /showtimes/{id}/holds',
        'POST /holds/{ref}/claims',
        'DELETE /holds/{ref}',
        'GET /bookings/{ref}',
      ].sort(),
    );
    const claimToken = operation('/holds/{ref}/claims', 'POST').parameters!.find(
      (parameter) => parameter.name === 'X-Hold-Token',
    )!;
    expect(claimToken).toMatchObject({
      in: 'header',
      required: true,
      schema: { pattern: '^[A-Za-z0-9_-]{43}$' },
    });

    for (const path of ['/showtimes/{id}/holds', '/holds/{ref}/claims']) {
      const key = operation(path, 'POST').parameters!.find(
        (parameter) => parameter.name === 'Idempotency-Key',
      );
      expect(key?.required).toBe(true);
    }
    expect(examples('/showtimes/{id}/holds', 'POST', '409')).toEqual(
      expect.arrayContaining(['SHOWTIME_NOT_BOOKABLE', 'SEAT_TAKEN']),
    );
    expect(examples('/showtimes/{id}/holds', 'POST', '403')).toEqual(['ACCOUNT_BLOCKED']);
    expect(examples('/holds/{ref}/claims', 'POST', '409')).toEqual(['HOLD_EXPIRED']);
    expect(examples('/holds/{ref}', 'DELETE', '409')).toEqual(['ALREADY_PAID']);
    expect(operation('/showtimes/{id}', 'GET').security).toEqual([]);
    expect(operation('/holds/{ref}/claims', 'POST').security).toEqual([{ customer: [] }]);
  });

  it('publishes the schemas the frontend builds the seat page and checkout from', () => {
    expect(schema('ShowtimeSeatPage').required ?? []).toEqual(
      expect.arrayContaining([
        'prices',
        'fromPrice',
        'seatCapacity',
        'layout',
        'bookable',
        'notBookableReason',
      ]),
    );
    expect(schema('SeatSnapshot').required).toEqual(
      expect.arrayContaining(['showtimeId', 'serverTime', 'seats', 'availableCount', 'soldOut']),
    );
    expect(schema('TakenSeat').properties?.heldUntil?.nullable).toBe(true);
    expect(schema('Booking').required).toEqual(
      expect.arrayContaining([
        'reference',
        'status',
        'owner',
        'showtime',
        'seats',
        'total',
        'holdExpiresAt',
        'serverTime',
      ]),
    );
    expect(document.components!.schemas!.BookingStatus).toMatchObject({
      enum: ['held', 'failed', 'abandoned', 'confirmed', 'completed', 'refunded'],
    });
    expect(document.components!.schemas!.NotBookableReason).toMatchObject({
      enum: ['cancelled', 'started', 'sales_paused', 'movie_unavailable', 'hall_unavailable'],
    });
    expect(JSON.stringify(schema('Hold'))).toContain('holdCode');
    expect(schema('BookingShowtime').required).toEqual(
      expect.arrayContaining([
        'id',
        'startsAt',
        'endsAt',
        'cinemaDate',
        'movie',
        'theater',
        'hall',
      ]),
    );
  });
});
