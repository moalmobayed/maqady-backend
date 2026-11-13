import { MIGRATIONS } from '../../../src/common/database/migration-list';
import { FACILITIES } from '../../../src/modules/theaters/enums';
import { createTestApp } from '../../support/test-app';
import type { TestApp } from '../../support/types';

/**
 * #29 P3 migrations 0290_21 and 0290_22 (docs/gh-29-theater-fields): the prayer room facility,
 * and the theaters' postal code and WhatsApp number.
 */
describe('theater fields migrations (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const constraint = async (table: string, name: string): Promise<string | undefined> => {
    const { rows } = await testApp.knex.raw<{ rows: { definition: string }[] }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = ?::regclass AND conname = ?`,
      [table, name],
    );
    return rows[0]?.definition;
  };

  it('is in the static migration list the deployment runs, after the rating score', () => {
    const names = MIGRATIONS.map((migration) => migration.name);
    expect(names.slice(names.indexOf('0290_11_add_movies_rating'))).toEqual(
      expect.arrayContaining([
        '0290_21_add_theater_facilities_prayer_room',
        '0290_22_add_theaters_postal_code_whatsapp',
      ]),
    );
    expect(names.indexOf('0290_22_add_theaters_postal_code_whatsapp')).toBe(
      names.indexOf('0290_21_add_theater_facilities_prayer_room') + 1,
    );
  });

  it('lets the facility CHECK take exactly the FACILITIES list, prayer_room included', async () => {
    const definition = await constraint('theater_facilities', 'chk_theater_facilities_facility');
    for (const facility of FACILITIES) expect(definition).toContain(`'${facility}'`);
    expect(definition).toContain("'prayer_room'");
    expect(definition?.match(/'[a-z_]+'::/g)).toHaveLength(FACILITIES.length);
  });

  it('adds the nullable postal code and WhatsApp columns with their CHECKs and comments', async () => {
    const { rows: columns } = await testApp.knex.raw<{
      rows: {
        column_name: string;
        data_type: string;
        character_maximum_length: number;
        is_nullable: string;
        column_default: null;
        comment: string | null;
      }[];
    }>(
      `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default,
              col_description('theaters'::regclass, ordinal_position) AS comment
       FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'theaters'
         AND column_name IN ('postal_code', 'whatsapp')
       ORDER BY column_name`,
    );
    expect(columns).toEqual([
      {
        column_name: 'postal_code',
        data_type: 'character varying',
        character_maximum_length: 10,
        is_nullable: 'YES',
        column_default: null,
        comment: expect.stringContaining('5 digits'),
      },
      {
        column_name: 'whatsapp',
        data_type: 'character varying',
        character_maximum_length: 16,
        is_nullable: 'YES',
        column_default: null,
        comment: expect.stringContaining('show_contacts_public'),
      },
    ]);
    expect(await constraint('theaters', 'chk_theaters_postal_code')).toContain('[0-9]{5}');
    expect(await constraint('theaters', 'chk_theaters_whatsapp')).toContain('[1-9][0-9]{6,14}');
  });
});
