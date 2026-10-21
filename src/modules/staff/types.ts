import type { StaffRole } from '../../common/auth/types';
import type { PASSWORD_SETUP_PURPOSES, SETTABLE_STAFF_STATUSES, STAFF_STATUSES } from './enums';

export type StaffStatus = (typeof STAFF_STATUSES)[number];

export type SettableStaffStatus = (typeof SETTABLE_STAFF_STATUSES)[number];

/** What a set-password link was issued for. */
export type PasswordSetupPurpose = (typeof PASSWORD_SETUP_PURPOSES)[number];

/** A `staff_users` row as the repository reads it. */
export interface StaffUserRow {
  readonly id: number;
  readonly email: string;
  readonly full_name: string;
  readonly role: StaffRole;
  readonly status: StaffStatus;
  readonly password_hash: string | null;
  readonly last_sign_in_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** A `staff_users` row as the repository inserts it. */
export interface NewStaffUserRow {
  readonly email: string;
  readonly full_name: string;
  readonly role: StaffRole;
  readonly status: StaffStatus;
  readonly password_hash: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/** The columns `PATCH /admin/staff/{id}` changes. */
export interface StaffUserUpdate {
  readonly role: StaffRole;
  readonly status: StaffStatus;
  readonly updated_at: Date;
}

/** The columns a password setup changes. */
export interface StaffPasswordUpdate {
  readonly password_hash: string;
  readonly status: 'active';
  readonly updated_at: Date;
}

/** A staff member as other modules see them. Never carries the password hash. */
export interface StaffMember {
  readonly id: number;
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly status: StaffStatus;
  /** False until the member sets a password (an invite, U2b). */
  readonly hasPassword: boolean;
  readonly lastSignInAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What the per-request check reads: the `sid` session and its staff member, in one query. */
export interface StaffPrincipalRow {
  readonly staff_user_id: number;
  readonly revoked_at: Date | null;
  readonly expires_at: Date;
  readonly role: StaffRole;
  readonly status: StaffStatus;
}

/** `GET /admin/staff` filters. */
export interface StaffListFilter {
  readonly role?: StaffRole;
  readonly status?: StaffStatus;
}

/** What `PATCH /admin/staff/{id}` asks to change; absent fields stay. */
export interface StaffMemberChanges {
  readonly role?: StaffRole;
  readonly status?: SettableStaffStatus;
}

/** A member created active with a password: the bootstrap admin, and test fixtures. */
export interface CreateActiveStaffInput {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly password: string;
}

export interface StaffSignInInput {
  readonly email: string;
  readonly password: string;
}

/** A token pair for a staff session. */
export interface StaffTokens {
  readonly staffUserId: number;
  readonly sessionId: number;
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

/** A successful sign-in: the tokens and who signed in. */
export interface StaffSignInResult {
  readonly tokens: StaffTokens;
  readonly member: StaffMember;
}

/** `npm run admin:create`'s input, from the `BOOTSTRAP_ADMIN_*` variables. */
export interface BootstrapAdminInput {
  readonly email: string;
  readonly fullName: string;
  readonly password: string;
}

/** What `npm run admin:create` did. */
export type BootstrapAdminResult =
  { readonly created: true; readonly id: number } | { readonly created: false };

/** `parseBootstrapAdminEnv`'s answer: the input, or the problems (variable names and rules only). */
export type BootstrapAdminParse =
  | { readonly ok: true; readonly input: BootstrapAdminInput }
  | { readonly ok: false; readonly problems: readonly string[] };

/** `POST /admin/staff`: who to invite. */
export interface InviteStaffInput {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
}

/** A sent invite: whose, and when its link stops working. */
export interface StaffInvitation {
  readonly staffUserId: number;
  readonly expiresAt: Date;
}

/** `POST /admin/auth/password-setups`: the emailed token and the new password. */
export interface PasswordSetupInput {
  readonly token: string;
  readonly password: string;
}

/** The parameters of the `staff.invite` email. `token` is secret: never stored in the clear. */
export interface StaffInviteParams {
  readonly fullName: string;
  readonly role: StaffRole;
  readonly token: string;
}

/** The parameters of the `staff.password_reset` email. `token` is secret. */
export interface StaffPasswordResetParams {
  readonly fullName: string;
  readonly token: string;
}
