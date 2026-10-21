/** Injection token for the validated `AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/** HS256 secrets shorter than the hash output weaken the signature (RFC 7518 §3.2). */
export const ACCESS_TOKEN_SECRET_MIN_BYTES = 32;

/** AES-256-GCM takes a 256-bit key. */
export const DATA_ENCRYPTION_KEY_BYTES = 32;
/** Ticket QR signatures (design §7.9, §14.5): HMAC-SHA256 under at least 32 bytes. */
export const QR_SIGNING_KEY_MIN_BYTES = 32;
