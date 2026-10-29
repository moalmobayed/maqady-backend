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
  properties?: Record<string, { enum?: unknown[]; nullable?: boolean; description?: string }>;
}

const ROUTES = ['/admin/payments', '/admin/payments/summary'] as const;

/** U16's routes and schemas as the admin Payments page reads them from the generated contract. */
describe('Payments screen in the OpenAPI document and the router', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;

  const operation = (path: string): Operation =>
    (document.paths[path] as Record<string, Operation>).get!;
  const examples = (path: string, status: string): string[] =>
    Object.keys(
      operation(path).responses[status]?.content?.['application/json']?.examples ?? {},
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

  it('serves both routes to admins only', () => {
    const served = new Map(
      listHttpRoutes(testApp).map((route) => [`${route.method} ${route.path}`, route.access]),
    );
    for (const path of ROUTES) {
      expect({ path, access: served.get(`GET /api/v1${path}`) }).toEqual({ path, access: 'admin' });
    }
  });

  it('documents each operation with its tag, prose, success, errors and security', () => {
    expect(document.tags?.map((tag) => tag.name)).toContain('Admin: payments');
    for (const path of ROUTES) {
      const value = operation(path);
      expect({ path, tags: value.tags }).toEqual({ path, tags: ['Admin: payments'] });
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(400);
      expect(value.security).toEqual([{ staff: [] }]);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '429', '500', '503']),
      );
      expect(examples(path, '400')).toEqual(['VALIDATION_FAILED']);
      expect(examples(path, '403')).toEqual(expect.arrayContaining(['FORBIDDEN']));
      expect(value.parameters?.some((parameter) => parameter.name === 'Idempotency-Key')).toBe(
        false,
      );
    }
    const listParameters = operation('/admin/payments').parameters?.map(
      (parameter) => parameter.name,
    );
    expect(listParameters).toEqual(
      expect.arrayContaining([
        'kind',
        'method',
        'channel',
        'status',
        'theaterId',
        'dateFrom',
        'dateTo',
        'cursor',
        'limit',
      ]),
    );
  });

  it('publishes the schemas with their enums and nullable fields, every property described', () => {
    expect(enumOf('TransactionStatus')).toEqual(['succeeded', 'pending', 'failed', 'refunded']);
    expect(enumOf('TransactionFailureReason')).toEqual(['declined', 'cancelled']);
    expect(enumOf('PaymentChannel')).toEqual(['online', 'counter']);
    expect(enumOf('ReconciliationCheck')).toEqual([
      'booking_balance',
      'over_refunded',
      'provider_status',
      'provider_unknown',
      'missing_provider_reference',
    ]);
    expect(schema('AdminTransaction').properties!.failureReason).toMatchObject({ nullable: true });
    expect(schema('AdminTransaction').properties!.refundedAmount).toMatchObject({ nullable: true });
    expect(schema('PaymentKpis').properties!.refundRate).toMatchObject({ nullable: true });
    expect(schema('AdminTransactionResponsePage').properties).toHaveProperty('nextCursor');
    expect(schema('AdminPaymentsSummary').required).toEqual(
      expect.arrayContaining([
        'period',
        'kpis',
        'totals',
        'byChannel',
        'byMethod',
        'reconciliation',
      ]),
    );
    for (const name of [
      'AdminTransaction',
      'TransactionBooking',
      'TransactionActions',
      'AdminPaymentsSummary',
      'PaymentPeriod',
      'PaymentKpis',
      'PaymentTotals',
      'ChannelTotals',
      'MethodTotals',
      'FailedPaymentCounts',
      'ReconciliationAmounts',
      'TheaterReconciliation',
      'ProviderCheck',
      'ReconciliationMismatch',
      'PaymentsReconciliation',
    ]) {
      expect({ name, exists: Boolean(document.components!.schemas![name]) }).toEqual({
        name,
        exists: true,
      });
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
