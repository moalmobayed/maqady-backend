import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import request from 'supertest';
import { ExportsController } from '../../../../src/modules/exports/exports.controller';
import { ExportsService } from '../../../../src/modules/exports/exports.service';
import type { ExportFile } from '../../../../src/modules/exports/types';

/**
 * The download over real HTTP (Express), the export service mocked: what the client sees and what
 * is logged when the file fails after its first byte (the database lost mid-file).
 */
describe('ExportsController (download)', () => {
  let app: INestApplication;
  const exportsService = { bookings: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [{ provide: ExportsService, useValue: exportsService }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function fileOf(stream: Readable): ExportFile {
    return { filename: 'maqady-bookings-2026-10-11.csv', stream };
  }

  it('cuts the connection and logs the failure, by code only, when a later batch fails', async () => {
    const failure = Object.assign(new Error('Connection terminated'), { code: 'ECONNRESET' });
    exportsService.bookings.mockResolvedValue(
      fileOf(
        Readable.from(
          (async function* () {
            yield '﻿Reference\r\nMQ-AAAAAA\r\n';
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw failure;
          })(),
          { objectMode: true, highWaterMark: 1 },
        ),
      ),
    );
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const outcome = await request(app.getHttpServer())
      .get('/admin/exports/bookings.csv')
      .then(
        () => 'complete',
        (error: Error) => error.message,
      );

    // The client never sees a short file that looks complete.
    expect(outcome).not.toBe('complete');
    // The failure is on record, with the error object for the log-safe serializer.
    expect(logged).toHaveBeenCalledWith(
      { err: failure },
      'A CSV export failed after its first byte',
    );
  });

  it('sends the whole file and logs nothing when every batch is read', async () => {
    exportsService.bookings.mockResolvedValue(
      fileOf(Readable.from(['﻿Reference\r\n', 'MQ-AAAAAA\r\n'], { objectMode: true })),
    );
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const response = await request(app.getHttpServer()).get('/admin/exports/bookings.csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.text).toBe('﻿Reference\r\nMQ-AAAAAA\r\n');
    expect(logged).not.toHaveBeenCalled();
  });
});
