import {
  containsPattern,
  customerListConditions,
  customerSearchOf,
} from '../../../../src/modules/customers/customer-search';

describe('customer search', () => {
  it('matches the trimmed text anywhere, with LIKE wildcards and the escape character literal', () => {
    expect(containsPattern('layla')).toBe('%layla%');
    expect(containsPattern('50%')).toBe('%50\\%%');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(containsPattern('back\\slash')).toBe('%back\\\\slash%');
    expect(customerSearchOf('  Layla  ')).toEqual({ pattern: '%Layla%', phonePattern: null });
  });

  it('also looks for the E.164 form of an Egyptian mobile typed locally', () => {
    expect(customerSearchOf('01012345678')).toEqual({
      pattern: '%01012345678%',
      phonePattern: '%+201012345678%',
    });
    expect(customerSearchOf('0101234567').phonePattern).toBeNull();
    expect(customerSearchOf('+201012345678').phonePattern).toBeNull();
  });

  it('builds no condition without filters', () => {
    expect(customerListConditions({})).toEqual([]);
  });

  it('searches the name, email (as text) and phone with every value bound', () => {
    expect(customerListConditions({ q: 'nadia' })).toEqual([
      {
        sql: '(full_name ILIKE ? OR email::text ILIKE ? OR phone ILIKE ?)',
        bindings: ['%nadia%', '%nadia%', '%nadia%'],
      },
    ]);
    expect(customerListConditions({ q: '01012345678', status: 'blocked' })).toEqual([
      {
        sql: '(full_name ILIKE ? OR email::text ILIKE ? OR phone ILIKE ? OR phone ILIKE ?)',
        bindings: ['%01012345678%', '%01012345678%', '%01012345678%', '%+201012345678%'],
      },
      { sql: 'status = ?', bindings: ['blocked'] },
    ]);
  });

  it('never puts the search text into the SQL itself', () => {
    const [condition] = customerListConditions({ q: "x' OR 1=1 --" });
    expect(condition!.sql).not.toContain('OR 1=1');
    expect(condition!.bindings).toContain("%x' OR 1=1 --%");
  });
});
