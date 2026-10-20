/** `noun.verb`, lower-case with underscores, for example `booking.refunded` (design §6.2). */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

/** An entity type such as `booking` or `showtime`. */
export const AUDIT_ENTITY_TYPE_PATTERN = /^[a-z][a-z_]*$/;

/** A field name as the API names it, possibly dotted: `contactEmail`, `prices.front`. */
export const AUDIT_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

/**
 * Metadata keys that suggest personal data or secrets. Audit events carry the names of changed
 * fields, never their values (design §13.5), so these keys are refused.
 */
export const FORBIDDEN_METADATA_KEY = /(email|phone|name|password|token|secret|address|card)/i;

export const MAX_ACTION_LENGTH = 64;
export const MAX_ENTITY_TYPE_LENGTH = 32;
