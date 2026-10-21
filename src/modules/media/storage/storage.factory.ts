import type { AppConfig } from '../../../common/config/types';
import { LocalStorageAdapter } from './local-storage.adapter';
import type { StorageAdapter } from './storage.adapter';
import { SupabaseStorageAdapter } from './supabase-storage.adapter';

/** The adapter `STORAGE_DRIVER` selects; its settings were validated at boot. */
export function createStorageAdapter(config: AppConfig): StorageAdapter {
  const { storage } = config;
  return storage.driver === 'supabase'
    ? new SupabaseStorageAdapter(storage)
    : new LocalStorageAdapter(storage);
}
