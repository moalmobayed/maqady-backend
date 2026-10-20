import { TestClock } from '../../../../support/clock';
import { RESEND_EMAILS_URL } from '../../../../../src/modules/messaging/messaging.constants';
import { ResendEmailSender } from '../../../../../src/modules/messaging/senders/resend-email.sender';
import {
  outcomeOfFetchError,
  outcomeOfResponse,
  retryAfterSeconds,
} from '../../../../../src/modules/messaging/senders/resend-response';
import type { OutgoingEmail } from '../../../../../src/modules/messaging/types';

const API_KEY = 're_unit_test_key';
const FROM = 'Maqady <tickets@maqady.example>';
const NOW = new Date('2026-10-20T14:00:00Z');

const EMAIL: OutgoingEmail = {
  messageId: 4217,
  to: 'hana@example.com',
  subject: 'Your tickets',
  text: 'See you at 21:30.',
  html: '<p>See you at 21:30.</p>',
};

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function resendError(
  status: number,
  name: string,
  message = 'A message that may echo hana@example.com',
) {
  return answer(status, { statusCode: status, name, message });
}

describe('ResendEmailSender', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let sender: ResendEmailSender;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    sender = new ResendEmailSender(
      { apiKey: API_KEY, from: FROM, minIntervalMs: 0 },
      new TestClock(NOW),
    );
  });

  it('posts to the Resend emails endpoint with the key, JSON and the message id as Idempotency-Key', async () => {
    fetchMock.mockResolvedValue(answer(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }));

    await sender.send(EMAIL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(url).toBe(RESEND_EMAILS_URL);
    expect(init!.method).toBe('POST');
    expect(init!.headers).toEqual({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': '4217',
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      from: FROM,
      to: ['hana@example.com'],
      subject: 'Your tickets',
      text: 'See you at 21:30.',
      html: '<p>See you at 21:30.</p>',
    });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports sent with the Resend id on a 2xx', async () => {
    fetchMock.mockResolvedValue(answer(200, { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }));
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'sent',
      providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
    });
  });

  it('retries a 2xx without an id, or with a body that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, {}));
    fetchMock.mockResolvedValueOnce(answer(200, 'OK'));
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'retry',
      errorCode: 'invalid_response',
    });
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'retry',
      errorCode: 'invalid_response',
    });
  });

  it('holds the daily and the monthly quota until the next 00:00 UTC', async () => {
    fetchMock.mockResolvedValueOnce(resendError(429, 'daily_quota_exceeded'));
    fetchMock.mockResolvedValueOnce(resendError(429, 'monthly_quota_exceeded'));
    const midnight = new Date('2026-10-21T00:00:00Z');
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'throttled',
      errorCode: 'daily_quota_exceeded',
      retryAt: midnight,
    });
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'throttled',
      errorCode: 'monthly_quota_exceeded',
      retryAt: midnight,
    });
  });

  it('holds a rate-limited email for Retry-After seconds', async () => {
    fetchMock.mockResolvedValue(resendError(429, 'rate_limit_exceeded'));
    fetchMock.mockResolvedValueOnce(
      answer(429, { statusCode: 429, name: 'rate_limit_exceeded' }, { 'Retry-After': '2' }),
    );
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'throttled',
      errorCode: 'rate_limit_exceeded',
      retryAt: new Date('2026-10-20T14:00:02Z'),
    });
  });

  it.each([
    [401, 'missing_api_key'],
    [403, 'invalid_api_key'],
    [401, 'restricted_api_key'],
    [409, 'concurrent_idempotent_requests'],
    [500, 'application_error'],
    [500, 'internal_server_error'],
    [503, 'service_unavailable'],
  ])('retries a %d %s', async (status, name) => {
    fetchMock.mockResolvedValue(resendError(status, name));
    await expect(sender.send(EMAIL)).resolves.toEqual({ kind: 'retry', errorCode: name });
  });

  it.each([
    [422, 'validation_error'],
    [400, 'validation_error'],
    [403, 'validation_error'],
    [422, 'invalid_from_address'],
    [409, 'invalid_idempotent_request'],
    [400, 'invalid_idempotency_key'],
    [404, 'not_found'],
  ])('rejects a %d %s for good', async (status, name) => {
    fetchMock.mockResolvedValue(resendError(status, name));
    await expect(sender.send(EMAIL)).resolves.toEqual({ kind: 'rejected', errorCode: name });
  });

  it('falls back to http_<status> for a body without a usable error name', async () => {
    fetchMock.mockResolvedValueOnce(answer(502, '<html>Bad gateway</html>'));
    fetchMock.mockResolvedValueOnce(answer(422, { name: 'Invalid to: hana@example.com' }));
    await expect(sender.send(EMAIL)).resolves.toEqual({ kind: 'retry', errorCode: 'http_502' });
    await expect(sender.send(EMAIL)).resolves.toEqual({ kind: 'rejected', errorCode: 'http_422' });
  });

  it('retries a timeout and a network failure without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(sender.send(EMAIL)).resolves.toEqual({ kind: 'retry', errorCode: 'timeout' });
    await expect(sender.send(EMAIL)).resolves.toEqual({
      kind: 'retry',
      errorCode: 'network_error',
    });
  });

  it('never reports Resend’s message, which can echo the recipient', async () => {
    fetchMock.mockResolvedValue(resendError(422, 'validation_error'));
    const outcome = await sender.send(EMAIL);
    expect(JSON.stringify(outcome)).not.toContain('hana@example.com');
  });

  it('spaces consecutive calls by the minimum interval', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer(200, { id: 'x' })));
    const paced = new ResendEmailSender(
      { apiKey: API_KEY, from: FROM, minIntervalMs: 40 },
      new TestClock(NOW),
    );
    const started = performance.now();
    await paced.send(EMAIL);
    await paced.send(EMAIL);
    await paced.send(EMAIL);
    expect(performance.now() - started).toBeGreaterThanOrEqual(75);
  });
});

