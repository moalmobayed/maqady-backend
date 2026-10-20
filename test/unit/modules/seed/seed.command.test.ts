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

  it('refuses a seed admin password that the policy would refuse, without echoing it', () => {
    const refusals = seedRefusals({ SEED_ADMIN_PASSWORD: 'short' }, local);
    expect(refusals).toEqual(['SEED_ADMIN_PASSWORD must meet the password policy']);
    expect(refusals.join(' ')).not.toContain('short');
    expect(seedRefusals({ SEED_ADMIN_PASSWORD: 'Longer-passw0rd' }, local)).toEqual([]);
  });
});
