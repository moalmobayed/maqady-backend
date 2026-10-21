import { AppError } from '../../../../src/common/errors/app-error';
import { serializeError } from '../../../../src/common/logging/error-serializer';
import { postgresError, socketError } from '../../../support/errors';

describe('serializeError', () => {
  it('keeps the name, message, code and stack of an ordinary error', () => {
    const serialized = serializeError(socketError('ECONNREFUSED'));
    expect(serialized).toMatchObject({
      type: 'Error',
      message: 'connect ECONNREFUSED 127.0.0.1:5432',
      code: 'ECONNREFUSED',
    });
    expect(serialized.stack).toContain('error-serializer.test.ts');
  });

  it("drops a Postgres error's message and detail, keeping SQLSTATE, constraint and frames", () => {
    const error = postgresError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_customers_email"',
      constraint: 'uq_customers_email',
      detail: 'Key (email)=(mona@example.com) already exists.',
    });
    // Knex prefixes the SQL to the message; with values it could carry personal data too.
    error.message = `insert into "customers" ("email") values ($1) - ${error.message}`;
    error.stack = `error: ${error.message}\n    at Parser.parseErrorMessage (pg-protocol/parser.js:1:1)`;

    const serialized = serializeError(error);
    expect(serialized).toEqual({
      type: 'DatabaseError',
      code: '23505',
      constraint: 'uq_customers_email',
      stack: '    at Parser.parseErrorMessage (pg-protocol/parser.js:1:1)',
    });
    expect(JSON.stringify(serialized)).not.toContain('mona@example.com');
    expect(JSON.stringify(serialized)).not.toContain('insert into');
  });

  it('serializes the cause chain, sanitizing each link', () => {
    const cause = postgresError({
      code: '57P01',
      message: 'terminating connection due to administrator command',
    });
    const serialized = serializeError(
      new AppError('SERVICE_UNAVAILABLE', undefined, null, { cause }),
    );
    expect(serialized).toMatchObject({
      type: 'AppError',
      message: 'The service is temporarily unavailable.',
      cause: { type: 'DatabaseError', code: '57P01' },
    });
    expect(serialized.cause).not.toHaveProperty('message');
  });

  it('stops after three levels of causes', () => {
    let error = new Error('level 0');
    for (let level = 1; level <= 6; level += 1)
      error = new Error(`level ${level}`, { cause: error });
    const serialized = serializeError(error);
    expect(serialized.cause?.cause?.cause).toMatchObject({ message: 'level 3' });
    expect(serialized.cause?.cause?.cause).not.toHaveProperty('cause');
  });

  it('reduces a thrown non-error to its type, since it could hold anything', () => {
    expect(serializeError('mona@example.com')).toEqual({ type: 'string' });
    expect(serializeError({ email: 'mona@example.com' })).toEqual({ type: 'object' });
    expect(serializeError(null)).toEqual({ type: 'null' });
  });
});
