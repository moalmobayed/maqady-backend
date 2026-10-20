import type { INestApplicationContext } from '@nestjs/common';
import { MediaOrphansService } from './media-orphans.service';
import type { OrphanCommandOptions, OrphanPrefix } from './types';

/** `npm run media:orphans [-- --delete]`: listing is the default; removing needs the flag. */
export function parseOrphanArgs(argv: readonly string[]): OrphanCommandOptions {
  const unknown = argv.filter((arg) => arg !== '--delete');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument ${unknown[0]}; the only option is --delete`);
  }
  return { delete: argv.includes('--delete') };
}

/**
 * Lists the orphaned storage prefixes, one line each (`<prefix> <files> <bytes> <newest file>`),
 * the prefixes too recent to judge, the unknown paths and a summary; with `--delete`, removes
 * the orphans' files. Writes plain lines through `write`; returns nothing on success.
 */
export async function runMediaOrphans(
  app: INestApplicationContext,
  argv: readonly string[],
  write: (line: string) => void,
): Promise<void> {
  const options = parseOrphanArgs(argv);
  const service = app.get(MediaOrphansService, { strict: false });
  const report = await service.scan();

  for (const orphan of report.orphans) write(`orphan ${describe(orphan)}`);
  for (const orphan of report.recent)
    write(`recent ${describe(orphan)} (kept: under 60 minutes old)`);
  for (const path of report.unknownPaths) write(`unknown ${path} (kept: not an image path)`);
  write(
    `${report.orphans.length} orphaned prefix(es), ${report.recent.length} recent, ` +
      `${report.unknownPaths.length} unknown path(s), ${report.linkedPrefixes} linked.`,
  );

  if (!options.delete) {
    if (report.orphans.length > 0) write('Run with --delete to remove the orphaned prefixes.');
    return;
  }
  const removed = await service.remove(report.orphans);
  write(`Removed ${removed} file(s) of ${report.orphans.length} orphaned prefix(es).`);
}

function describe(orphan: OrphanPrefix): string {
  const bytes = orphan.bytes === null ? '?' : String(orphan.bytes);
  return `${orphan.prefix} ${orphan.paths.length} ${bytes} ${orphan.newestAt.toISOString()}`;
}
