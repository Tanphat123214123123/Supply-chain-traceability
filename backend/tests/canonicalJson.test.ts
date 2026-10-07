import { canonicalize } from '../src/ledger/canonicalJson';

// Test vectors are built from code points rather than escaped literals, so
// no editor or tool can silently "unescape" them.
const ch = (...codes: number[]) => String.fromCharCode(...codes);
const BS = ch(0x5c);

describe('canonicalize (RFC 8785 / JCS)', () => {
  it('matches the RFC 8785 §3.2.4 reference output (numbers, string escaping, literals, key order)', () => {
    // € $ U+000F LF A ' B " BS BS " /
    const str = ch(0x20ac, 0x24, 0x0f, 0x0a, 0x41, 0x27, 0x42, 0x22, 0x5c, 0x5c, 0x22, 0x2f);
    const input = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: str,
      literals: [null, true, false],
    };
    const expectedString = `"${ch(0x20ac)}$${BS}u000f${BS}nA'B${BS}"${BS}${BS}${BS}${BS}${BS}"/"`;
    const expected = `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":${expectedString}}`;
    expect(canonicalize(input)).toBe(expected);
  });

  it('sorts keys by UTF-16 code units (RFC 8785 §3.2.3 example)', () => {
    const euro = ch(0x20ac);
    const cr = ch(0x0d);
    const dalet = ch(0xfb33);
    const emoji = ch(0xd83d, 0xde00);
    const control = ch(0x0080);
    const oUmlaut = ch(0x00f6);
    const input: Record<string, string> = {
      [euro]: 'Euro Sign',
      [cr]: 'Carriage Return',
      [dalet]: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      [emoji]: 'Emoji: Grinning Face',
      [control]: 'Control',
      [oUmlaut]: 'Latin Small Letter O With Diaeresis',
    };
    // A surrogate pair (0xD83D...) sorts before U+FB33 by UTF-16 code unit — not by code point.
    const order = [cr, '1', control, oUmlaut, euro, emoji, dalet];
    const expected = `{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(input[k])}`).join(',')}}`;
    expect(canonicalize(input)).toBe(expected);
  });

  it('is independent of insertion order, recursively', () => {
    const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } };
    const b = { a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it('omits undefined object members and normalises -0', () => {
    expect(canonicalize({ a: undefined, b: -0 })).toBe('{"b":0}');
  });

  it('rejects values JSON cannot represent unambiguously', () => {
    expect(() => canonicalize({ n: NaN })).toThrow(TypeError);
    expect(() => canonicalize({ n: Infinity })).toThrow(TypeError);
    expect(() => canonicalize({ d: new Date() })).toThrow(TypeError);
    expect(() => canonicalize({ m: new Map() })).toThrow(TypeError);
    expect(() => canonicalize({ f: () => 1 })).toThrow(TypeError);
  });
});
