/** `customers.full_name VARCHAR(100)`. */
export const CUSTOMER_FULL_NAME_MAX_LENGTH = 100;

/** The longest email address accepted (RFC 5321's path limit, as `customers` checks it). */
export const EMAIL_MAX_LENGTH = 320;

/** Sign-in and the current password compare at most this many characters (design §10.1). */
export const SIGN_IN_PASSWORD_MAX_LENGTH = 128;

/**
 * The longest token a link route accepts. Issued tokens are 43 characters; anything else that
 * fits answers `INVALID_TOKEN`, as an old link does, rather than a validation error.
 */
export const ONE_TIME_TOKEN_MAX_LENGTH = 128;

/** What `customers.phone` holds (`chk_customers_phone`), and U3's SMS recipient rule. */
export const E164_PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

/**
 * An Egyptian mobile number as customers type it: `01`, a carrier digit (0, 1, 2 or 5), then
 * 8 digits. It is stored as `+20` followed by the number without its leading 0.
 */
export const EGYPT_LOCAL_MOBILE_PATTERN = /^01[0125][0-9]{8}$/;
export const EGYPT_COUNTRY_CODE = '+20';

/** What `PATCH /me` accepts for `phone`, as published: E.164 or an Egyptian local mobile. */
export const ACCEPTED_PHONE_PATTERN_SOURCE = `^(${E164_PHONE_PATTERN.source.slice(1, -1)}|${EGYPT_LOCAL_MOBILE_PATTERN.source.slice(1, -1)})$`;

/** The frontend pages the emailed links open (PRD "Payment and messaging providers"). */
export const VERIFY_EMAIL_PATH = '/verify-email';
export const RESET_PASSWORD_PATH = '/reset-password';

/** The message `PUT /me/password` gives under `currentPassword` when it does not match. */
export const CURRENT_PASSWORD_WRONG_MESSAGE = 'currentPassword is not correct';
