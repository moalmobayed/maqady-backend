import type { Customer, CustomerRow } from './types';

/** A row as other modules see it: camelCase, and never the password hash. */
export function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    lastSignInAt: row.last_sign_in_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
