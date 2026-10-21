import type { ApiHeaderOptions } from '@nestjs/swagger';

/** The `X-Hold-Token` header as the routes that read it document it (design §10.4). */
export function holdTokenHeader(required: boolean, purpose: string): ApiHeaderOptions {
  return {
    name: 'X-Hold-Token',
    required,
    description: `The guest's hold code, as \`holdCode\` returned it when the hold was made. ${purpose} A missing, malformed or wrong code matches no hold.`,
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  };
}
