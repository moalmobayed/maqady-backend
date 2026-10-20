import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): the roles shown on a person even without credits (design §6.2), one of the seven
 * credit roles (PRD call 8). They go with the person.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE person_roles (
      person_id BIGINT NOT NULL,
      role VARCHAR(20) NOT NULL,
      CONSTRAINT pk_person_roles PRIMARY KEY (person_id, role),
      CONSTRAINT fk_person_roles_person_id
        FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE,
      CONSTRAINT chk_person_roles_role CHECK (
        role IN ('actor', 'voice', 'director', 'writer', 'producer', 'cinematographer', 'composer')
      )
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE person_roles IS 'Roles an admin set on a person, shown even without credits (design 6.2).'",
  );
  await knex.raw('CREATE INDEX idx_person_roles_role_person_id ON person_roles (role, person_id)');

  const comments: [string, string][] = [
    [
      'pk_person_roles',
      'Roles of people: WHERE person_id IN (...). Covers fk_person_roles_person_id.',
    ],
    [
      'idx_person_roles_role_person_id',
      'People filtered by role group: WHERE role IN (...) (admin people list).',
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE person_roles ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.person_roles', [schema]);
}
