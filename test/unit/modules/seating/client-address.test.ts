import type { IncomingMessage } from 'node:http';
import { clientAddressOf } from '../../../../src/modules/seating/client-address';

function upgrade(
  headers: Record<string, string | string[]>,
  remoteAddress?: string,
): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe('clientAddressOf', () => {
  it('trusts one proxy hop: the rightmost X-Forwarded-For entry', () => {
    expect(
      clientAddressOf(upgrade({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2 , 3.3.3.3' }, '10.0.0.1')),
    ).toBe('3.3.3.3');
    expect(
      clientAddressOf(upgrade({ 'x-forwarded-for': ['1.1.1.1', '4.4.4.4'] }, '10.0.0.1')),
    ).toBe('4.4.4.4');
  });

  it('falls back to the socket address, then to a fixed bucket', () => {
    expect(clientAddressOf(upgrade({}, '::1'))).toBe('::1');
    expect(clientAddressOf(upgrade({ 'x-forwarded-for': ' , ' }, '10.0.0.2'))).toBe('10.0.0.2');
    expect(clientAddressOf(upgrade({}))).toBe('unknown');
  });
});
