import { KnexTimeoutError } from 'knex';
import {
  isConstraintConflict,
  isDatabaseUnavailableError,
  isPostgresError,
  isRetryableTransactionError,
} from '../../../../src/common/database/postgres-errors';
import { postgresError, socketError } from '../../../support/errors';

describe('isPostgresError', () => {
  it('recognises a driver DatabaseError by its SQLSTATE and severity', () => {
    expect(isPostgresError(postgresError({ code: '23505' }))).toBe(true);
  });

  it('rejects socket errors, even a five-letter code such as EPIPE', () => {
    expect(isPostgresError(socketError('EPIPE'))).toBe(false);
    expect(isPostgresError(socketError('ECONNREFUSED'))).toBe(false);
    expect(isPostgresError(new Error('plain'))).toBe(false);
    expect(isPostgresError({ code: '23505', severity: 'ERROR' })).toBe(false);
  });
});

describe('isConstraintConflict', () => {
  it.each(['23505', '23P01'])('is true for SQLSTATE %s', (code) => {
    expect(isConstraintConflict(postgresError({ code }))).toBe(true);
  });

  it.each(['23503', '23514', '42P01'])('is false for SQLSTATE %s', (code) => {
    expect(isConstraintConflict(postgresError({ code }))).toBe(false);
  });
});

describe('isDatabaseUnavailableError', () => {
  it.each([
    ['connection refused', socketError('ECONNREFUSED')],
    ['host not found', socketError('ENOTFOUND', 'getaddrinfo ENOTFOUND db.example.com')],
    ['connection reset', socketError('ECONNRESET', 'read ECONNRESET')],
    ['network unreachable', socketError('ENETUNREACH')],
    ['connect timeout (node-pg)', new Error('timeout expired')],
    ['dropped connection (node-pg)', new Error('Connection terminated unexpectedly')],
    ['pool timeout (Knex)', new KnexTimeoutError('Knex: Timeout acquiring a connection.')],
    ['connection failure, SQLSTATE class 08', postgresError({ code: '08006' })],
    ['admin shutdown', postgresError({ code: '57P01' })],
    ['crash shutdown', postgresError({ code: '57P02' })],
    ['starting up', postgresError({ code: '57P03' })],
    ['too many connections', postgresError({ code: '53300' })],
    [
      'every address refused (AggregateError)',
      new AggregateError([socketError('ECONNREFUSED'), socketError('ECONNREFUSED')], 'connect'),
    ],
    ['a wrapped cause', new Error('query failed', { cause: socketError('ECONNREFUSED') })],
  ])('is true for %s', (_label, error) => {
    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it.each([
    ['a unique violation', postgresError({ code: '23505' })],
    ['a query cancelled by statement_timeout', postgresError({ code: '57014' })],
    ['a syntax error', postgresError({ code: '42601' })],
    ['a programming error', new TypeError("Cannot read properties of undefined (reading 'id')")],
    ['a thrown string', 'ECONNREFUSED'],
    ['undefined', undefined],
  ])('is false for %s', (_label, error) => {
    expect(isDatabaseUnavailableError(error)).toBe(false);
  });

  it('stops following a cause chain that never ends', () => {
    const looped = new Error('a');
    Object.assign(looped, { cause: looped });
    expect(isDatabaseUnavailableError(looped)).toBe(false);
  });
});

describe('isRetryableTransactionError', () => {
  it.each(['40P01', '40001'])('is true for SQLSTATE %s, directly or as a cause', (code) => {
    expect(isRetryableTransactionError(postgresError({ code }))).toBe(true);
    const wrapped = new Error('wrapped', {
      cause: new Error('again', { cause: postgresError({ code }) }),
    });
    expect(isRetryableTransactionError(wrapped)).toBe(true);
  });

  it('is false for other failures', () => {
    expect(isRetryableTransactionError(postgresError({ code: '23505' }))).toBe(false);
    expect(isRetryableTransactionError(socketError('ECONNRESET'))).toBe(false);
    expect(isRetryableTransactionError({ code: '40P01', severity: 'ERROR' })).toBe(false);
  });
});
