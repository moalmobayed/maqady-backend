import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U11 (#12): charges and refunds of a booking (design §6.2, §6.3, §7.5, §7.7).
 *
 * - One row per money movement: a `charge` (`sale`, or an `edit_difference` collected at the
 *   counter, U14) or a `refund` naming the charge it returns (`refund_of_payment_id`). The whole
 *   table of §6.2 is created now, with the counter (U13) and payout (U14) columns, so their
 *   CHECKs hold from the first row.
 * - The partial unique index `uq_payments_booking_id_live_sale` is the database's guarantee that
 *   a booking has at most one in-flight or successful sale charge (§6.3): pressing Pay twice can
 *   never charge twice, whatever the application does.
 * - Online charges carry our idempotency key for the provider (`<reference>-c<n>`, refunds
 *   `<reference>-r<n>`), unique, so one attempt is one provider call.
 * - A `processing` charge has `settles_at`, the instant its provider result is ready; settlement
 *   judges it from that stored time when a request next reads or writes the booking or its
 *   showtime, never by a timer (§7.5).
 * - No defaults: times come from the service's `Clock`. Payments are never deleted, so no
 *   foreign key has an `ON DELETE`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE payments (
      id BIGSERIAL PRIMARY KEY,
      booking_id BIGINT NOT NULL,
      kind VARCHAR(8) NOT NULL,
      purpose VARCHAR(16) NOT NULL,
      method VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL,
      amount INT NOT NULL,
      currency VARCHAR(3) NOT NULL,
      refund_of_payment_id BIGINT NULL,
      provider_idempotency_key VARCHAR(32) NULL,
      provider_reference VARCHAR(100) NULL,
      card_brand VARCHAR(16) NULL,
      card_last4 VARCHAR(4) NULL,
      wallet_type VARCHAR(16) NULL,
      settles_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      collected_by_staff_id BIGINT NULL,
      paid_out_at TIMESTAMPTZ NULL,
      paid_out_by_staff_id BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_payments_booking_id FOREIGN KEY (booking_id) REFERENCES bookings (id),
      CONSTRAINT fk_payments_refund_of_payment_id
        FOREIGN KEY (refund_of_payment_id) REFERENCES payments (id),
      CONSTRAINT fk_payments_collected_by_staff_id
        FOREIGN KEY (collected_by_staff_id) REFERENCES staff_users (id),
      CONSTRAINT fk_payments_paid_out_by_staff_id
        FOREIGN KEY (paid_out_by_staff_id) REFERENCES staff_users (id),
      CONSTRAINT chk_payments_kind CHECK (kind IN ('charge', 'refund')),
      CONSTRAINT chk_payments_purpose CHECK (
        (kind = 'charge' AND purpose IN ('sale', 'edit_difference'))
        OR (kind = 'refund' AND purpose IN ('cancellation', 'edit_difference'))),
      CONSTRAINT chk_payments_method CHECK (method IN ('card', 'wallet', 'cash', 'card_terminal')),
      CONSTRAINT chk_payments_status CHECK (
        (kind = 'charge' AND status IN ('processing', 'succeeded', 'declined', 'cancelled'))
        OR (kind = 'refund' AND status IN ('pending', 'succeeded'))),
      CONSTRAINT chk_payments_online_states CHECK (
        status NOT IN ('processing', 'declined', 'cancelled') OR method IN ('card', 'wallet')),
      CONSTRAINT chk_payments_pending_refund CHECK (
        NOT (kind = 'refund' AND status = 'pending') OR method IN ('cash', 'card_terminal')),
      CONSTRAINT chk_payments_amount CHECK (amount > 0),
      CONSTRAINT chk_payments_currency CHECK (currency IN ('EGP')),
      CONSTRAINT chk_payments_refund_of CHECK ((kind = 'refund') = (refund_of_payment_id IS NOT NULL)),
      CONSTRAINT chk_payments_provider_key CHECK (
        (method IN ('card', 'wallet')) = (provider_idempotency_key IS NOT NULL)),
      CONSTRAINT chk_payments_card CHECK (
        (card_brand IS NULL) = (card_last4 IS NULL)
        AND (card_brand IS NULL OR (method = 'card'
          AND card_brand IN ('visa', 'mastercard', 'meeza') AND card_last4 ~ '^[0-9]{4}$'))),
      CONSTRAINT chk_payments_wallet CHECK (
        wallet_type IS NULL OR (method = 'wallet' AND wallet_type IN ('apple_pay', 'google_pay'))),
      CONSTRAINT chk_payments_settles_at CHECK (settles_at IS NULL OR method IN ('card', 'wallet')),
      CONSTRAINT chk_payments_completed CHECK (
        (status IN ('processing', 'pending')) = (completed_at IS NULL)),
      CONSTRAINT chk_payments_collected CHECK (
        kind = 'refund' OR (method IN ('cash', 'card_terminal')) = (collected_by_staff_id IS NOT NULL)),
      CONSTRAINT chk_payments_payout CHECK (
        (paid_out_at IS NULL) = (paid_out_by_staff_id IS NULL)
        AND (paid_out_at IS NULL OR (kind = 'refund' AND status = 'succeeded'
          AND method IN ('cash', 'card_terminal'))))
    )
  `);
  const columnComments: [column: string, comment: string][] = [
    [
      'provider_idempotency_key',
      'Our idempotency key for the payment provider: <reference>-c<n> for the n-th sale charge, <reference>-r<n> for the n-th refund. Online methods only.',
    ],
    [
      'provider_reference',
      "The provider's id of an online charge or refund; a card terminal's receipt reference at the counter (U13).",
    ],
    [
      'settles_at',
      "When a processing charge's provider result is ready; settlement judges it from this stored time (design 7.5).",
    ],
    [
      'completed_at',
      'When the row reached a final status ("paid on"); NULL while processing or pending.',
    ],
  ];
  for (const [column, comment] of columnComments) {
    await knex.raw(`COMMENT ON COLUMN payments.${column} IS '${comment.replace(/'/g, "''")}'`);
  }

  const indexes: [name: string, definition: string, comment: string][] = [
    [
      'uq_payments_booking_id_live_sale',
      `CREATE UNIQUE INDEX uq_payments_booking_id_live_sale ON payments (booking_id)
         WHERE kind = 'charge' AND purpose = 'sale' AND status IN ('processing', 'succeeded')`,
      'At most one in-flight or successful sale charge per booking (design 6.3): the backstop of ALREADY_PAID and PAYMENT_IN_PROGRESS on POST /bookings/{ref}/payments.',
    ],
    [
      'idx_payments_booking_id_created_at',
      'CREATE INDEX idx_payments_booking_id_created_at ON payments (booking_id, created_at, id)',
      "Covers fk_payments_booking_id. A booking's payments in order: the latest sale charge (DISTINCT ON (booking_id) ... WHERE booking_id = ANY(?) ORDER BY booking_id, created_at DESC, id DESC), the sale and refund counts behind provider keys, and the processing sale charges of bookings (WHERE booking_id = ANY(?) AND status = 'processing').",
    ],
    [
      'idx_payments_settles_at_processing',
      "CREATE INDEX idx_payments_settles_at_processing ON payments (settles_at) WHERE status = 'processing'",
      "Settlement: the due charges, WHERE status = 'processing' AND settles_at <= ? ORDER BY settles_at, id LIMIT ?.",
    ],
    [
      'uq_payments_provider_idempotency_key',
      `CREATE UNIQUE INDEX uq_payments_provider_idempotency_key ON payments (provider_idempotency_key)
         WHERE provider_idempotency_key IS NOT NULL`,
      'One provider call per attempt key: provider_idempotency_key = ?.',
    ],
    [
      'idx_payments_refund_of_payment_id',
      `CREATE INDEX idx_payments_refund_of_payment_id ON payments (refund_of_payment_id)
         WHERE refund_of_payment_id IS NOT NULL`,
      "Covers fk_payments_refund_of_payment_id. A charge's refunds: WHERE refund_of_payment_id = ANY(?) (refundable amount, U14).",
    ],
    [
      'idx_payments_collected_by_staff_id',
      `CREATE INDEX idx_payments_collected_by_staff_id ON payments (collected_by_staff_id)
         WHERE collected_by_staff_id IS NOT NULL`,
      'Covers fk_payments_collected_by_staff_id: the counter payments a staff member took (U13).',
    ],
    [
      'idx_payments_paid_out_by_staff_id',
      `CREATE INDEX idx_payments_paid_out_by_staff_id ON payments (paid_out_by_staff_id)
         WHERE paid_out_by_staff_id IS NOT NULL`,
      'Covers fk_payments_paid_out_by_staff_id: the counter refunds a staff member paid out (U14).',
    ],
  ];
  for (const [name, definition, comment] of indexes) {
    await knex.raw(definition);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw(`
    COMMENT ON TABLE payments IS
      'Charges and refunds of bookings; at most one in-flight or successful sale charge per booking (design 6.2, 6.3).'
  `);
  await knex.raw('ALTER TABLE payments ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.payments', [schema]);
}
