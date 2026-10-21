import type { ExecutionContext } from '@nestjs/common';
import type { FakeContextOptions } from './types';

/**
 * A minimal `ExecutionContext` for unit tests of guards and interceptors: the context type,
 * the request and response, and the handler and class whose metadata the Reflector reads.
 */
export function fakeContext(options: FakeContextOptions = {}): ExecutionContext {
  const handler = options.handler ?? function handler(): void {};
  const controller = options.controller ?? class FakeController {};
  const request = options.request ?? { method: 'GET', headers: {} };
  const response = options.response ?? {};
  return {
    getType: () => options.type ?? 'http',
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    switchToWs: () => {
      throw new Error('not a WebSocket context');
    },
    switchToRpc: () => {
      throw new Error('not an RPC context');
    },
    getArgs: () => [request, response],
    getArgByIndex: (index: number) => [request, response][index],
  } as unknown as ExecutionContext;
}
