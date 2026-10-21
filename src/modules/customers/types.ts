import type { CUSTOMER_STATUSES } from './enums';

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** A `customers` row as the repository reads it. Anonymised rows have no personal fields. */
export interface CustomerRow {
  readonly id: number;
  readonly email: string | null;
  readonly full_name: string | null;
  readonly phone: string | null;
  readonly password_hash: string | null;
  readonly status: CustomerStatus;
  readonly email_verified_at: Date | null;
  readonly last_sign_in_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}

/** A live `customers` row as `insertIfEmailFree()` writes it. */
export interface NewCustomerRow {
  readonly email: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly password_hash: string;
  readonly status: CustomerStatus;
  readonly last_sign_in_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The profile columns `PATCH /me` changes; absent ones stay. */
export interface CustomerProfileUpdate {
  readonly full_name?: string;
  readonly phone?: string | null;
  readonly updated_at: Date;
}

/** Any change the repository writes to a live row; `updated_at` always moves with it. */
export interface CustomerRowChanges {
  readonly full_name?: string;
  readonly phone?: string | null;
  readonly password_hash?: string;
  readonly status?: CustomerStatus;
  readonly updated_at: Date;
}

/** What the per-request check reads: the `sid` session and its customer, in one query. */
export interface CustomerPrincipalRow {
  readonly customer_id: number;
  readonly revoked_at: Date | null;
  readonly expires_at: Date;
  readonly status: CustomerStatus;
  readonly deleted_at: Date | null;
}

/** A customer as other modules see them. Never carries the password hash. */
export interface Customer {
  readonly id: number;
  /** Null once anonymised, like the name and phone. */
  readonly email: string | null;
  readonly fullName: string | null;
  /** E.164, for example `+201012345678`. */
  readonly phone: string | null;
  readonly status: CustomerStatus;
  readonly emailVerifiedAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** `POST /auth/registrations`. */
export interface RegisterCustomerInput {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
}

/** `POST /auth/sessions`. */
export interface CustomerSignInInput {
  readonly email: string;
  readonly password: string;
}

/** A token pair for a customer session. */
export interface CustomerTokens {
  readonly customerId: number;
  readonly sessionId: number;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/** A registration or sign-in: the tokens and who is signed in. */
export interface CustomerSession {
  readonly tokens: CustomerTokens;
  readonly customer: Customer;
}

/** What `PATCH /me` asks to change; `phone: null` clears it. */
export interface ProfileChanges {
  readonly fullName?: string;
  readonly phone?: string | null;
}

/** `PUT /me/password`. */
export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** `POST /auth/password-resets`. */
export interface ResetPasswordInput {
  readonly token: string;
  readonly password: string;
}

/** The parameters of `customer.verify_email`. */
export interface CustomerVerifyEmailParams {
  readonly fullName: string;
  readonly token: string;
}

/** The parameters of `customer.password_reset`. */
export interface CustomerPasswordResetParams {
  readonly fullName: string;
  readonly token: string;
}
