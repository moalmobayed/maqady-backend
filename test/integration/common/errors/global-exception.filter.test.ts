import { isUuid } from '../../../../src/common/logging/correlation-id';
import {
  createProbeTable,
  dropProbeTable,
  PROBE_CONSTRAINT,
  ProbeModule,
} from '../../../support/probe.module';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

const CLIENT_REQUEST_ID = '3d594650-3436-4a88-9e6c-1d4c0f5a0b2e';

/** Every error body, whatever the cause: exactly these keys, and the id the header carries. */
function expectErrorShape(response: { body: unknown; headers: Record<string, unknown> }): void {
  const { error } = response.body as { error: Record<string, unknown> };
  expect(Object.keys(response.body as object)).toEqual(['error']);
  expect(Object.keys(error)).toEqual(['code', 'message', 'details', 'correlationId']);
  expect(isUuid(String(error.correlationId))).toBe(true);
  expect(error.correlationId).toBe(response.headers['x-request-id']);
}

describe('Error responses (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp({ imports: [ProbeModule] });
    await createProbeTable(testApp.knex, testApp.config.database.schema);
  });

  afterAll(async () => {
    await dropProbeTable(testApp.knex, testApp.config.database.schema);
    await testApp.close();
  });

  describe('unknown routes', () => {
    it('answer 404 NOT_FOUND naming the method and path', async () => {
      const response = await testApp.http().get('/api/v1/nope?email=a@b.example');
      expect(response.status).toBe(404);
      expectErrorShape(response);
      expect(response.body.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'No route matches GET /api/v1/nope.',
        details: null,
      });
    });

    it('answer the same way outside the /api/v1 prefix, with the client id echoed', async () => {
      const response = await testApp.http().delete('/nope').set('X-Request-Id', CLIENT_REQUEST_ID);
      expect(response.status).toBe(404);
      expectErrorShape(response);
      expect(response.body.error).toMatchObject({
        code: 'NOT_FOUND',
        correlationId: CLIENT_REQUEST_ID,
      });
    });
  });

  describe('validation', () => {
    it('lets a valid body through, transformed', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send({ name: 'Mona', seats: [{ label: 'C4' }] });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ name: 'Mona', seats: [{ label: 'C4' }] });
    });

    it('answers 400 VALIDATION_FAILED listing every invalid field, nested and unknown ones included', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send({ name: 'ab', seats: [{ label: 'C4' }, { label: 5 }], isAdmin: true });
      expect(response.status).toBe(400);
      expectErrorShape(response);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid.',
      });
      // The order of the entries is not part of the contract.
      const { fields } = response.body.error.details as { fields: unknown[] };
      expect(fields).toHaveLength(3);
      expect(fields).toEqual(
        expect.arrayContaining([
          { field: 'name', messages: ['name must be longer than or equal to 3 characters'] },
          { field: 'seats.1.label', messages: ['label must be a string'] },
          { field: 'isAdmin', messages: ['property isAdmin should not exist'] },
        ]),
      );
    });

    it('answers 400 VALIDATION_FAILED for malformed JSON, with the id the client sent', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .set('Content-Type', 'application/json')
        .set('X-Request-Id', CLIENT_REQUEST_ID)
        .send('{"name": "Mona",');
      expect(response.status).toBe(400);
      expectErrorShape(response);
      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: null,
        correlationId: CLIENT_REQUEST_ID,
      });
    });

    it('never parses a form-encoded body: only JSON is accepted', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .type('form')
        .send('name=Mona&seats=');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      const { fields } = response.body.error.details as { fields: { field: string }[] };
      expect(fields.map(({ field }) => field)).toEqual(['name', 'seats']);
    });
  });

  describe('body size', () => {
    it('answers 413 PAYLOAD_TOO_LARGE above 1 MB', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ name: 'x'.repeat(1024 * 1024), seats: [] }));
      expect(response.status).toBe(413);
      expectErrorShape(response);
      expect(response.body.error).toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.',
        details: null,
      });
    });

    it('accepts a body just under 1 MB', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-probe/echo')
        .send({ name: 'x'.repeat(1000 * 1000), seats: [] });
      expect(response.status).toBe(201);
    });
  });

  it('answers 500 INTERNAL with a generic message, never the error itself', async () => {
    const response = await testApp.http().get('/api/v1/test-probe/internal-error');
    expect(response.status).toBe(500);
    expectErrorShape(response);
    expect(response.body.error).toMatchObject({
      code: 'INTERNAL',
      message: 'Something went wrong on our side.',
      details: null,
    });
    expect(JSON.stringify(response.body)).not.toContain('probe internal failure');
  });

  it('answers 409 CONFLICT for an unhandled unique violation, naming the constraint only', async () => {
    const first = await testApp
      .http()
      .post('/api/v1/test-probe/items')
      .send({ code: 'value-secret-42' });
    expect(first.status).toBe(201);

    const second = await testApp
      .http()
      .post('/api/v1/test-probe/items')
      .send({ code: 'value-secret-42' });
    expect(second.status).toBe(409);
    expectErrorShape(second);
    expect(second.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'The request conflicts with existing data.',
      details: { constraint: PROBE_CONSTRAINT },
    });
    expect(JSON.stringify(second.body)).not.toContain('value-secret-42');
  });
});
