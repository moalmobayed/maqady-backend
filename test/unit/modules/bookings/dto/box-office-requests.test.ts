import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateCounterPaymentRequest } from '../../../../../src/modules/bookings/dto/create-counter-payment.request';
import { ScanRequest } from '../../../../../src/modules/bookings/dto/scan.request';

/** Every failing path, dotted as the global filter reports it (`customer.fullName`). */
function paths(errors: readonly ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = `${prefix}${error.property}`;
    return error.children && error.children.length > 0 ? paths(error.children, `${path}.`) : [path];
  });
}

async function check<T extends object>(type: new () => T, body: Record<string, unknown>) {
  const instance = plainToInstance(type, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: paths(errors) };
}

describe('CreateCounterPaymentRequest', () => {
  it('accepts cash for a walk-in, and a trimmed receipt reference with the terminal', async () => {
    expect(
      (await check(CreateCounterPaymentRequest, { method: 'cash', customer: { kind: 'walk_in' } }))
        .fields,
    ).toEqual([]);
    const terminal = await check(CreateCounterPaymentRequest, {
      method: 'card_terminal',
      receiptReference: '  TRX 0042/817_a.b-c ',
      customer: { kind: 'walk_in' },
    });
    expect(terminal.fields).toEqual([]);
    expect(terminal.instance.receiptReference).toBe('TRX 0042/817_a.b-c');
  });

  it('normalises typed contact details', async () => {
    const { instance, fields } = await check(CreateCounterPaymentRequest, {
      method: 'cash',
      customer: {
        kind: 'contact',
        fullName: '  Karim Mostafa ',
        email: ' Karim@Example.COM ',
        phone: '01012345678',
      },
    });
    expect(fields).toEqual([]);
    expect(instance.customer).toMatchObject({
      fullName: 'Karim Mostafa',
      email: 'karim@example.com',
      phone: '+201012345678',
    });
    const minimal = await check(CreateCounterPaymentRequest, {
      method: 'cash',
      customer: { kind: 'contact', fullName: 'Karim', email: null, phone: null },
    });
    expect(minimal.fields).toEqual([]);
  });

  it.each([
    [{ method: 'cash', receiptReference: 'R1', customer: { kind: 'walk_in' } }, 'receiptReference'],
    [{ method: 'card_terminal', customer: { kind: 'walk_in' } }, 'receiptReference'],
    [
      { method: 'card_terminal', receiptReference: '', customer: { kind: 'walk_in' } },
      'receiptReference',
    ],
    [
      { method: 'card_terminal', receiptReference: 'x'.repeat(65), customer: { kind: 'walk_in' } },
      'receiptReference',
    ],
    [{ method: 'wallet', customer: { kind: 'walk_in' } }, 'method'],
    [{ method: 'cash', customer: { kind: 'guest' } }, 'customer.kind'],
    [{ method: 'cash', customer: { kind: 'existing', customerId: 0 } }, 'customer.customerId'],
    [
      { method: 'cash', customer: { kind: 'contact', customerId: 3, fullName: 'K' } },
      'customer.customerId',
    ],
    [
      { method: 'cash', customer: { kind: 'existing', customerId: 3, email: 'a@b.co' } },
      'customer.email',
    ],
    [{ method: 'cash', customer: { kind: 'contact', fullName: '   ' } }, 'customer.fullName'],
    [
      { method: 'cash', customer: { kind: 'contact', fullName: 'K', phone: '123' } },
      'customer.phone',
    ],
    [
      { method: 'cash', customer: { kind: 'contact', fullName: 'K', email: 'nope' } },
      'customer.email',
    ],
    [{ method: 'cash', customer: 'walk_in' }, 'customer'],
  ])('refuses %j on %s', async (body, field) => {
    expect((await check(CreateCounterPaymentRequest, body)).fields).toEqual([field]);
  });
});

describe('ScanRequest', () => {
  it('accepts a code, or a typed reference in any case with surrounding spaces', async () => {
    expect((await check(ScanRequest, { theaterId: 3, code: 'MQ1.MQ-7K3P9Q.1.x' })).fields).toEqual(
      [],
    );
    const typed = await check(ScanRequest, {
      theaterId: 3,
      reference: ' mq-7k3p9q ',
      confirm: true,
    });
    expect(typed.fields).toEqual([]);
    expect(typed.instance.reference).toBe('MQ-7K3P9Q');
  });

  it('reports a missing or doubled ticket once, on code', async () => {
    for (const body of [
      { theaterId: 3 },
      { theaterId: 3, code: 'MQ1.x', reference: 'MQ-7K3P9Q' },
    ]) {
      const instance = plainToInstance(ScanRequest, body);
      const errors = await validate(instance);
      expect(errors.map((error) => error.property)).toEqual(['code']);
      expect(Object.keys(errors[0]!.constraints!)).toHaveLength(1);
    }
  });

  it.each([
    [{ theaterId: 3, code: '' }, 'code'],
    [{ theaterId: 3, code: 'x'.repeat(513) }, 'code'],
    [{ theaterId: 3, code: 42 }, 'code'],
    [{ theaterId: 3, code: 'MQ1.x', confirm: true }, 'confirm'],
    [{ theaterId: 3, reference: 'MQ-0O1IL0' }, 'reference'],
    [{ theaterId: 3, reference: 'MQ-7K3P9Q', confirm: 'yes' }, 'confirm'],
    [{ theaterId: 0, code: 'MQ1.x' }, 'theaterId'],
  ])('refuses %j on %s', async (body, field) => {
    expect((await check(ScanRequest, body)).fields).toEqual([field]);
  });
});
