/** The seat map's WebSocket path (design §12), outside the REST prefix `/api/v1`. */
export const SEAT_MAP_PATH = '/ws';

/** Inbound messages are capped at 4 KB (design §12); `ws` closes a larger one with `1009`. */
export const SEAT_MAP_MAX_PAYLOAD_BYTES = 4096;

/** The server pings every 30 seconds and drops a client that missed the previous ping (§12). */
export const SEAT_MAP_PING_INTERVAL_MS = 30_000;

/** Close codes (RFC 6455 §7.4.1): a refused origin, and too many connections from one address. */
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_TRY_AGAIN_LATER = 1013;

/** A seat label: a row letter A–P without I, then a seat number 1–20 (`F7`). */
export const SEAT_LABEL_PATTERN = /^[A-HJ-P]([1-9]|1[0-9]|20)$/;
