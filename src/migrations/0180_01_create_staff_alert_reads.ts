import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U17 (#18): the bell's read state (design §6.2 `staff_alert_reads`, §13.3 "Alerts"). Alerts are
 * computed on read, each with a stable key (`failed-payments:<date>:<count>`,
 * `low-sales:<showtimeId>`, `hall-gap:<hallId>:<date>`); a row here says that one staff member has
 * seen one key. The unread count is the number of current keys with no row for the caller.
 *
 * - One row per staff member and key (the primary key), so marking a key twice keeps the first
 *   `seen_at` (`ON CONFLICT DO NOTHING`).
 * - `alert_key` is at most 200 characters of the key alphabet; keys are built by the service.
 * - No defaults: `seen_at` comes from the service's `Clock`.
 * - Staff accounts are deactivated, never deleted, so the foreign key has no `ON DELETE`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE staff_alert_reads (
      staff_user_id BIGINT NOT NULL,
      alert_key VARCHAR(200) NOT NULL,
      seen_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT pk_staff_alert_reads PRIMARY KEY (staff_user_id, alert_key),
      CONSTRAINT fk_staff_alert_reads_staff_user_id
        FOREIGN KEY (staff_user_id) REFERENCES staff_users (id),
      CONSTRAINT chk_staff_alert_reads_alert_key CHECK (alert_key ~ '^[a-z0-9:-]{1,200}$')
    )
  `);
  await knex.raw(`
    COMMENT ON TABLE staff_alert_reads IS
      'The bell read state: which current alert keys each staff member has seen (design 6.2, 13.3).'
  `);
  const comments: [name: string, comment: string][] = [
    [
      'pk_staff_alert_reads',
      "Covers fk_staff_alert_reads_staff_user_id. A staff member's reads of the current keys: WHERE staff_user_id = ? AND alert_key = ANY(?) (GET /admin/alerts, POST /admin/alert-reads); the insert's ON CONFLICT (staff_user_id, alert_key); the tidy-up WHERE staff_user_id = ? AND seen_at < ? (POST /admin/alert-reads).",
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE staff_alert_reads ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.staff_alert_reads', [schema]);
}
