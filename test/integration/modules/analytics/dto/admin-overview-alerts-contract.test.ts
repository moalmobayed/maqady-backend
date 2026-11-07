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
  properties?: Record<string, { enum?: unknown[]; nullable?: boolean; description?: string }>;
}

/** U17's routes and schemas as the Overview and the bell read them from the generated contract. */
describe('Overview and bell in the OpenAPI document and the router', () => {
  let testApp: TestApp;
  let document: OpenAPIObject;

  const operation = (path: string, method: 'get' | 'post'): Operation =>
    (document.paths[path] as Record<string, Operation>)[method]!;
  const examples = (value: Operation, status: string): string[] =>
    Object.keys(value.responses[status]?.content?.['application/json']?.examples ?? {}).sort();
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

  it('serves the Overview to admins and the bell to both staff roles', () => {
    const served = new Map(
      listHttpRoutes(testApp).map((route) => [`${route.method} ${route.path}`, route.access]),
    );
    expect({
      overview: served.get('GET /api/v1/admin/overview'),
      alerts: served.get('GET /api/v1/admin/alerts'),
      reads: served.get('POST /api/v1/admin/alert-reads'),
    }).toEqual({ overview: 'admin', alerts: 'staff', reads: 'staff' });
  });

  it('documents each operation with its tag, prose, success, errors and security', () => {
    expect(document.tags?.map((tag) => tag.name)).toEqual(
      expect.arrayContaining(['Admin: overview', 'Admin: alerts']),
    );
    const cases = [
      { path: '/admin/overview', method: 'get', tag: 'Admin: overview', success: '200' },
      { path: '/admin/alerts', method: 'get', tag: 'Admin: alerts', success: '200' },
      { path: '/admin/alert-reads', method: 'post', tag: 'Admin: alerts', success: '200' },
    ] as const;
    for (const { path, method, tag, success } of cases) {
      const value = operation(path, method);
      expect({ path, tags: value.tags }).toEqual({ path, tags: [tag] });
      expect(value.summary).toBeTruthy();
      expect(value.description?.length).toBeGreaterThan(400);
      expect(value.security).toEqual([{ staff: [] }]);
      expect(Object.keys(value.responses)).toEqual(
        expect.arrayContaining([success, '400', '401', '403', '429', '500', '503']),
      );
      expect(examples(value, '400')).toEqual(expect.arrayContaining(['VALIDATION_FAILED']));
    }
    const overview = operation('/admin/overview', 'get');
    expect(examples(overview, '403')).toEqual(expect.arrayContaining(['FORBIDDEN']));
    expect(examples(overview, '404')).toEqual(['NOT_FOUND']);
    expect(overview.parameters?.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(['period', 'dateFrom', 'dateTo', 'theaterId']),
    );
    expect(operation('/admin/alerts', 'get').parameters?.map((p) => p.name)).toEqual(
      expect.arrayContaining(['cursor', 'limit']),
    );
    const reads = operation('/admin/alert-reads', 'post');
    expect(reads.requestBody).toBeDefined();
    const key = reads.parameters?.find((parameter) => parameter.name === 'Idempotency-Key');
    expect(key?.required ?? false).toBe(false);
  });

  it('publishes the schemas with their enums and nullable fields, every property described', () => {
    expect(enumOf('OverviewPeriodPreset')).toEqual(['today', '7d', '30d']);
    expect(enumOf('ComparisonBasis')).toEqual(['same_weekday_last_week', 'previous_period']);
    expect(enumOf('ShowtimeSlot')).toEqual([
      'before_15',
      '15_18',
      '18_21',
      '21_24',
      'after_midnight',
    ]);
    expect(enumOf('AlertKind')).toEqual(['failed_payments', 'low_sales', 'hall_gap']);
    expect(schema('AdminOverview').required).toEqual(
      expect.arrayContaining([
        'period',
        'comparison',
        'kpis',
        'byTheater',
        'byHall',
        'paymentMethods',
        'topMovies',
        'heatmap',
        'revenueTrend',
        'tonight',
      ]),
    );
    expect(schema('AdminOverview').properties!.byHall).toMatchObject({ nullable: true });
    expect(schema('RatioKpi').properties!.value).toMatchObject({ nullable: true });
    expect(schema('AdminAlert').properties!.readAt).toMatchObject({ nullable: true });
    expect(schema('AdminAlertPage').required).toEqual(
      expect.arrayContaining(['items', 'nextCursor', 'total', 'unreadCount']),
    );
    for (const name of [
      'AdminOverview',
      'OverviewPeriod',
      'OverviewComparison',
      'OverviewKpis',
      'MoneyKpi',
      'OptionalMoneyKpi',
      'CountKpi',
      'RatioKpi',
      'TheaterRevenue',
      'HallRevenue',
      'MovieRevenue',
      'MethodRevenue',
      'HeatmapCell',
      'RevenuePoint',
      'TheaterRevenueSeries',
      'RevenueTrend',
      'TonightShowtime',
      'TonightList',
      'AdminAlert',
      'FailedPaymentsAlert',
      'LowSalesAlert',
      'HallGapAlert',
      'AdminAlertPage',
      'AlertReadsRequest',
      'AlertReadResult',
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
