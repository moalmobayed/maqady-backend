import { randomUUID } from 'node:crypto';
import { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import { IDEMPOTENT_REPLAYED_HEADER } from '../../../../src/common/idempotency/idempotency.constants';
import { subtractFromInstant } from '../../../../src/common/time/time';
import { TestClock } from '../../../support/clock';
import {
  createFoundationsProbeTables,
  dropFoundationsProbeTables,
  FoundationsProbeModule,
  GUEST_HOLD_TOKEN,
  AccessProbeModule,
  LOCKS_TABLE,
  ProbeState,
  REAL_RESOLVERS_OFF,
  TestPrincipalResolvers,
  TestPrincipalResolversModule,
  WIDGETS_TABLE,
} from '../../../support/foundations-probe.module';
import { createTestApp } from '../../../support/test-app';
import { TEST_SCHEMA } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

const WIDGETS = '/api/v1/test-foundations/widgets';
const REPLAYED = IDEMPOTENT_REPLAYED_HEADER.toLowerCase();

describe('WriteInterceptor: request transactions and idempotency (integration)', () => {
  let testApp: TestApp;
  let state: ProbeState;
  const clock = new TestClock();

  const widgetRows = async (): Promise<{ name: string }[]> =>
    testApp.knex(WIDGETS_TABLE).select('name').orderBy('id');
  const keyRows = async (key: string): Promise<Record<string, unknown>[]> =>
    testApp
      .knex('idempotency_keys')
      .select(
        'scope',
        'key',
        'request_hash',
        'response_status',
        'response_ciphertext',
        'created_at',
      )
      .where({ key });

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      imports: [FoundationsProbeModule, AccessProbeModule, TestPrincipalResolversModule],
      overrides: REAL_RESOLVERS_OFF,
    });
    await createFoundationsProbeTables(testApp.knex, TEST_SCHEMA);
    state = testApp.app.get(ProbeState);
  });

  beforeEach(async () => {
    state.reset();
    clock.set(new Date());
    await testApp.knex.raw('TRUNCATE ??, ??, idempotency_keys, audit_events RESTART IDENTITY', [
      WIDGETS_TABLE,
      LOCKS_TABLE,
    ]);
  });

  afterAll(async () => {
    await dropFoundationsProbeTables(testApp.knex, TEST_SCHEMA);
    await testApp.close();
  });

  describe('with the same Idempotency-Key', () => {
    it('runs the handler once for two concurrent requests; the other replays', async () => {
      const key = randomUUID();
      state.delayMs = 300; // the first request holds its key, uncommitted, while the second arrives
      const [first, second] = await Promise.all(
        [1, 2].map(() =>
          testApp.http().post(WIDGETS).set('Idempotency-Key', key).send({ name: 'Lamp' }),
        ),
      );

      expect(state.runsOf('createWidget')).toBe(1);
      expect([first!.status, second!.status]).toEqual([201, 201]);
      expect(first!.body).toEqual(second!.body);
      expect(first!.body).toEqual({ id: 1, name: 'Lamp', run: 1 });
      const replayed = [first!.headers[REPLAYED], second!.headers[REPLAYED]];
      expect(replayed.sort()).toEqual(['true', undefined].sort());
      expect(await widgetRows()).toEqual([{ name: 'Lamp' }]);
    });

    it('replays a later retry with the stored status, body and Idempotent-Replayed: true', async () => {
      const key = randomUUID();
      const first = await testApp
        .http()
        .put('/api/v1/test-foundations/widgets/5')
        .set('Idempotency-Key', key)
        .send({ name: 'Desk' });
      const retry = await testApp
        .http()
        .put('/api/v1/test-foundations/widgets/5')
        .set('Idempotency-Key', key)
        .send({ name: 'Desk' });

      expect(first.status).toBe(200);
      expect(first.headers).not.toHaveProperty(REPLAYED);
      expect(retry.status).toBe(200);
      expect(retry.headers[REPLAYED]).toBe('true');
      expect(retry.body).toEqual({ id: 5, name: 'Desk', run: 1 });
      expect(state.runsOf('renameWidget')).toBe(1);
    });

    it('treats a body with its keys in another order as the same request', async () => {
      const key = randomUUID();
      await testApp
        .http()
        .post('/api/v1/test-foundations/audit-events')
        .set('Idempotency-Key', key)
        .send({ fail: false });
      const retry = await testApp
        .http()
        .post('/api/v1/test-foundations/audit-events')
        .set('Idempotency-Key', key)
        .set('Content-Type', 'application/json')
        .send('{ "fail": false }');
      expect(retry.status).toBe(201);
      expect(retry.headers[REPLAYED]).toBe('true');
    });

    it('answers IDEMPOTENCY_KEY_REUSED for a different body, without running the handler', async () => {
      const key = randomUUID();
      await testApp.http().post(WIDGETS).set('Idempotency-Key', key).send({ name: 'Lamp' });
      const reused = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Chair' });

      expect(reused.status).toBe(422);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(state.runsOf('createWidget')).toBe(1);
      expect(await widgetRows()).toEqual([{ name: 'Lamp' }]);
    });

    it('answers IDEMPOTENCY_KEY_REUSED for another route or another path parameter', async () => {
      const key = randomUUID();
      const path = (id: number): string => `/api/v1/test-foundations/widgets/${id}`;
      await testApp.http().put(path(1)).set('Idempotency-Key', key).send({ name: 'Desk' });
      const otherPath = await testApp
        .http()
        .put(path(2))
        .set('Idempotency-Key', key)
        .send({ name: 'Desk' });
      const otherRoute = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Desk' });
      expect(otherPath.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(otherRoute.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('takes over a key older than 24 hours by the Clock, and runs the new request', async () => {
      const key = randomUUID();
      await testApp.http().post(WIDGETS).set('Idempotency-Key', key).send({ name: 'Lamp' });
      clock.advance({ hours: 24, seconds: 1 });
      const later = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Chair' });

      expect(later.status).toBe(201);
      expect(later.headers).not.toHaveProperty(REPLAYED);
      expect(later.body).toMatchObject({ name: 'Chair', run: 2 });
      const [row] = await keyRows(key);
      expect(row?.created_at).toEqual(clock.now());
      expect(await widgetRows()).toEqual([{ name: 'Lamp' }, { name: 'Chair' }]);
    });

    it('still replays a key just under 24 hours old', async () => {
      const key = randomUUID();
      await testApp.http().post(WIDGETS).set('Idempotency-Key', key).send({ name: 'Lamp' });
      clock.advance({ hours: 23, minutes: 59 });
      const retry = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Lamp' });
      expect(retry.headers[REPLAYED]).toBe('true');
      expect(state.runsOf('createWidget')).toBe(1);
    });

    it('keeps the keys of different principals apart', async () => {
      const resolvers = testApp.app.get(TestPrincipalResolvers);
      const tokens = testApp.app.get(AccessTokenService);
      resolvers.set('customer', 11, { kind: 'customer', id: 1, sessionId: 11 });
      resolvers.set('customer', 12, { kind: 'customer', id: 2, sessionId: 12 });
      const tokenOf = (id: number, sessionId: number): string =>
        tokens.sign({ audience: 'customer', subjectId: id, sessionId });
      const key = randomUUID();

      const send = (token: string) =>
        testApp
          .http()
          .post('/api/v1/test-access/customer-writes')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', key);
      const first = await send(tokenOf(1, 11));
      const second = await send(tokenOf(2, 12));
      const anonymous = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Lamp' });

      expect(first.body).toEqual({ principalId: 1 });
      expect(second.body).toEqual({ principalId: 2 });
      expect(second.headers).not.toHaveProperty(REPLAYED);
      expect(anonymous.status).toBe(201);
      const scopes = (await keyRows(key)).map((row) => row.scope).sort();
      expect(scopes).toEqual(['anonymous', 'customer:1', 'customer:2']);
    });
  });

  describe('for a guest, whose access is a hold code the handler checks', () => {
    const pay = (key: string, holdToken?: string) => {
      const request = testApp
        .http()
        .post('/api/v1/test-access/holds/AB12CD/payments')
        .set('Idempotency-Key', key);
      return holdToken === undefined ? request : request.set('X-Hold-Token', holdToken);
    };

    it('replays only to a retry that sends the same hold code', async () => {
      const key = randomUUID();
      const owner = await pay(key, GUEST_HOLD_TOKEN);
      const retry = await pay(key, GUEST_HOLD_TOKEN);

      expect(owner.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.headers[REPLAYED]).toBe('true');
      expect(retry.body).toEqual(owner.body);
    });

    it("never replays the guest's response to a request with another hold code, or none", async () => {
      const key = randomUUID();
      await pay(key, GUEST_HOLD_TOKEN);
      const stranger = await pay(key, 'someone-elses-code');
      const withoutCode = await pay(key);

      for (const response of [stranger, withoutCode]) {
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(response.headers).not.toHaveProperty(REPLAYED);
        expect(JSON.stringify(response.body)).not.toContain('ticket-secret');
      }
    });
  });

  describe('strict routes', () => {
    it('answer IDEMPOTENCY_KEY_REQUIRED without a key, before the handler runs', async () => {
      const response = await testApp.http().post(WIDGETS).send({ name: 'Lamp' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(state.runsOf('createWidget')).toBe(0);
      expect(await widgetRows()).toEqual([]);
    });

    it('answer VALIDATION_FAILED on Idempotency-Key for a malformed key', async () => {
      const response = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', 'not a key!')
        .send({ name: 'Lamp' });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.fields[0].field).toBe('Idempotency-Key');
      expect(state.runsOf('createWidget')).toBe(0);
    });

    it('still require the key when the route opts out of the request transaction', async () => {
      const missing = await testApp.http().post('/api/v1/test-foundations/uploads');
      expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const sent = await testApp
        .http()
        .post('/api/v1/test-foundations/uploads')
        .set('Idempotency-Key', randomUUID());
      expect(sent.status).toBe(201);
      expect(sent.body).toEqual({ inTransaction: false, run: 1 });
    });
  });

  describe('when the handler throws', () => {
    it('rolls back its writes and its key, so a retry with the same key runs again', async () => {
      const key = randomUUID();
      state.failuresLeft = 1;
      const failed = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Lamp' });
      expect(failed.status).toBe(409);
      expect(await widgetRows()).toEqual([]);
      expect(await keyRows(key)).toEqual([]);

      const retry = await testApp
        .http()
        .post(WIDGETS)
        .set('Idempotency-Key', key)
        .send({ name: 'Lamp' });
      expect(retry.status).toBe(201);
      expect(retry.headers).not.toHaveProperty(REPLAYED);
      expect(retry.body).toMatchObject({ name: 'Lamp', run: 2 });
      expect(await widgetRows()).toEqual([{ name: 'Lamp' }]);
    });

    it('rolls back a write made without a key too', async () => {
      const response = await testApp
        .http()
        .post('/api/v1/test-foundations/audit-events')
        .send({ fail: true });
      expect(response.status).toBe(409);
      expect(await testApp.knex('audit_events').count({ n: '*' })).toEqual([{ n: 0 }]);
    });
  });

  it('retries the whole transaction once after a real deadlock (40P01)', async () => {
    await testApp.knex(LOCKS_TABLE).insert([{ name: 'a' }, { name: 'b' }]);
    const [left, right] = await Promise.all([
      testApp.http().post('/api/v1/test-foundations/lock-pairs').send({ first: 'a', tag: 'left' }),
      testApp.http().post('/api/v1/test-foundations/lock-pairs').send({ first: 'b', tag: 'right' }),
    ]);

    expect([left.status, right.status]).toEqual([201, 201]);
    const attempts = [left.body.attempt, right.body.attempt].sort();
    expect(attempts).toEqual([1, 2]);
  });

  it('stores the response body encrypted, never in plain text', async () => {
    const key = randomUUID();
    await testApp.http().post(WIDGETS).set('Idempotency-Key', key).send({ name: 'Secret lamp' });
    const [row] = await keyRows(key);
    expect(row).toMatchObject({ scope: 'anonymous', response_status: 201 });
    expect(row?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.response_ciphertext).toMatch(/^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(String(row?.response_ciphertext)).not.toContain('Secret');
  });

  it('stores nothing for @NoIdempotencyStorage routes, which still run in a transaction', async () => {
    const key = randomUUID();
    const first = await testApp
      .http()
      .post('/api/v1/test-foundations/sessions')
      .set('Idempotency-Key', key);
    const second = await testApp
      .http()
      .post('/api/v1/test-foundations/sessions')
      .set('Idempotency-Key', key);
    expect(first.body).toEqual({ token: 'secret-token', run: 1, inTransaction: true });
    expect(second.body).toEqual({ token: 'secret-token', run: 2, inTransaction: true });
    expect(second.headers).not.toHaveProperty(REPLAYED);
    expect(await keyRows(key)).toEqual([]);
  });

  it('purges expired keys on the side of a write, up to 50 at a time', async () => {
    const old = subtractFromInstant(clock.now(), { hours: 25 });
    const expired = Array.from({ length: 60 }, (_, index) => ({
      scope: 'anonymous',
      key: `expired-${index}`,
      request_hash: '0'.repeat(64),
      response_status: 201,
      response_ciphertext: null,
      created_at: old,
    }));
    await testApp
      .knex('idempotency_keys')
      .insert([...expired, { ...expired[0], key: 'live', created_at: clock.now() }]);

    await testApp.http().post(WIDGETS).set('Idempotency-Key', randomUUID()).send({ name: 'Lamp' });

    const remaining = await testApp
      .knex('idempotency_keys')
      .where('created_at', '<', subtractFromInstant(clock.now(), { hours: 24 }))
      .count({ n: '*' });
    expect(remaining).toEqual([{ n: 10 }]);
    expect(await keyRows('live')).toHaveLength(1);
  });

  it('runs reads without a request transaction, and writes inside one', async () => {
    const read = await testApp.http().get('/api/v1/test-foundations/transaction-state');
    const write = await testApp.http().post('/api/v1/test-foundations/transaction-state');
    expect(read.body).toEqual({ inTransaction: false });
    expect(write.body).toEqual({ inTransaction: true });
  });

  it('runs post-commit hooks registered by the handler once the request commits', async () => {
    const response = await testApp.http().post('/api/v1/test-foundations/hooks');
    expect(response.status).toBe(201);
    expect(state.runsOf('hookRan')).toBe(1);
  });
});
