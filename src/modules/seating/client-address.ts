import type { IncomingMessage } from 'node:http';

/**
 * The client address of a WebSocket upgrade, as Express reads it for HTTP with
 * `trust proxy 1` (design §10.6): the rightmost `X-Forwarded-For` entry (what the one trusted
 * proxy, Render's, saw), else the socket's own address.
 */
export function clientAddressOf(request: IncomingMessage): string {
  const header = request.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header.join(',') : header;
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.at(-1) ?? request.socket.remoteAddress ?? 'unknown';
}
