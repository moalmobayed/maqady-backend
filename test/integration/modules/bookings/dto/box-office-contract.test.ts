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
  requestBody?: unknown;
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
  ['POST', '/admin/counter-holds', 'Admin: box office', '201', true],
  ['DELETE', '/admin/counter-holds/{ref}', 'Admin: box office', '204', false],
  ['POST', '/admin/bookings/{ref}/counter-payments', 'Admin: box office', '201', true],
  ['GET', '/admin/bookings/{ref}/ticket.pdf', 'Admin: box office', '200', false],
  ['POST', '/admin/scans', 'Admin: scans', '200', false],
] as const;

/** U13's routes and schemas as the box office screens read them from the generated contract. */
describe('Box office and scanning in the OpenAPI document and the router', () => {
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

  it('serves the 5 routes to both staff roles', () => {
    const routes = listHttpRoutes(testApp).filter((route) =>
      /^\/api\/v1\/admin\/(counter-holds|scans|bookings\/:ref\/(counter-payments|ticket\.pdf))/.test(
        route.path,
      ),
    );
    expect(routes.map((route) => [route.method, route.path, route.access]).sort()).toEqual(
      [
        ['DELETE', '/api/v1/admin/counter-holds/:ref', 'staff'],
        ['GET', '/api/v1/admin/bookings/:ref/ticket.pdf', 'staff'],
        ['POST', '/api/v1/admin/bookings/:ref/counter-payments', 'staff'],
        ['POST', '/api/v1/admin/counter-holds', 'staff'],
        ['POST', '/api/v1/admin/scans', 'staff'],
      ].sort(),
    );
  });

  it('documents every operation with its tag, prose, success, errors, staff security and strictness', () => {
    for (const [method, path, tag, success, strict] of ROUTES) {
      const value = operation(path, method);
      expect({ path, tags: value.tags }).toEqual({ path, tags: [tag] });
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(300);
      expect(value.security).toEqual([{ staff: [] }]);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining([success, '400', '401', '404', '429', '500']),
      );
      const key = value.parameters?.find((parameter) => parameter.name === 'Idempotency-Key');
      if (strict) expect({ path, key }).toMatchObject({ path, key: { required: true } });
      else expect({ path, required: key?.required ?? false }).toEqual({ path, required: false });
    }
    expect(examples('/admin/counter-holds', 'POST', '409')).toEqual([
      'SEAT_TAKEN',
      'SHOWTIME_NOT_BOOKABLE',
    ]);
    expect(examples('/admin/bookings/{ref}/counter-payments', 'POST', '409')).toEqual([
      'ALREADY_PAID',
      'HOLD_EXPIRED',
      'SHOWTIME_NOT_BOOKABLE',
    ]);
    expect(examples('/admin/bookings/{ref}/counter-payments', 'POST', '403')).toEqual(
      expect.arrayContaining(['FORBIDDEN']),
    );
    expect(examples('/admin/bookings/{ref}/ticket.pdf', 'GET', '409')).toEqual([
      'TICKET_NOT_AVAILABLE',
    ]);
    expect(
      operation('/admin/bookings/{ref}/ticket.pdf', 'GET').responses['200']!.content![
        'application/pdf'
      ]!.schema,
    ).toEqual({ type: 'string', format: 'binary' });
    expect(examples('/admin/scans', 'POST', '404')).toEqual(['NOT_FOUND']);
  });

  it('publishes the request and result schemas with their enums', () => {
    expect(schema('CreateCounterHoldRequest').required).toEqual(
      expect.arrayContaining(['seats', 'showtimeId']),
    );
    expect(schema('CreateCounterPayment').required).toEqual(['method', 'customer']);
    expect(enumOf('CounterPaymentMethod')).toEqual(['cash', 'card_terminal']);
    expect(schema('CounterCustomer').required).toEqual(['kind']);
    expect(enumOf('CounterCustomerKind')).toEqual(['walk_in', 'existing', 'contact']);
    expect(schema('Payment').properties!.receiptReference).toMatchObject({ nullable: true });
    expect(enumOf('BookingOwner')).toEqual(['guest', 'customer', 'staff']);

    expect(schema('Scan').required).toEqual(['theaterId']);
    expect(Object.keys(schema('Scan').properties!)).toEqual([
      'theaterId',
      'code',
      'reference',
      'confirm',
    ]);
    expect(schema('ScanResult').required).toEqual([
      'result',
      'reason',
      'admits',
      'checkedInAt',
      'scannedAt',
      'booking',
    ]);
    expect(enumOf('ScanResultCode')).toEqual([
      'VALID',
      'ALREADY_USED',
      'WRONG_SHOWTIME',
      'NOT_VALID',
      'NOT_FOUND',
      'CONFIRM_REQUIRED',
    ]);
    expect(enumOf('ScanReason')).toEqual([
      'other_theater',
      'cancelled',
      'not_open_yet',
      'ended',
      'not_paid',
      'refunded',
      'replaced',
    ]);
    expect(schema('ScannedBooking').required).toEqual([
      'reference',
      'status',
      'seats',
      'seatCount',
      'contactName',
      'showtime',
    ]);
  });
});