describe('Resend response mapping', () => {
  it('computes the daily quota hold from the refusal time, even one second before midnight', () => {
    expect(
      outcomeOfResponse(
        429,
        { name: 'daily_quota_exceeded' },
        null,
        new Date('2026-10-20T23:59:59Z'),
      ),
    ).toEqual({
      kind: 'throttled',
      errorCode: 'daily_quota_exceeded',
      retryAt: new Date('2026-10-21T00:00:00Z'),
    });
  });

  it('holds the monthly quota for one day, also across the end of a year', () => {
    expect(
      outcomeOfResponse(
        429,
        { name: 'monthly_quota_exceeded' },
        null,
        new Date('2026-12-31T08:00:00Z'),
      ),
    ).toMatchObject({ retryAt: new Date('2027-01-01T00:00:00Z') });
  });

  it('defaults a 429 without a name to http_429 and 60 seconds', () => {
    expect(outcomeOfResponse(429, undefined, null, NOW)).toEqual({
      kind: 'throttled',
      errorCode: 'http_429',
      retryAt: new Date('2026-10-20T14:01:00Z'),
    });
  });

  it.each([
    [null, 60],
    ['', 60],
    ['soon', 60],
    ['Wed, 21 Oct 2026 07:28:00 GMT', 60],
    ['0', 1],
    ['1.2', 2],
    ['30', 30],
    ['86400', 3600],
  ])('reads Retry-After %p as %d seconds', (header, seconds) => {
    expect(retryAfterSeconds(header)).toBe(seconds);
  });

  it('treats any other status as retryable', () => {
    expect(outcomeOfResponse(302, undefined, null, NOW)).toEqual({
      kind: 'retry',
      errorCode: 'http_302',
    });
  });

  it('treats an abort like a timeout and anything else thrown as a network error', () => {
    expect(outcomeOfFetchError(new DOMException('aborted', 'AbortError'))).toEqual({
      kind: 'retry',
      errorCode: 'timeout',
    });
    expect(outcomeOfFetchError('weird')).toEqual({ kind: 'retry', errorCode: 'network_error' });
  });
});
