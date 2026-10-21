/** Ciphertext format version; the first dot-separated part of every stored ciphertext. */
export const CIPHERTEXT_VERSION = 'v1';

export const CIPHER_ALGORITHM = 'aes-256-gcm';

/** GCM's recommended 96-bit nonce, random per encryption. */
export const NONCE_BYTES = 12;

/** The full 128-bit authentication tag. */
export const AUTH_TAG_BYTES = 16;

/** Hex characters of the key's SHA-256 used as its id in the ciphertext prefix. */
export const KEY_ID_LENGTH = 8;

/** Random tokens (refresh tokens, one-time links) carry 32 bytes of entropy (design §10.2). */
export const RANDOM_TOKEN_BYTES = 32;
