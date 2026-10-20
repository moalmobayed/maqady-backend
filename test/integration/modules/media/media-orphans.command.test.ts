import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runMediaOrphans } from '../../../../src/modules/media/media-orphans.command';
import { TestClock } from '../../../support/clock';
import {
  REAL_RESOLVERS_OFF,
  TestPrincipalResolversModule,
} from '../../../support/foundations-probe.module';
import { jpeg } from '../../../support/media-fixtures';
import { MediaProbeModule } from '../../../support/media-probe.module';
import {
  mediaAdmin,
  mediaDirectory,
  removeMediaDirectory,
  storedFiles,
} from '../../../support/media';
import { createTestApp } from '../../../support/test-app';
import { buildTestConfig } from '../../../support/test-config';
import type { TestApp } from '../../../support/types';

describe('npm run media:orphans (integration, local storage)', () => {
  const clock = new TestClock();
  let testApp: TestApp;
  let directory: string;
  let linkedPrefix: string;
  const orphanPrefix = `gallery/${randomUUID()}`;
  const unknownPath = 'notes/readme.txt';

  const run = async (argv: string[]): Promise<string[]> => {
    const lines: string[] = [];
    await runMediaOrphans(testApp.app, argv, (line) => lines.push(line));
    return lines;
  };

  beforeAll(async () => {
    directory = await mediaDirectory();
    testApp = await createTestApp({
      clock,
      config: buildTestConfig({}, { LOCAL_STORAGE_DIR: directory }),
      imports: [MediaProbeModule, TestPrincipalResolversModule],
      overrides: REAL_RESOLVERS_OFF,
    });

    // One image with its row, one prefix whose row never committed, and a stray file.
    const { authorization } = await mediaAdmin(testApp);
    const uploaded = await testApp
      .http()
      .post('/api/v1/test-media/posters')
      .set('Authorization', authorization)
      .set('Idempotency-Key', randomUUID())
      .attach('file', await jpeg(1000, 1500), 'poster.jpg');
    expect(uploaded.status).toBe(201);
    linkedPrefix = ((await testApp.knex('images').pluck('storage_prefix')) as string[])[0]!;
    await mkdir(join(directory, ...orphanPrefix.split('/')), { recursive: true });
    for (const name of ['small', 'medium', 'large']) {
      await writeFile(join(directory, ...orphanPrefix.split('/'), `${name}.webp`), 'orphan');
    }
    await mkdir(join(directory, 'notes'), { recursive: true });
    await writeFile(join(directory, 'notes', 'readme.txt'), 'not an image');
  });

  afterAll(async () => {
    await testApp.close();
    await removeMediaDirectory(directory);
  });

  it('keeps an orphan younger than 60 minutes: it may be an upload in flight', async () => {
    clock.set(new Date());
    const lines = await run([]);
    expect(lines).toContainEqual(
      expect.stringMatching(new RegExp(`^recent ${orphanPrefix} 3 18 `)),
    );
    expect(lines).toContain('0 orphaned prefix(es), 1 recent, 1 unknown path(s), 1 linked.');
    expect(await storedFiles(directory)).toHaveLength(7);
  });

  it('lists an older orphan and keeps it without --delete', async () => {
    clock.advance({ minutes: 61 });
    const lines = await run([]);
    expect(lines).toEqual([
      expect.stringMatching(new RegExp(`^orphan ${orphanPrefix} 3 18 \\d{4}-`)),
      `unknown ${unknownPath} (kept: not an image path)`,
      '1 orphaned prefix(es), 0 recent, 1 unknown path(s), 1 linked.',
      'Run with --delete to remove the orphaned prefixes.',
    ]);
    expect(await storedFiles(directory)).toHaveLength(7);
  });

  it('with --delete removes only the orphan: the linked image and the unknown file stay', async () => {
    clock.advance({ minutes: 61 });
    const lines = await run(['--delete']);
    expect(lines.at(-1)).toBe('Removed 3 file(s) of 1 orphaned prefix(es).');
    expect(await storedFiles(directory)).toEqual(
      [
        `${linkedPrefix}/large.webp`,
        `${linkedPrefix}/medium.webp`,
        `${linkedPrefix}/small.webp`,
        unknownPath,
      ].sort(),
    );
    expect(await run([])).toContain(
      '0 orphaned prefix(es), 0 recent, 1 unknown path(s), 1 linked.',
    );
  });
});
