import type { AppConfig } from '../../../../src/common/config/types';
import { seedRefusals } from '../../../../src/modules/seed/seed.command';
import { buildTestConfig } from '../../../support/test-config';

describe('seedRefusals', () => {
  const local = buildTestConfig();

  it('allows a development environment with local storage and simulated email', () => {
    expect(seedRefusals({ NODE_ENV: 'development' }, local)).toEqual([]);
    expect(seedRefusals({}, local)).toEqual([]);
  });

  it('refuses production, whatever its case', () => {
    expect(seedRefusals({ NODE_ENV: ' Production ' }, local)).toEqual([
      'NODE_ENV is production: the seed is for development databases only',
    ]);
  });

  it('refuses real storage and real email', () => {
    const real = {
      ...local,
      storage: {
        driver: 'supabase',
        supabaseUrl: 'https://ref.supabase.co',
        serviceRoleKey: 'key',
        bucket: 'media',
      },
      email: { driver: 'resend', apiKey: 'key', from: 'tickets@maqady.example' },
    } as AppConfig;
    expect(seedRefusals({}, real)).toEqual([
      'STORAGE_DRIVER must be local: the seed never uploads to real storage',
      'EMAIL_DRIVER must be simulated: the seed never sends email',
    ]);
  });

  it('refuses a database that is not on this machine, without echoing its URL', () => {
    const at = (url: string) => ({ ...local, database: { ...local.database, url } }) as AppConfig;
    const remote = 'postgres://postgres:s3cret@db.abcdefgh.supabase.co:5432/postgres';
    const refusals = seedRefusals({}, at(remote));
    expect(refusals).toEqual([
      'DATABASE_URL must point at a local database (localhost, 127.0.0.1, ::1, a Unix socket or a Docker Compose service): the seed creates an admin with a known password',
    ]);
    expect(refusals.join(' ')).not.toContain('s3cret');
    expect(refusals.join(' ')).not.toContain('supabase');
    expect(seedRefusals({}, at('postgres://u:p@[2001:db8::7]:5432/maqady'))).toHaveLength(1);
    expect(seedRefusals({}, at('not a url'))).toHaveLength(1);
    for (const url of [
      'postgres://postgres:postgres@localhost:5432/maqady_dev',
      'postgres://postgres:postgres@127.0.0.1/maqady_dev',
      'postgres://postgres:postgres@[::1]:5432/maqady_dev',
      'postgres://postgres:postgres@postgres:5432/maqady_dev',
      'postgres:///maqady_dev?host=/var/run/postgresql',
    ]) {
      expect({ url, refusals: seedRefusals({}, at(url)) }).toEqual({ url, refusals: [] });
    }
  });

  it('refuses a seed admin password that the policy would refuse, without echoing it', () => {
    const refusals = seedRefusals({ SEED_ADMIN_PASSWORD: 'short' }, local);
    expect(refusals).toEqual(['SEED_ADMIN_PASSWORD must meet the password policy']);
    expect(refusals.join(' ')).not.toContain('short');
    expect(seedRefusals({ SEED_ADMIN_PASSWORD: 'Longer-passw0rd' }, local)).toEqual([]);
  });
});
