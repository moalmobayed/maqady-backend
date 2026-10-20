import {
  ConfigValidationError,
  DEFAULT_LOG_LEVEL,
  DEFAULT_PORT,
  loadConfig,
} from '../../../../src/common/config/load-config';

const CUSTOMER_SECRET = Buffer.alloc(32, 0x01).toString('base64');
const STAFF_SECRET = Buffer.alloc(48, 0x02).toString('base64url');
const ENCRYPTION_KEY = Buffer.alloc(32, 0x03).toString('base64');

const VALID_ENV = {
  DATABASE_URL: 'postgres://maqady:s3cret-pass@db.example.com:5432/maqady',
  DB_SCHEMA: 'maqady',
  CORS_ORIGINS: 'https://maqady.example',
  JWT_SECRET_CUSTOMER: CUSTOMER_SECRET,
  JWT_SECRET_STAFF: STAFF_SECRET,
  DATA_ENCRYPTION_KEY: ENCRYPTION_KEY,
};

/** Design §10.6 defaults, as `loadConfig` returns them when no variable overrides one. */
const DEFAULT_RATE_LIMITS = {
  default: { limit: 300, windowSeconds: 60 },
  signInEmail: { limit: 5, windowSeconds: 60 },
  signInIp: { limit: 20, windowSeconds: 60 },
  registrationIp: { limit: 5, windowSeconds: 3600 },
  emailRequestEmail: { limit: 3, windowSeconds: 3600 },
  emailRequestIp: { limit: 20, windowSeconds: 3600 },
  holdIp: { limit: 30, windowSeconds: 600 },
  holdCustomer: { limit: 10, windowSeconds: 600 },
  payment: { limit: 10, windowSeconds: 300 },
  ticketEmail: { limit: 3, windowSeconds: 3600 },
  search: { limit: 60, windowSeconds: 60 },
};

