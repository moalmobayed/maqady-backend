import { isUuid, resolveCorrelationId } from '../../../../src/common/logging/correlation-id';

describe('resolveCorrelationId', () => {
  it("keeps the client's UUID, lower-cased and trimmed", () => {
    expect(resolveCorrelationId(' 1B4E28BA-2FA1-11D2-883F-0016D3CCA427 ')).toBe(
      '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a UUID', 'request-42'],
    ['a UUID with extra text', '1b4e28ba-2fa1-11d2-883f-0016d3cca427; rm -rf /'],
    ['repeated headers', ['1b4e28ba-2fa1-11d2-883f-0016d3cca427']],
  ])('generates a fresh UUID when the header is %s', (_label, header) => {
    const id = resolveCorrelationId(header);
    expect(isUuid(id)).toBe(true);
    expect(id).not.toBe('1b4e28ba-2fa1-11d2-883f-0016d3cca427');
  });

  it('generates a different id for every request', () => {
    expect(resolveCorrelationId(undefined)).not.toBe(resolveCorrelationId(undefined));
  });
});
