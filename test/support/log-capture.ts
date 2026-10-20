import type { LogCapture } from './types';

/** A pino destination that keeps every line in memory, for asserting on what was logged. */
export function createLogCapture(): LogCapture {
  const lines: string[] = [];
  return {
    stream: {
      write(chunk: string): void {
        lines.push(...chunk.split('\n').filter((line) => line.trim() !== ''));
      },
    },
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => lines.join('\n'),
  };
}
