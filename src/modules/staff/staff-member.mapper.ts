import type { StaffMember, StaffUserRow } from './types';

/** A row as other modules see it: camelCase, and never the password hash. */
export function toStaffMember(row: StaffUserRow): StaffMember {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    hasPassword: row.password_hash !== null,
    lastSignInAt: row.last_sign_in_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
