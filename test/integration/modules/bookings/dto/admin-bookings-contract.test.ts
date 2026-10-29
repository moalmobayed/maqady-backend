import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { listHttpRoutes } from '../../../../support/routes';
import { createTestApp } from '../../../../support/test-app';
import type { TestApp } from '../../../../support/types';

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; required?: boolean }[];
  security?: Record<string, unknown>[];
  responses: Record<
    string,
    { content?: Record<string, { schema?: unknown; examples?: Record<string, unknown> }> }
  >;
}

interface Schema {
  required?: string[];
  allOf?: unknown[];
  properties?: Record<string, { enum?: unknown[]; nullable?: boolean; description?: string }>;
}

/** method, path, tag, success status, strict, access */
const ROUTES = [
  ['GET', '/admin/bookings', 'Admin: bookings', '200', false, 'staff'],
  ['GET', '/admin/bookings/summary', 'Admin: bookings', '200', false, 'staff'],
  ['GET', '/admin/bookings/{ref}', 'Admin: bookings', '200', false, 'staff'],
  ['GET', '/admin/bookings/{ref}/notes', 'Admin: bookings', '200', false, 'staff'],
  ['POST', '/admin/bookings/{ref}/notes', 'Admin: bookings', '201', true, 'staff'],
  ['POST', '/admin/bookings/{ref}/ticket-deliveries', 'Admin: bookings', '201', true, 'staff'],
  ['POST', '/admin/bookings/{ref}/refunds', 'Admin: bookings', '201', true, 'admin'],
  ['POST', '/admin/bookings/{ref}/edit-previews', 'Admin: bookings', '200', false, 'admin'],
  ['POST', '/admin/bookings/{ref}/edits', 'Admin: bookings', '201', true, 'admin'],
  ['POST', '/admin/refunds/{id}/payouts', 'Admin: bookings', '201', true, 'admin'],
  ['GET', '/admin/showtimes/{id}/cancellation-preview', 'Admin: showtimes', '200', false, 'admin'],
] as const;

/** U14's routes and schemas as the admin Bookings page reads them from the generated contract. */
describe('Admin bookings in the OpenAPI document and the router', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;

  const operation = (path: string, method: string): Operation =>
    (document.paths[path] as Record<string, Operation>)[method.toLowerCase()]!;
  const examples = (path: string, method: string, status: string): string[] =>
    Object.keys(
      operation(path, method).responses[status]?.content?.['application/json']?.examples ?? {},
    ).sort();
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

  it('serves the routes with the access the design gives them', () => {
    const served = new Map(
      listHttpRoutes(testApp).map((route) => [`${route.method} ${route.path}`, route.access]),
    );
    for (const [method, path, , , , access] of ROUTES) {
      const key = `${method} /api/v1${path.replace(/\{(\w+)\}/g, ':$1')}`;
      expect({ key, access: served.get(key) }).toEqual({ key, access });
    }
  });

  it('documents every operation with its tag, prose, success, errors, security and strictness', () => {
    expect(document.tags?.map((tag) => tag.name)).toContain('Admin: bookings');
    for (const [method, path, tag, success, strict, access] of ROUTES) {
      const value = operation(path, method);
      expect({ path, tags: value.tags }).toEqual({ path, tags: [tag] });
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(250);
      expect(value.security).toEqual([{ staff: [] }]);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining([success, '401', '403', '429', '500']),
      );
      if (access === 'admin') {
        expect({ path, forbidden: examples(path, method, '403') }).toEqual({
          path,
          forbidden: expect.arrayContaining(['FORBIDDEN']),
        });
      }
      const key = value.parameters?.find((parameter) => parameter.name === 'Idempotency-Key');
      if (strict) expect({ path, key }).toMatchObject({ path, key: { required: true } });
      else expect({ path, required: key?.required ?? false }).toEqual({ path, required: false });
    }
    expect(examples('/admin/bookings/{ref}/refunds', 'POST', '409')).toEqual([
      'BOOKING_NOT_REFUNDABLE',
    ]);
    expect(examples('/admin/bookings/{ref}/edits', 'POST', '409')).toEqual([
      'BOOKING_NOT_EDITABLE',
      'CONFLICT',
      'SEAT_TAKEN',
      'SHOWTIME_NOT_BOOKABLE',
    ]);
    expect(examples('/admin/refunds/{id}/payouts', 'POST', '409')).toEqual(['REFUND_NOT_PENDING']);
    expect(examples('/admin/bookings/{ref}/ticket-deliveries', 'POST', '409')).toEqual([
      'NO_CONTACT_DETAILS',
      'TICKET_NOT_AVAILABLE',
    ]);
  });

  it('publishes the request and response schemas with their enums and nullable fields', () => {
    expect(schema('EditBooking').required).toEqual(['reason']);
    expect(enumOf('EditReason')).toEqual([
      'customer_request',
      'seat_problem',
      'showtime_changed',
      'staff_error',
    ]);
    expect(enumOf('EditDirection')).toEqual(['collect', 'refund', 'none']);
    expect(schema('CreateBookingNote').required).toEqual(['body']);
    expect(schema('AdminPayment').properties!.paidOutAt).toMatchObject({ nullable: true });
    expect(schema('AdminPayment').properties!.refundable).toMatchObject({ nullable: true });
    expect(enumOf('PaymentKind')).toEqual(['charge', 'refund']);
    expect(schema('AdminBookingSummary').required).toEqual(
      expect.arrayContaining([
        'todayBookings',
        'collectedToday',
        'failedPaymentsToday',
        'refundedLast7Days',
      ]),
    );
    expect(schema('AdminBookingListItemResponsePage').properties).toHaveProperty('nextCursor');
    expect(schema('BookingNoteResponsePage').properties).toHaveProperty('total');
    // The admin booking is every Booking field plus the admin ones.
    const admin = schema('AdminBooking');
    expect(Object.keys(admin.properties ?? {})).toEqual(
      expect.arrayContaining([
        'reference',
        'seatLines',
        'contact',
        'payments',
        'activity',
        'actions',
      ]),
    );
    for (const name of [
      'AdminBooking',
      'AdminBookingListItem',
      'AdminPayment',
      'BookingEditPreview',
      'BookingEditResult',
      'ShowtimeCancellationPreview',
      'StaffTicketDelivery',
      'BookingRefundResult',
    ]) {
      for (const [property, value] of Object.entries(schema(name).properties ?? {})) {
        expect({ name, property, described: Boolean(value.description) }).toEqual({
          name,
          property,
          described: true,
        });
      }
    }
  });
});
