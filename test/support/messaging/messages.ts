import type { Knex } from 'knex';
import type { StoredMessage } from '../types';

const COLUMNS = [
  'id',
  'channel',
  'template',
  'recipient',
  'subject',
  'body_text',
  'body_html',
  'status',
  'attempts',
  'last_error_code',
  'next_attempt_at',
  'payload_ciphertext',
  'provider_message_id',
  'sent_at',
  'related_customer_id',
  'related_staff_user_id',
  'related_booking_id',
  'created_at',
  'updated_at',
] as const;

/** Every stored message, in id order, read straight from the table. */
export async function readMessages(knex: Knex): Promise<StoredMessage[]> {
  return knex('messages')
    .select<StoredMessage[]>(...COLUMNS)
    .orderBy('id');
}

/** One stored message; fails the test when it does not exist. */
export async function readMessage(knex: Knex, id: number): Promise<StoredMessage> {
  const row = await knex('messages')
    .select<StoredMessage[]>(...COLUMNS)
    .where({ id })
    .first();
  if (!row) throw new Error(`message ${id} does not exist`);
  return row;
}
