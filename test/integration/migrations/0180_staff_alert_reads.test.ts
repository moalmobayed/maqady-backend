import { MIGRATIONS } from '../../../src/common/database/migration-list';
import { createStaffMember } from '../../support/staff-auth';
import { createTestApp } from '../../support/test-app';
import type { TestApp } from '../../support/types';

/** U17 migration 0180_01 (design §6.2, §13.3): the bell's read state. */
describe('staff alert reads migration (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('is in the static migration list the deployment runs', () => {
    expect(MIGRATIONS.map((migration) => migration.name)).toContain(
      '0180_01_create_staff_alert_reads',
    );
  });

  it('creates the table with its keys, row-level security and a commented primary key', async () => {
    const { rows: columns } = await testApp.knex.raw<{
      rows: { column_name: string; data_type: string; is_nullable: string; column_default: null }[];
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'staff_alert_reads'
       ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      {
        column_name: 'staff_user_id',
        data_type: 'bigint',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'alert_key',
        data_type: 'character varying',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'seen_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        column_default: null,
      },
    ]);
    const { rows: constraints } = await testApp.knex.raw<{
      rows: { conname: string; definition: string }[];
    }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'staff_alert_reads'::regclass ORDER BY conname`,
    );
    expect(constraints.map((row) => row.conname)).toEqual([
      'chk_staff_alert_reads_alert_key',
      'fk_staff_alert_reads_staff_user_id',
      'pk_staff_alert_reads',
    ]);
    expect(constraints[2]!.definition).toBe('PRIMARY KEY (staff_user_id, alert_key)');
    const { rows: tables } = await testApp.knex.raw<{ rows: { relrowsecurity: boolean }[] }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'staff_alert_reads'::regclass",
    );
    expect(tables[0]!.relrowsecurity).toBe(true);
    const { rows: comments } = await testApp.knex.raw<{ rows: { comment: string | null }[] }>(
      "SELECT obj_description('pk_staff_alert_reads'::regclass) AS comment",
    );
    expect(comments[0]!.comment).toMatch(
      /Covers fk_staff_alert_reads_staff_user_id.*GET \/admin\/alerts/,
    );
  });

  it('keeps one row per staff member and key, and refuses a key outside the alphabet', async () => {
    const member = await createStaffMember(testApp, { role: 'box_office' });
    const row = { staff_user_id: member.id, alert_key: 'low-sales:81', seen_at: new Date() };
    await testApp.knex('staff_alert_reads').insert(row);
    await expect(testApp.knex('staff_alert_reads').insert(row)).rejects.toMatchObject({
      constraint: 'pk_staff_alert_reads',
    });
    await expect(
      testApp.knex('staff_alert_reads').insert({ ...row, alert_key: "Low Sales'; --" }),
    ).rejects.toMatchObject({ constraint: 'chk_staff_alert_reads_alert_key' });
    await expect(
      testApp.knex('staff_alert_reads').insert({ ...row, staff_user_id: 999999 }),
    ).rejects.toMatchObject({ constraint: 'fk_staff_alert_reads_staff_user_id' });
  });
});
