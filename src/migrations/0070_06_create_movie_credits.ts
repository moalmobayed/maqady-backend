import type { Knex } from 'knex';
import type { MigrationContext } from '../common/database/types';

/**
 * U6 (#7): cast and crew (design §6.2, PRD A2): one row per person and role on a movie, in the
 * movie's display order. Only actors and voices have a character name. A credit goes with its
 * movie and with its person (design §9 "deleting a person removes their credits").
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE movie_credits (
      id BIGSERIAL PRIMARY KEY,
      movie_id BIGINT NOT NULL,
      person_id BIGINT NOT NULL,
      role VARCHAR(20) NOT NULL,
      character_name VARCHAR(120) NULL,
      sort_order SMALLINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      CONSTRAINT fk_movie_credits_movie_id
        FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
      CONSTRAINT fk_movie_credits_person_id
        FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE,
      CONSTRAINT chk_movie_credits_role CHECK (
        role IN ('actor', 'voice', 'director', 'writer', 'producer', 'cinematographer', 'composer')
      ),
      CONSTRAINT chk_movie_credits_character_name CHECK (
        character_name IS NULL
        OR (
          role IN ('actor', 'voice')
          AND btrim(character_name) = character_name
          AND length(character_name) >= 1
        )
      ),
      CONSTRAINT chk_movie_credits_sort_order CHECK (sort_order BETWEEN 0 AND 199),
      CONSTRAINT uq_movie_credits_movie_id_person_id_role UNIQUE (movie_id, person_id, role)
    )
  `);
  await knex.raw(
    "COMMENT ON TABLE movie_credits IS 'Cast and crew of movies, in display order (design 6.2).'",
  );
  await knex.raw(
    'CREATE INDEX idx_movie_credits_movie_id_sort_order ON movie_credits (movie_id, sort_order, id)',
  );
  await knex.raw(
    'CREATE INDEX idx_movie_credits_person_id_movie_id ON movie_credits (person_id, movie_id)',
  );

  const comments: [string, string][] = [
    [
      'uq_movie_credits_movie_id_person_id_role',
      'One credit per person and role on a movie (design 6.2). Covers fk_movie_credits_movie_id.',
    ],
    [
      'idx_movie_credits_movie_id_sort_order',
      'Credits of movies in display order: WHERE movie_id IN (...) ORDER BY movie_id, sort_order, id.',
    ],
    [
      'idx_movie_credits_person_id_movie_id',
      "A person's filmography and the cast filter: WHERE person_id IN (...); the movies a person is credited on. Covers fk_movie_credits_person_id.",
    ],
  ];
  for (const [name, comment] of comments) {
    // COMMENT takes no bind parameters, so the literal is quoted here (constant text only).
    await knex.raw(`COMMENT ON INDEX ${name} IS '${comment.replace(/'/g, "''")}'`);
  }
  await knex.raw('ALTER TABLE movie_credits ENABLE ROW LEVEL SECURITY');
}

export async function down(knex: Knex, { schema }: MigrationContext): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS ??.movie_credits', [schema]);
}
