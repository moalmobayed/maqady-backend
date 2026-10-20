import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U3 (#3): the outbox and delivery log of every email and SMS (design §6.2, §13.1, ADR 0004).
 *
 * - The stored subject and bodies have one-time links redacted. The template parameters a retry
 *   needs to rebuild the real link are kept encrypted in `payload_ciphertext` while the message
 *   is `queued` or `failed`, and cleared once it is `sent`.
 * - `related_customer_id`, `related_staff_user_id` and `related_booking_id` get their foreign
 *   keys from the units that create `customers` (U9), `staff_users` (U2a) and `bookings` (U10).
 *   Each already has the covering index its key needs.
 * - No column has a default: every timestamp comes from the service's Clock.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE messages (
      id BIGSERIAL PRIMARY KEY,
      channel VARCHAR(8) NOT NULL,
      template VARCHAR(64) NOT NULL,
      recipient VARCHAR(320) NOT NULL,
      subject VARCHAR(300) NULL,
      body_text TEXT NOT NULL,
      body_html TEXT NULL,
      status VARCHAR(8) NOT NULL,
      attempts SMALLINT NOT NULL,
      last_error_code VARCHAR(64) NULL,
      next_attempt_at TIMESTAMPTZ NULL,
      payload_ciphertext TEXT NULL,
      provider_message_id VARCHAR(128) NULL,
      sent_at TIMESTAMPTZ NULL,
      related_customer_id BIGINT NULL,
      related_staff_user_id BIGINT NULL,
      related_booking_id BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT chk_messages_channel CHECK (channel IN ('email', 'sms')),
      CONSTRAINT chk_messages_status CHECK (status IN ('queued', 'sent', 'failed')),
      CONSTRAINT chk_messages_template CHECK (template ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'),
      CONSTRAINT chk_messages_attempts CHECK (attempts BETWEEN 0 AND 10),
      CONSTRAINT chk_messages_channel_fields CHECK (
        (channel = 'email' AND subject IS NOT NULL AND body_html IS NOT NULL)
        OR (channel = 'sms' AND subject IS NULL AND body_html IS NULL)
      ),
      CONSTRAINT chk_messages_status_fields CHECK (
        (status = 'queued' AND next_attempt_at IS NOT NULL AND payload_ciphertext IS NOT NULL
          AND sent_at IS NULL AND provider_message_id IS NULL)
        OR (status = 'sent' AND next_attempt_at IS NULL AND payload_ciphertext IS NULL
          AND sent_at IS NOT NULL AND provider_message_id IS NOT NULL AND attempts >= 1)
        OR (status = 'failed' AND next_attempt_at IS NULL AND payload_ciphertext IS NOT NULL
          AND sent_at IS NULL AND provider_message_id IS NULL AND last_error_code IS NOT NULL)
      ),
      CONSTRAINT chk_messages_last_error_code CHECK (last_error_code ~ '^[a-z0-9_]{1,64}$')
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE messages IS
      'Outbox and Message log of every email and SMS; one-time links redacted, parameters encrypted until sent (design 13.1).'
  `);
  await knex.raw(`
    COMMENT ON COLUMN messages.payload_ciphertext IS
      'Template parameters, AES-256-GCM with AAD messages:<id>; kept while queued or failed so a retry rebuilds the real link, NULL once sent. Never shown in the Message log.'
  `);

  const indexes: [string, string, string][] = [
    [
      'idx_messages_due',
      "(next_attempt_at, id) WHERE status = 'queued'",
      "The outbox drain claim: WHERE status = 'queued' AND next_attempt_at <= :now ORDER BY next_attempt_at, id LIMIT 10 FOR UPDATE SKIP LOCKED.",
    ],
    [
      'idx_messages_created_at',
      '(created_at DESC, id DESC)',
      'The Message log, newest first: ORDER BY created_at DESC, id DESC with a cursor (U2b).',
    ],
    [
      'idx_messages_related_customer_id',
      '(related_customer_id)',
      "A customer's messages: WHERE related_customer_id = :id, deleted on anonymisation (U15). Covers fk_messages_related_customer_id (U9).",
    ],
    [
      'idx_messages_related_staff_user_id',
      '(related_staff_user_id)',
      "A staff member's messages: WHERE related_staff_user_id = :id. Covers fk_messages_related_staff_user_id (U2).",
    ],
    [
      'idx_messages_related_booking_id',
      '(related_booking_id)',
      "A booking's messages: WHERE related_booking_id = :id. Covers fk_messages_related_booking_id (U10).",
    ],
  ];
  for (const [name, columns, comment] of indexes) {
    await knex.raw(`CREATE INDEX ${name} ON messages ${columns}`);
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE messages ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.messages', [schema]);
}
