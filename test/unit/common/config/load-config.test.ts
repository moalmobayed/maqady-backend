import {
  ConfigValidationError,
  DEFAULT_LOG_LEVEL,
  DEFAULT_PORT,
  loadConfig,
} from '../../../../src/common/config/load-config';

const VALID_ENV = {
  DATABASE_URL: 'postgres://maqady:s3cret-pass@db.example.com:5432/maqady',
  DB_SCHEMA: 'maqady',
  CORS_ORIGINS: 'https://maqady.example',
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
    expect(() =>
      loadConfig({ ...VALID_ENV, PATH: '/usr/bin', JWT_SECRET_STAFF: 'x' }),
    ).not.toThrow();
  });

  it('reports each missing required variable as required', () => {
    expect(problemsFor({})).toEqual([
      'DATABASE_URL is required',
      'DB_SCHEMA is required',
      'CORS_ORIGINS is required',
    ]);
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
  ])('rejects %s=%p', (name, value, message) => {
    const problems = problemsFor({ ...VALID_ENV, [name]: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(name);
    expect(problems[0]).toContain(message);
  });

  it('names the variable but never echoes a value, which could be a secret', () => {
    const secretUrl = 'mysql://admin:TopSecretPassword42@db.example.com/maqady';
    let error: unknown;
    try {
      loadConfig({ ...VALID_ENV, DATABASE_URL: secretUrl, PORT: 'hunter2' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    const { message } = error as ConfigValidationError;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).not.toContain('TopSecretPassword42');
    expect(message).not.toContain('hunter2');
  });
});
