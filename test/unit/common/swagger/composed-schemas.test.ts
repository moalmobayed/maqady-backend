import {
  defineComposedSchema,
  listComposedSchemas,
} from '../../../../src/common/swagger/composed-schemas';

describe('defineComposedSchema', () => {
  it('registers the schema under its name and returns its $ref', () => {
    const ref = defineComposedSchema('TestComposed', {
      allOf: [{ $ref: '#/components/schemas/A' }],
    });
    expect(ref).toBe('#/components/schemas/TestComposed');
    expect(listComposedSchemas().get('TestComposed')).toEqual({
      allOf: [{ $ref: '#/components/schemas/A' }],
    });
  });

  it('accepts the same name again with the same shape, and refuses another shape', () => {
    defineComposedSchema('TestTwice', { type: 'object' });
    expect(() => defineComposedSchema('TestTwice', { type: 'object' })).not.toThrow();
    expect(() => defineComposedSchema('TestTwice', { type: 'string' })).toThrow(
      'Composed schema "TestTwice" is already defined with another shape',
    );
  });
});
