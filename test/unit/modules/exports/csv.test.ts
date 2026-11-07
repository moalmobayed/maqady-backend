import type { Readable } from 'node:stream';
import {
  csvCellOf,
  csvStream,
  decimalOf,
  escapeCsvCell,
  mapBatches,
} from '../../../../src/modules/exports/csv';
import type { CsvColumn } from '../../../../src/modules/exports/types';

interface Row {
  readonly name: string | null;
  readonly amount: number;
  readonly paid: boolean;
}

const COLUMNS: readonly CsvColumn<Row>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Amount', value: (row) => row.amount },
  { header: 'Paid', value: (row) => row.paid },
];

const BOM = String.fromCharCode(0xfeff);

async function textOf(stream: Readable): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += String(chunk);
  return text;
}

async function* batchesOf<T>(...batches: T[][]): AsyncGenerator<T[]> {
  for (const batch of batches) yield await Promise.resolve(batch);
}

describe('escapeCsvCell', () => {
  it.each([
    ['=HYPERLINK("http://evil.example","click")', '\'=HYPERLINK("http://evil.example","click")'],
    ['+201012345678', "'+201012345678"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', "'\r=1+1"],
  ])('prefixes %j, which starts with a formula trigger', (text, escaped) => {
    expect(escapeCsvCell(text)).toBe(escaped);
  });

  it.each(['Nadia Farouk', 'a=b', 'MQ-7K3P9Q', ' =1', '', "'quoted", '2026-10-16T19:30:00+03:00'])(
    'leaves %j unchanged',
    (text) => {
      expect(escapeCsvCell(text)).toBe(text);
    },
  );
});

describe('csvCellOf', () => {
  it('writes numbers as numbers, never escaped, a negative amount included', () => {
    expect(csvCellOf(-40)).toBe('-40');
    expect(csvCellOf(190.5)).toBe('190.5');
    expect(csvCellOf(0)).toBe('0');
  });

  it('writes yes / no, an empty cell for null, and escapes text', () => {
    expect(csvCellOf(true)).toBe('yes');
    expect(csvCellOf(false)).toBe('no');
    expect(csvCellOf(null)).toBe('');
    expect(csvCellOf('-1')).toBe("'-1");
  });
});

describe('decimalOf', () => {
  it('turns piastres into pounds', () => {
    expect([19000, 19050, 1999, 7, -4000, 0].map(decimalOf)).toEqual([
      190, 190.5, 19.99, 0.07, -40, 0,
    ]);
  });
});

describe('csvStream', () => {
  it('writes a BOM, the header row and every batch as CRLF records, quoting where needed', async () => {
    const stream = await csvStream(
      batchesOf(
        [
          { name: 'Nadia, Farouk', amount: 190, paid: true },
          { name: 'Say "hi"', amount: -40, paid: false },
        ],
        [
          { name: 'Two\nlines', amount: 0, paid: true },
          { name: 'One\rreturn', amount: 1, paid: true },
          { name: null, amount: 19.5, paid: false },
        ],
      ),
      COLUMNS,
    );
    expect(await textOf(stream)).toBe(
      `${BOM}Name,Amount,Paid\r\n` +
        '"Nadia, Farouk",190,yes\r\n' +
        '"Say ""hi""",-40,no\r\n' +
        '"Two\nlines",0,yes\r\n' +
        '"One\rreturn",1,yes\r\n' +
        ',19.5,no\r\n',
    );
  });

  it('escapes every dangerous cell, and quotes the ones that hold a line break', async () => {
    const names = ['=1+1', '+20101', '-1', '@x', '\tx', '\rx'];
    const stream = await csvStream(
      batchesOf(names.map((name) => ({ name, amount: 1, paid: true }))),
      COLUMNS,
    );
    expect(await textOf(stream)).toBe(
      `${BOM}Name,Amount,Paid\r\n` +
        "'=1+1,1,yes\r\n'+20101,1,yes\r\n'-1,1,yes\r\n'@x,1,yes\r\n'\tx,1,yes\r\n\"'\rx\",1,yes\r\n",
    );
  });

  it('escapes the header cells too', async () => {
    const stream = await csvStream(batchesOf<Row>(), [{ header: '=evil', value: () => null }]);
    expect(await textOf(stream)).toBe(`${BOM}'=evil\r\n`);
  });

  it('writes the header alone for an empty list, and takes a plain array of batches', async () => {
    expect(await textOf(await csvStream(batchesOf<Row>(), COLUMNS))).toBe(
      `${BOM}Name,Amount,Paid\r\n`,
    );
    expect(await textOf(await csvStream([[{ name: 'a', amount: 1, paid: true }]], COLUMNS))).toBe(
      `${BOM}Name,Amount,Paid\r\na,1,yes\r\n`,
    );
  });

  it('reads its source lazily: at most a couple of batches ahead of its consumer', async () => {
    const total = 10_000;
    let pulled = 0;
    async function* huge(): AsyncGenerator<Row[]> {
      for (let index = 0; index < total; index += 1) {
        pulled += 1;
        yield await Promise.resolve([{ name: `row ${index}`, amount: index, paid: true }]);
      }
    }
    const stream = await csvStream(huge(), COLUMNS);
    // The header and the first batch are read before the stream is handed over.
    expect(pulled).toBe(1);
    const first: unknown = await new Promise((resolve) => stream.once('data', resolve));
    stream.pause();
    await new Promise((resolve) => setImmediate(resolve));
    expect(String(first)).toBe(`${BOM}Name,Amount,Paid\r\nrow 0,0,yes\r\n`);
    expect(pulled).toBeLessThanOrEqual(3);

    // Reading on pulls the rest, every batch exactly once.
    stream.resume();
    let rest = '';
    for await (const chunk of stream) rest += String(chunk);
    expect(pulled).toBe(total);
    expect(rest.split('\r\n').filter((line) => line !== '')).toHaveLength(total - 1);
  });

  it('stops reading its source when the stream is destroyed', async () => {
    let pulled = 0;
    let closed = false;
    async function* endless(): AsyncGenerator<Row[]> {
      try {
        for (;;) {
          pulled += 1;
          yield await Promise.resolve([{ name: 'x', amount: 1, paid: true }]);
        }
      } finally {
        closed = true;
      }
    }
    const stream = await csvStream(endless(), COLUMNS);
    await new Promise((resolve) => stream.once('data', resolve));
    stream.destroy();
    await new Promise((resolve) => stream.once('close', resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const seen = pulled;
    expect(closed).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(pulled).toBe(seen);
  });

  it('fails as the request when the first batch fails', async () => {
    async function* failing(): AsyncGenerator<Row[]> {
      yield await Promise.reject(new Error('database down'));
    }
    await expect(csvStream(failing(), COLUMNS)).rejects.toThrow('database down');
  });

  it('destroys the stream with the error when a later batch fails', async () => {
    async function* failingLater(): AsyncGenerator<Row[]> {
      yield [{ name: 'a', amount: 1, paid: true }];
      yield await Promise.reject(new Error('connection lost'));
    }
    const stream = await csvStream(failingLater(), COLUMNS);
    await expect(textOf(stream)).rejects.toThrow('connection lost');
    expect(stream.destroyed).toBe(true);
  });
});

describe('mapBatches', () => {
  it('maps every row of every batch, batch by batch', async () => {
    const mapped: number[][] = [];
    for await (const batch of mapBatches(batchesOf([1, 2], [3]), (value) => value * 10)) {
      mapped.push([...batch]);
    }
    expect(mapped).toEqual([[10, 20], [30]]);
  });
});
