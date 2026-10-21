/** One AES-256 key and the id stored in front of every ciphertext it produces. */
export interface EncryptionKey {
  readonly id: string;
  readonly secret: Buffer;
}

/** The current key encrypts; every key in `byId` (the current one included) decrypts. */
export interface EncryptionKeyring {
  readonly current: EncryptionKey;
  readonly byId: ReadonlyMap<string, EncryptionKey>;
}
