import { expect } from 'expect';
import { FixtureReader } from '../src/index.js';

const parse = (content: string | Buffer, options?: FixtureReader.Options) =>
  FixtureReader.parse(content, options);

describe('FixtureReader', () => {
  describe('a fixture file', () => {
    /* Relative to this file, wherever mocha runs from */
    const fixtures = new FixtureReader('_data/monitor.fixtures');

    it('should read the fixtures by name and by position', () => {
      expect(fixtures.length).toBe(4);
      expect(fixtures.names).toEqual(['oru-r01', 'pdu', 'ack']);
      expect(fixtures.get('pdu')).toEqual(
        Buffer.from([0, 1, 0, 0x2a, 0xe1, 0, 0, 2]),
      );
      expect(fixtures.at(1)).toEqual(fixtures.get('pdu'));
      expect(fixtures.has('ack')).toBe(true);
      expect(fixtures.has('nak')).toBe(false);
    });

    it("should give text content its eol, and keep the fixture's headers", () => {
      expect(fixtures.text('oru-r01')).toBe(
        'MSH|^~\\&|VSP|GE Healthcare|||20250827142700||ORU^R01|1|P|2.6\r' +
          'PID|||33426^^^PID^MR',
      );
      expect(fixtures.headers('oru-r01')).toEqual({
        name: 'oru-r01',
        eol: 'cr',
        note: 'as recorded at a site',
      });
    });

    it('should turn escapes into the characters they name', () => {
      expect(fixtures.text('ack')).toBe(
        '\x0bMSH|^~\\&|SB|||||20250101||ACK|1|P|2.6\rMSA|AA|1\r\x1c\r',
      );
    });

    it('should take anything but the boundary line as content, its last line break kept when there are two', () => {
      expect(fixtures.text(-1)).toBe(
        '<<not a header>> --sb-testing, and a line break kept at the end\n',
      );
      expect(fixtures.fixture(-1).headers).toEqual({});
    });

    it('should name the fixtures there are when one is not found', () => {
      expect(() => fixtures.get('nak')).toThrow(
        '"monitor.fixtures" has no fixture named "nak" (named: oru-r01, pdu, ack)',
      );
      expect(() => fixtures.at(9)).toThrow(/has no fixture at 9: it holds 4/);
    });

    it('should select and iterate the fixtures', () => {
      const named = fixtures.filter(f => !!f.name);
      expect(named.length).toBe(3);
      expect([...named].map(f => f.index)).toEqual([0, 1, 2]);
    });
  });

  it('should keep binary content byte for byte', () => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const file = Buffer.concat([
      Buffer.from('syncbridge-fixtures; boundary=b\n--b\n\n'),
      bytes,
      Buffer.from('\n--b--\n'),
    ]);
    expect(parse(file).at(0)).toEqual(bytes);
  });

  it('should read a file written with CRLF line breaks', () => {
    const fixtures = parse(
      'syncbridge-fixtures; boundary="x y"\r\n--x y\r\nname: a\r\n\r\nline 1\r\nline 2\r\n--x y--\r\n',
    );
    expect(fixtures.text('a')).toBe('line 1\r\nline 2');
  });

  it("should take the options as every fixture's defaults, its headers first", () => {
    const fixtures = parse(
      'syncbridge-fixtures; boundary=b\n' +
        '--b\n\n<SB>a\nb<EB>\n' +
        '--b\nescapes: false\neol: lf\n\n<SB>\n' +
        '--b--\n',
      {
        escapes: { '<SB>': 0x0b, '<EB>': '\x1c\r' },
        eol: 'cr',
      },
    );
    expect(fixtures.text(0)).toBe('\x0ba\rb\x1c\r');
    expect(fixtures.text(1)).toBe('<SB>');
  });

  it('should match escapes written another way', () => {
    const data = FixtureReader.decode('{STX}data{ETX}', {
      escapes: { '{STX}': 2, '{ETX}': 3 },
      escapePattern: /\{[A-Z]+\}/g,
    });
    expect(data).toEqual(Buffer.from('\x02data\x03', 'latin1'));
  });

  it('should take escapes by code, and refuse ones it does not know', () => {
    expect(FixtureReader.decode('<0x1C><CR>', { escapes: true })).toEqual(
      Buffer.from([0x1c, 0x0d]),
    );
    expect(() => FixtureReader.decode('<XYZ>', { escapes: true })).toThrow(
      /unknown escape <XYZ>/,
    );
  });

  it('should read base64 and hex split over lines', () => {
    const fixtures = parse(
      'syncbridge-fixtures; boundary=b\n' +
        '--b\nencoding: base64\n\nAAEC\nAw==\n' +
        '--b\nencoding: hex\n\n0001\n 02 03\n' +
        '--b--\n',
    );
    expect(fixtures.at(0)).toEqual(Buffer.from([0, 1, 2, 3]));
    expect(fixtures.at(1)).toEqual(Buffer.from([0, 1, 2, 3]));
  });

  describe('errors', () => {
    it('should want the declaration on the first line', () => {
      expect(() => parse('--b\n\ndata\n--b--\n')).toThrow(
        /fixtures:1: a fixture file starts with "syncbridge-fixtures; boundary=<boundary>"/,
      );
    });

    it('should want the fixtures closed', () => {
      expect(() =>
        parse('syncbridge-fixtures; boundary=b\n--b\n\ndata\n'),
      ).toThrow(/the fixtures are not closed with "--b--"/);
    });

    it("should tell where a fixture's headers do not end", () => {
      expect(() =>
        parse('syncbridge-fixtures; boundary=b\n--b\ndata\n--b--\n'),
      ).toThrow(/fixtures:3: a fixture's headers end with an empty line/);
    });

    it('should refuse a header line that is not one, and a name given twice', () => {
      expect(() =>
        parse(
          'syncbridge-fixtures; boundary=b\n--b\nname: a\nnot a header\n\nx\n--b--\n',
        ),
      ).toThrow(/fixtures:4: "not a header" is not a header/);
      expect(() =>
        parse(
          'syncbridge-fixtures; boundary=b\n--b\nname: a\n\nx\n--b\nname: a\n\ny\n--b--\n',
        ),
      ).toThrow(/fixtures:7: a fixture named "a" is already in the file/);
    });

    it('should refuse hex that is not', () => {
      expect(() =>
        parse(
          'syncbridge-fixtures; boundary=b\n--b\nencoding: hex\n\n0g 1\n--b--\n',
        ),
      ).toThrow(/fixtures:5: hex content is pairs of hex digits/);
    });

    it('should tell where a relative file name was looked for', () => {
      expect(() => new FixtureReader('_data/missing.fixtures')).toThrow(
        /Fixture file "_data\/missing.fixtures" not found \(.*test\/_data\/missing.fixtures\)/,
      );
    });
  });
});