function problemsFor(env: Record<string, string | undefined>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('returns the typed config, with defaults for PORT and LOG_LEVEL', () => {
    expect(loadConfig(VALID_ENV)).toEqual({
      port: DEFAULT_PORT,
      logLevel: DEFAULT_LOG_LEVEL,
      corsOrigins: ['https://maqady.example'],
      database: { url: VALID_ENV.DATABASE_URL, schema: 'maqady' },
      auth: { customerTokenSecret: CUSTOMER_SECRET, staffTokenSecret: STAFF_SECRET },
      encryption: { key: ENCRYPTION_KEY },
      rateLimits: DEFAULT_RATE_LIMITS,
    });
    expect(DEFAULT_PORT).toBe(3000);
    expect(DEFAULT_LOG_LEVEL).toBe('info');
  });

  it('parses PORT, LOG_LEVEL and a comma-separated CORS_ORIGINS list', () => {
    const config = loadConfig({
      ...VALID_ENV,
      PORT: '10000',
      LOG_LEVEL: 'debug',
      CORS_ORIGINS: ' https://maqady.example , http://localhost:5173 ,',
    });
    expect(config.port).toBe(10000);
    expect(config.logLevel).toBe('debug');
    expect(config.corsOrigins).toEqual(['https://maqady.example', 'http://localhost:5173']);
  });

  it('accepts postgresql:// URLs with query parameters', () => {
    const url =
      'postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require';
    expect(loadConfig({ ...VALID_ENV, DATABASE_URL: url }).database.url).toBe(url);
  });

  it('treats empty values as unset, so the defaults apply', () => {
    const config = loadConfig({ ...VALID_ENV, PORT: '', LOG_LEVEL: '   ' });
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.logLevel).toBe(DEFAULT_LOG_LEVEL);
  });

  it('ignores variables it does not own', () => {
    expect(() => loadConfig({ ...VALID_ENV, PATH: '/usr/bin', SUPABASE_URL: 'x' })).not.toThrow();
  });

  it('reports each missing required variable as required', () => {
    expect(problemsFor({})).toEqual([
      'DATABASE_URL is required',
      'DB_SCHEMA is required',
      'CORS_ORIGINS is required',
      'JWT_SECRET_CUSTOMER is required',
      'JWT_SECRET_STAFF is required',
      'DATA_ENCRYPTION_KEY is required',
    ]);
  });

  it('keeps the previous encryption key when one is set, for decrypting after a rotation', () => {
    const previousKey = Buffer.alloc(32, 0x04).toString('base64url');
    const config = loadConfig({ ...VALID_ENV, DATA_ENCRYPTION_PREVIOUS_KEY: previousKey });
    expect(config.encryption).toEqual({ key: ENCRYPTION_KEY, previousKey });
  });

  it('refuses the same secret for both token audiences, however it is encoded', () => {
    const same = Buffer.alloc(32, 0x05);
    const problems = problemsFor({
      ...VALID_ENV,
      JWT_SECRET_CUSTOMER: same.toString('base64'),
      JWT_SECRET_STAFF: same.toString('base64url'),
    });
    expect(problems).toEqual(['JWT_SECRET_STAFF must differ from JWT_SECRET_CUSTOMER']);
  });

  it('reads rate limits from RATE_LIMIT_* variables, in seconds, minutes or hours', () => {
    const { rateLimits } = loadConfig({
      ...VALID_ENV,
      RATE_LIMIT_DEFAULT: '1000/90s',
      RATE_LIMIT_HOLD_IP: '7/10m',
      RATE_LIMIT_TICKET_EMAIL: '2/2h',
    });
    expect(rateLimits.default).toEqual({ limit: 1000, windowSeconds: 90 });
    expect(rateLimits.holdIp).toEqual({ limit: 7, windowSeconds: 600 });
    expect(rateLimits.ticketEmail).toEqual({ limit: 2, windowSeconds: 7200 });
    expect(rateLimits.search).toEqual(DEFAULT_RATE_LIMITS.search);
  });

  it.each([
    [
      'DATABASE_URL',
      'mysql://root@localhost/maqady',
      'must be a postgres:// or postgresql:// connection URL',
    ],
    ['DATABASE_URL', 'not a url', 'must be a postgres:// or postgresql:// connection URL'],
    ['DB_SCHEMA', 'Maqady', 'must be a lower-case SQL identifier'],
    ['DB_SCHEMA', 'maqady; drop table x', 'must be a lower-case SQL identifier'],
    ['CORS_ORIGINS', 'https://maqady.example/', 'must be a comma-separated list of origins'],
    ['CORS_ORIGINS', 'https://maqady.example/app', 'must be a comma-separated list of origins'],
    ['CORS_ORIGINS', 'ftp://maqady.example', 'must be a comma-separated list of origins'],
    ['CORS_ORIGINS', ',', 'must be a comma-separated list of origins'],
    ['PORT', 'abc', 'must be an integer between 1 and 65535'],
    ['PORT', '70000', 'must be an integer between 1 and 65535'],
    ['PORT', '0', 'must be an integer between 1 and 65535'],
    ['PORT', '80.5', 'must be an integer between 1 and 65535'],
    ['LOG_LEVEL', 'verbose', 'must be one of fatal, error, warn, info, debug, trace, silent'],
    ['JWT_SECRET_CUSTOMER', 'not base64!', 'must be base64 encoding at least 32 bytes'],
    [
      'JWT_SECRET_STAFF',
      Buffer.alloc(31, 9).toString('base64'),
      'must be base64 encoding at least 32 bytes',
    ],
    [
      'DATA_ENCRYPTION_KEY',
      Buffer.alloc(33, 9).toString('base64'),
      'must be base64 encoding exactly 32 bytes',
    ],
    [
      'DATA_ENCRYPTION_PREVIOUS_KEY',
      Buffer.alloc(16, 9).toString('base64'),
      'must be base64 encoding exactly 32 bytes',
    ],
    ['RATE_LIMIT_DEFAULT', '300', 'must be <count>/<window>'],
    ['RATE_LIMIT_SEARCH', '0/1m', 'must be <count>/<window>'],
    ['RATE_LIMIT_PAYMENT', '10/5d', 'must be <count>/<window>'],
  ])('rejects %s=%p', (name, value, message) => {
    const problems = problemsFor({ ...VALID_ENV, [name]: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
    expect(problems[0]).toContain(message);
  });

  it('names the variable but never echoes a value, which could be a secret', () => {
    const secretUrl = 'mysql://admin:TopSecretPassword42@db.example.com/maqady';
    const shortSecret = 'c2hvcnQtc2VjcmV0LXZhbHVl';
    let error: unknown;
    try {
      loadConfig({
        ...VALID_ENV,
        DATABASE_URL: secretUrl,
        PORT: 'hunter2',
        JWT_SECRET_STAFF: shortSecret,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    const { message } = error as ConfigValidationError;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).not.toContain('TopSecretPassword42');
    expect(message).not.toContain('hunter2');
    expect(message).toContain('JWT_SECRET_STAFF');
    expect(message).not.toContain(shortSecret);
  });
});
