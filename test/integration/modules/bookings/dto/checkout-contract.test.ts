import type { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiDocument } from '../../../../../src/common/swagger/openapi-document';
import { SIMULATED_PAYMENT_TOKENS } from '../../../../../src/modules/payments/enums';
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
  properties?: Record<string, { enum?: unknown[]; nullable?: boolean; type?: string }>;
}

const ROUTES = [
  ['POST', '/bookings/{ref}/payments', 'Checkout'],
  ['GET', '/bookings/{ref}/ticket.pdf', 'Tickets'],
  ['GET', '/bookings/{ref}/calendar.ics', 'Tickets'],
] as const;

/** U11's routes and schemas as the frontend reads them from the generated contract. */
describe('Checkout and tickets in the OpenAPI document and the router', () => {
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
    const routes = listHttpRoutes(testApp).filter((route) =>
      /\/(payments|ticket\.pdf|calendar\.ics)$/.test(route.path),
    );
    expect(routes.map((route) => [route.method, route.path, route.access]).sort()).toEqual(
      [
        ['GET', '/api/v1/bookings/:ref/calendar.ics', 'customer'],
        ['GET', '/api/v1/bookings/:ref/ticket.pdf', 'customer'],
        ['POST', '/api/v1/bookings/:ref/payments', 'customer'],
      ].sort(),
    );
  });

  it('documents every operation with its tag, prose, errors and customer security', () => {
    for (const [method, path, tag] of ROUTES) {
      const value = operation(path, method);
      expect(value.tags).toEqual([tag]);
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(200);
      expect(value.security).toEqual([{ customer: [] }]);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining(['400', '401', '404', '409', '429', '500']),
      );
    }
    const payment = operation('/bookings/{ref}/payments', 'POST');
    expect(
      payment.parameters?.find((parameter) => parameter.name === 'Idempotency-Key'),
    ).toMatchObject({ in: 'header', required: true });
    expect(examples('/bookings/{ref}/payments', 'POST', '409').sort()).toEqual(
      ['ALREADY_PAID', 'HOLD_EXPIRED', 'PAYMENT_IN_PROGRESS', 'SHOWTIME_NOT_BOOKABLE'].sort(),
    );
    expect(examples('/bookings/{ref}/payments', 'POST', '403')).toEqual(['ACCOUNT_BLOCKED']);
    expect(Object.keys(payment.responses['201']!.content!)).toEqual(['application/json']);
    for (const path of ['/bookings/{ref}/ticket.pdf', '/bookings/{ref}/calendar.ics']) {
      expect(examples(path, 'GET', '409')).toEqual(['TICKET_NOT_AVAILABLE']);
    }
    expect(
      operation('/bookings/{ref}/ticket.pdf', 'GET').responses['200']!.content!['application/pdf']!
        .schema,
    ).toEqual({ type: 'string', format: 'binary' });
    expect(
      Object.keys(operation('/bookings/{ref}/calendar.ics', 'GET').responses['200']!.content!),
    ).toEqual(['text/calendar']);
  });

  it('publishes the payment, result, ticket and booking schemas the checkout and confirmation pages read', () => {
    const request = schema('CreatePaymentRequest');
    expect(request.required).toEqual(['method', 'token']);
    expect(enumOf('SimulatedPaymentToken')).toEqual([...SIMULATED_PAYMENT_TOKENS]);
    expect(enumOf('OnlinePaymentMethod')).toEqual(['card', 'wallet']);

    const payment = schema('Payment');
    expect(Object.keys(payment.properties!)).toEqual([
      'status',
      'method',
      'amount',
      'card',
      'walletType',
      'createdAt',
      'completedAt',
      'settlesAt',
    ]);
    expect(enumOf('PaymentResultStatus')).toEqual([
      'processing',
      'succeeded',
      'declined',
      'cancelled',
    ]);
    expect(schema('PaymentCard').required).toEqual(['brand', 'last4']);
    expect(schema('PaymentResult').required).toEqual(['payment', 'booking']);
    expect(schema('Ticket').required).toEqual(['qrCode', 'admits']);

    const booking = schema('Booking');
    expect(booking.required).toEqual(
      expect.arrayContaining(['confirmedAt', 'paymentStatus', 'payment', 'ticket']),
    );
    expect(enumOf('BookingPaymentStatus')).toEqual([
      'unpaid',
      'processing',
      'declined',
      'paid',
      'refunded',
    ]);
    expect(JSON.stringify(document.components!.schemas!)).not.toMatch(
      /providerReference|cardNumber/,
    );
  });
});
