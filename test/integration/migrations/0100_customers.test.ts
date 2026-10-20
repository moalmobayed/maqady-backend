import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestApp } from '../../support/test-app';
import type { TestApp } from '../../support/types';

const HASH = 'scrypt$16384$8$5$c2FsdA$a2V5';
const AT = new Date('2026-10-20T10:00:00Z');
const UNKNOWN_CUSTOMER = 999_999;

/** The constraint a statement fails on, or null when it succeeds. Runs in a rolled-back savepoint. */
async function violation(knex: Knex, statement: (trx: Knex.Transaction) => Promise<unknown>) {
  const trx = await knex.transaction();
  try {
    await statement(trx);
    return null;
  } catch (error) {
    return (error as { constraint?: string }).constraint ?? String(error);
  } finally {
    await trx.rollback();
  }
}

function liveCustomer(overrides: Record<string, unknown> = {}) {
  return {
    email: `c-${randomUUID().slice(0, 8)}@example.com`,
    full_name: 'Layla Hassan',
    phone: null,
    password_hash: HASH,
    status: 'active',
    created_at: AT,
    updated_at: AT,
    ...overrides,
  };
}

/** U9 migrations 0100_01 and 0100_02 (design 6.2): what the database itself refuses. */
describe('customers migrations (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('refuses rows naming a customer that does not exist, by the named foreign keys', async () => {
    const { knex } = testApp;
    const statements: [string, (trx: Knex.Transaction) => Promise<unknown>][] = [
      [
        'fk_sessions_customer_id',
        (trx) =>
          trx('sessions').insert({
            family_id: randomUUID(),
            customer_id: UNKNOWN_CUSTOMER,
            token_hash: 'a'.repeat(64),
            created_at: AT,
            expires_at: new Date(AT.getTime() + 1000),
          }),
      ],
      [
        'fk_one_time_tokens_customer_id',
        (trx) =>
          trx('one_time_tokens').insert({
            purpose: 'verify_email',
            customer_id: UNKNOWN_CUSTOMER,
            token_hash: 'b'.repeat(64),
            created_at: AT,
            expires_at: new Date(AT.getTime() + 1000),
          }),
      ],
      [
        'fk_audit_events_actor_customer_id',
        (trx) =>
          trx('audit_events').insert({
            occurred_at: AT,
            actor_kind: 'customer',
            actor_customer_id: UNKNOWN_CUSTOMER,
            action: 'booking.claimed',
            entity_type: 'booking',
            changed_fields: [],
            metadata: {},
          }),
      ],
    ];
    for (const [constraint, statement] of statements) {
      expect(await violation(knex, statement)).toBe(constraint);
    }
    const [{ fk }] = (
      await knex.raw<{ rows: { fk: string }[] }>(
        `SELECT pg_get_constraintdef(oid) AS fk FROM pg_constraint
         WHERE conname = 'fk_messages_related_customer_id'`,
      )
    ).rows as [{ fk: string }];
    expect(fk).toBe('FOREIGN KEY (related_customer_id) REFERENCES customers(id)');
  });

  it('keeps one live account per email in any case, while an anonymised row frees it', async () => {
    const { knex } = testApp;
    await knex('customers').insert(liveCustomer({ email: 'dup@example.com' }));
    expect(
      await violation(knex, (trx) =>
        trx('customers').insert(liveCustomer({ email: 'DUP@example.com' })),
      ),
    ).toBe('uq_customers_email_live');

    await knex('customers').where({ email: 'dup@example.com' }).update({
      email: null,
      full_name: null,
      password_hash: null,
      deleted_at: AT,
    });
    expect(
      await violation(knex, (trx) =>
        trx('customers').insert(liveCustomer({ email: 'dup@example.com' })),
      ),
    ).toBeNull();
  });

  it('refuses a live row without its personal fields, an anonymised row with them, and bad values', async () => {
    const { knex } = testApp;
    const cases: [Record<string, unknown>, string][] = [
      [{ email: null }, 'chk_customers_live_or_anonymised'],
      [{ password_hash: null }, 'chk_customers_live_or_anonymised'],
      [{ deleted_at: AT }, 'chk_customers_live_or_anonymised'],
      [{ status: 'deleted' }, 'chk_customers_status'],
      [{ phone: '01012345678' }, 'chk_customers_phone'],
      [{ email: 'no-at-sign' }, 'chk_customers_email'],
      [{ full_name: '   ' }, 'chk_customers_full_name'],
      [{ password_hash: 'plain' }, 'chk_customers_password_hash'],
      [{ updated_at: new Date(AT.getTime() - 1) }, 'chk_customers_updated_at'],
    ];
    for (const [overrides, constraint] of cases) {
      expect(await violation(knex, (trx) => trx('customers').insert(liveCustomer(overrides)))).toBe(
        constraint,
      );
    }
    expect(
      await violation(knex, (trx) =>
        trx('customers').insert(liveCustomer({ phone: '+201012345678' })),
      ),
    ).toBeNull();
  });
});
