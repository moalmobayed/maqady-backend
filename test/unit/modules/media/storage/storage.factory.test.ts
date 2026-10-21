import { buildTestConfig } from '../../../../support/test-config';
import { LocalStorageAdapter } from '../../../../../src/modules/media/storage/local-storage.adapter';
import { createStorageAdapter } from '../../../../../src/modules/media/storage/storage.factory';
import { SupabaseStorageAdapter } from '../../../../../src/modules/media/storage/supabase-storage.adapter';

describe('createStorageAdapter', () => {
  it('picks the adapter STORAGE_DRIVER names', () => {
    expect(createStorageAdapter(buildTestConfig())).toBeInstanceOf(LocalStorageAdapter);
    const supabase = buildTestConfig(
      {},
      {
        STORAGE_DRIVER: 'supabase',
        SUPABASE_URL: 'https://abcd.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-0123456789',
      },
    );
    const adapter = createStorageAdapter(supabase);
    expect(adapter).toBeInstanceOf(SupabaseStorageAdapter);
    expect(adapter.publicUrl('poster/x/small.webp')).toBe(
      'https://abcd.supabase.co/storage/v1/object/public/media/poster/x/small.webp',
    );
  });
});
