import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { listHttpRoutes } from '../../../../support/routes';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; required?: boolean; schema?: { enum?: unknown[] } }[];
  security?: Record<string, unknown>[];
  responses: Record<
    string,
    { content?: Record<string, { schema?: unknown; examples?: Record<string, unknown> }> }
  >;
}

interface Schema {
  required?: string[];
  properties?: Record<string, { enum?: unknown[]; nullable?: boolean; type?: string }>;
}

const ROUTES = [
  ['GET', '/me/bookings', '200'],
  ['GET', '/bookings/{ref}/history', '200'],
  ['POST', '/bookings/{ref}/ticket-deliveries', '201'],
] as const;

/** U12's routes and schemas as the frontend reads them from the generated contract. */
describe('My bookings in the OpenAPI document and the router', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;

  const operation = (path: string, method: string): Operation =>
    (document.paths[path] as Record<string, Operation>)[method.toLowerCase()]!;
  const examples = (path: string, method: string, status: string): string[] =>
    Object.keys(
      operation(path, method).responses[status]?.content?.['application/json']?.examples ?? {},
    );
  const schema = (name: string): Schema => document.components!.schemas![name] as Schema;
  const enumOf = (name: string): unknown[] | undefined =>
    (document.components!.schemas![name] as { enum?: unknown[] } | undefined)?.enum;

  beforeAll(async () => {
    testApp = await createTestApp({ resetData: false });
    document = buildOpenApiDocument(testApp.app);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('serves the 3 routes to signed-in customers only', () => {
    // The staff resend (U14) shares the last segment; it is an admin route, not one of these.
    const routes = listHttpRoutes(testApp).filter(
      (route) =>
        !route.path.startsWith('/api/v1/admin/') &&
        /\/(me\/bookings|history|ticket-deliveries)$/.test(route.path),
    );
    expect(routes.map((route) => [route.method, route.path, route.access]).sort()).toEqual(
      [
        ['GET', '/api/v1/bookings/:ref/history', 'customer'],
        ['GET', '/api/v1/me/bookings', 'customer'],
        ['POST', '/api/v1/bookings/:ref/ticket-deliveries', 'customer'],
      ].sort(),
    );
  });

  it('documents every operation with its tag, prose, errors and customer security', () => {
    expect(document.tags?.map((tag) => tag.name)).toContain('My bookings');
    for (const [method, path, success] of ROUTES) {
      const value = operation(path, method);
      expect(value.tags).toEqual(['My bookings']);
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(300);
      expect(value.security).toEqual([{ customer: [] }]);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining([success, '400', '401', '429', '500', '503']),
      );
    }
    for (const path of ['/bookings/{ref}/history', '/bookings/{ref}/ticket-deliveries']) {
      expect(examples(path, path.endsWith('history') ? 'GET' : 'POST', '404')).toEqual([
        'NOT_FOUND',
      ]);
    }
    const delivery = operation('/bookings/{ref}/ticket-deliveries', 'POST');
    expect(
      delivery.parameters?.find((parameter) => parameter.name === 'Idempotency-Key'),
    ).toMatchObject({ in: 'header', required: true });
    expect(examples('/bookings/{ref}/ticket-deliveries', 'POST', '409')).toEqual(
      expect.arrayContaining(['TICKET_NOT_AVAILABLE']),
    );
    const tab = operation('/me/bookings', 'GET').parameters?.find(
      (parameter) => parameter.name === 'tab',
    );
    expect(tab).toMatchObject({ in: 'query', required: false });
  });

  it('publishes the My Bookings, History, delivery and booking schemas', () => {
    expect(enumOf('MyBookingsTab')).toEqual(['upcoming', 'past']);
    expect(Object.keys(schema('MyBooking').properties!)).toEqual([
      'reference',
      'status',
      'paymentStatus',
      'channel',
      'showtime',
      'seatLabels',
      'seatCount',
      'total',
      'payment',
      'confirmedAt',
      'refund',
    ]);
    expect(schema('MyBookingPage').required).toEqual(['items', 'nextCursor', 'total', 'tabCounts']);
    expect(schema('MyBookingTabCounts').required).toEqual(['upcoming', 'past']);
    expect(schema('BookingHistoryEvent').required).toEqual(['kind', 'label', 'occurredAt']);
    expect(enumOf('BookingHistoryKind')).toEqual([
      'seats_held',
      'payment_received',
      'refunded',
      'changed_by_cinema',
      'tickets_resent',
    ]);
    expect(schema('BookingHistoryEventPage').required).toEqual(['items', 'nextCursor', 'total']);
    expect(schema('TicketDelivery').required).toEqual(['channel', 'queuedAt']);
    expect(enumOf('TicketDeliveryChannel')).toEqual(['email']);
    expect(schema('SeatLine').required).toEqual(['zone', 'labels', 'count', 'unitPrice', 'amount']);
    expect(schema('BookingRefund').required).toEqual(['amount', 'refundedAt']);
    expect(schema('BookingTheater').required).toEqual([
      'id',
      'name',
      'address',
      'district',
      'city',
      'latitude',
      'longitude',
    ]);
    expect(JSON.stringify(schema('BookingShowtime').properties!.theater)).toContain(
      'BookingTheater',
    );
    expect(schema('Booking').required).toEqual(expect.arrayContaining(['seatLines', 'refund']));
    expect(schema('Booking').properties!.refund!.nullable).toBe(true);
    // Internal ids and personal data never leave the API in these schemas.
    for (const name of ['MyBooking', 'BookingHistoryEvent', 'TicketDelivery']) {
      expect(Object.keys(schema(name).properties!)).not.toEqual(
        expect.arrayContaining(['id', 'customerId', 'email', 'actor']),
      );
    }
  });
});
