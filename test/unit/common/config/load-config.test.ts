import { resolve } from 'node:path';
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
  FRONTEND_BASE_URL: 'https://maqady.example',
  EMAIL_DRIVER: 'simulated',
  STORAGE_DRIVER: 'local',
};

const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiJ9.service-role.signature-part';
const SUPABASE_ENV = {
  ...VALID_ENV,
  STORAGE_DRIVER: 'supabase',
  SUPABASE_URL: 'https://abcd.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
};

const RESEND_KEY = 're_TopSecretResendKey42';

/** Design §10.6 defaults, as `loadConfig` returns them when no variable overrides one. */
const DEFAULT_RATE_LIMITS = {
  default: { limit: 300, windowSeconds: 60 },
  signInEmail: { limit: 5, windowSeconds: 60 },
  signInIp: { limit: 20, windowSeconds: 60 },
  registrationIp: { limit: 5, windowSeconds: 3600 },
  emailRequestEmail: { limit: 3, windowSeconds: 3600 },
  emailRequestIp: { limit: 20, windowSeconds: 3600 },
  verificationResendCustomer: { limit: 3, windowSeconds: 3600 },
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
      frontendBaseUrl: 'https://maqady.example',
      email: { driver: 'simulated' },
      storage: {
        driver: 'local',
        directory: resolve('.media'),
        publicBaseUrl: 'http://localhost:3000/media',
      },
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
    expect(() => loadConfig({ ...VALID_ENV, PATH: '/usr/bin', HOME: '/root' })).not.toThrow();
  });

  it('reports each missing required variable as required', () => {
    expect(problemsFor({})).toEqual([
      'DATABASE_URL is required',
      'DB_SCHEMA is required',
      'CORS_ORIGINS is required',
      'JWT_SECRET_CUSTOMER is required',
      'JWT_SECRET_STAFF is required',
      'DATA_ENCRYPTION_KEY is required',
      'FRONTEND_BASE_URL is required',
      'EMAIL_DRIVER is required',
      'STORAGE_DRIVER is required',
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
      RATE_LIMIT_VERIFICATION_RESEND_CUSTOMER: '5/30m',
    });
    expect(rateLimits.default).toEqual({ limit: 1000, windowSeconds: 90 });
    expect(rateLimits.holdIp).toEqual({ limit: 7, windowSeconds: 600 });
    expect(rateLimits.ticketEmail).toEqual({ limit: 2, windowSeconds: 7200 });
    expect(rateLimits.verificationResendCustomer).toEqual({ limit: 5, windowSeconds: 1800 });
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
    ['FRONTEND_BASE_URL', 'maqady.example', 'must be an http:// or https:// URL'],
    ['FRONTEND_BASE_URL', 'ftp://maqady.example', 'must be an http:// or https:// URL'],
    ['FRONTEND_BASE_URL', 'https://maqady.example/?ref=mail', 'with no query or fragment'],
    ['FRONTEND_BASE_URL', 'https://maqady.example/#top', 'with no query or fragment'],
    ['FRONTEND_BASE_URL', 'https://user:pw@maqady.example', 'must be an http:// or https:// URL'],
    ['EMAIL_DRIVER', 'smtp', 'must be one of resend, simulated'],
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

  describe('email', () => {
    const RESEND_ENV = {
      ...VALID_ENV,
      EMAIL_DRIVER: 'resend',
      RESEND_API_KEY: RESEND_KEY,
      EMAIL_FROM: 'Maqady <tickets@maqady.example>',
    };

    it('removes trailing slashes from FRONTEND_BASE_URL and keeps a path', () => {
      expect(
        loadConfig({ ...VALID_ENV, FRONTEND_BASE_URL: 'https://maqady.example/' }).frontendBaseUrl,
      ).toBe('https://maqady.example');
      expect(
        loadConfig({ ...VALID_ENV, FRONTEND_BASE_URL: 'http://localhost:5173/app//' })
          .frontendBaseUrl,
      ).toBe('http://localhost:5173/app');
    });

    it('needs neither the key nor the sender with the simulated driver, and ignores them if set', () => {
      expect(loadConfig({ ...VALID_ENV, RESEND_API_KEY: RESEND_KEY }).email).toEqual({
        driver: 'simulated',
      });
    });

    it('reads the Resend key and sender with the resend driver', () => {
      expect(loadConfig(RESEND_ENV).email).toEqual({
        driver: 'resend',
        apiKey: RESEND_KEY,
        from: 'Maqady <tickets@maqady.example>',
      });
      expect(
        loadConfig({ ...RESEND_ENV, EMAIL_FROM: 'tickets@maqady.example' }).email,
      ).toMatchObject({ from: 'tickets@maqady.example' });
    });

    it('refuses the resend driver without its key or sender', () => {
      expect(problemsFor({ ...VALID_ENV, EMAIL_DRIVER: 'resend' })).toEqual([
        'RESEND_API_KEY is required when EMAIL_DRIVER is resend',
        'EMAIL_FROM is required when EMAIL_DRIVER is resend',
      ]);
    });

    it('refuses a malformed key or sender without echoing either', () => {
      const badKey = 're_Top Secret';
      const problems = problemsFor({
        ...RESEND_ENV,
        RESEND_API_KEY: badKey,
        EMAIL_FROM: 'tickets',
      });
      expect(problems).toEqual([
        'RESEND_API_KEY must be an API key with no spaces',
        'EMAIL_FROM must be an address such as tickets@maqady.example or Maqady <tickets@maqady.example>',
      ]);
      expect(problems.join('\n')).not.toContain(badKey);
    });

    it('never echoes the Resend key when another variable is wrong', () => {
      const problems = problemsFor({ ...RESEND_ENV, PORT: 'x' });
      expect(problems.join('\n')).not.toContain(RESEND_KEY);
    });
  });

  describe('storage (design 9, 14.5)', () => {
    it('reads the Supabase driver with the default bucket', () => {
      expect(loadConfig(SUPABASE_ENV).storage).toEqual({
        driver: 'supabase',
        supabaseUrl: 'https://abcd.supabase.co',
        serviceRoleKey: SERVICE_ROLE_KEY,
        bucket: 'media',
      });
      expect(loadConfig({ ...SUPABASE_ENV, STORAGE_BUCKET: 'maqady-media' }).storage).toEqual(
        expect.objectContaining({ bucket: 'maqady-media' }),
      );
    });

    it('requires the Supabase variables only for the supabase driver', () => {
      expect(problemsFor({ ...VALID_ENV, STORAGE_DRIVER: 'supabase' })).toEqual([
        'SUPABASE_URL is required when STORAGE_DRIVER is supabase',
        'SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_DRIVER is supabase',
      ]);
      expect(() => loadConfig(VALID_ENV)).not.toThrow();
    });

    it('reads the local driver: directory resolved, public URL from LOCAL_STORAGE_PUBLIC_URL or PORT', () => {
      expect(
        loadConfig({
          ...VALID_ENV,
          LOCAL_STORAGE_DIR: 'tmp/uploads',
          LOCAL_STORAGE_PUBLIC_URL: 'http://192.168.1.5:3105/media',
        }).storage,
      ).toEqual({
        driver: 'local',
        directory: resolve('tmp/uploads'),
        publicBaseUrl: 'http://192.168.1.5:3105/media',
      });
      expect(loadConfig({ ...VALID_ENV, PORT: '3105' }).storage).toEqual(
        expect.objectContaining({ publicBaseUrl: 'http://localhost:3105/media' }),
      );
    });

    it.each([
      ['STORAGE_DRIVER', 's3', 'STORAGE_DRIVER must be one of supabase, local'],
      ['SUPABASE_URL', 'http://abcd.supabase.co', 'SUPABASE_URL must be the project URL'],
      ['SUPABASE_URL', 'https://abcd.supabase.co/', 'SUPABASE_URL must be the project URL'],
      ['SUPABASE_URL', 'https://abcd.supabase.co/rest', 'SUPABASE_URL must be the project URL'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'short-key', 'SUPABASE_SERVICE_ROLE_KEY must be the service'],
      [
        'SUPABASE_SERVICE_ROLE_KEY',
        'a key with spaces in the middle',
        'SUPABASE_SERVICE_ROLE_KEY must be the service',
      ],
      ['STORAGE_BUCKET', 'Media', 'STORAGE_BUCKET must be a bucket name'],
      ['STORAGE_BUCKET', '-bucket', 'STORAGE_BUCKET must be a bucket name'],
    ])('refuses %s=%s', (variable, value, message) => {
      const problems = problemsFor({ ...SUPABASE_ENV, [variable]: value });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(message);
      // Values can be secrets: the problem names the variable, never the value.
      expect(problems[0]).not.toContain(value);
    });

    it('accepts plain http for a Supabase stack on the loopback host', () => {
      const config = loadConfig({ ...SUPABASE_ENV, SUPABASE_URL: 'http://127.0.0.1:54321' });
      expect(config.storage).toEqual(
        expect.objectContaining({ supabaseUrl: 'http://127.0.0.1:54321' }),
      );
    });

    it.each(['http://localhost:3000/media/', 'ftp://files.example/media', 'http://x/media?a=1'])(
      'refuses LOCAL_STORAGE_PUBLIC_URL=%s',
      (value) => {
        expect(problemsFor({ ...VALID_ENV, LOCAL_STORAGE_PUBLIC_URL: value })).toEqual([
          expect.stringContaining('LOCAL_STORAGE_PUBLIC_URL must be an http(s) URL'),
        ]);
      },
    );

    it('never echoes the service role key in a problem', () => {
      const problems = problemsFor({
        ...SUPABASE_ENV,
        SUPABASE_URL: 'not a url',
        SUPABASE_SERVICE_ROLE_KEY: 'secret value',
      });
      expect(problems.join('\n')).not.toContain('secret value');
      expect(problems).toEqual([
        expect.stringMatching(/^SUPABASE_URL must be the project URL/),
        'SUPABASE_SERVICE_ROLE_KEY must be the service role key from the Supabase dashboard (at least 20 characters, no spaces)',
      ]);
    });
  });
});
