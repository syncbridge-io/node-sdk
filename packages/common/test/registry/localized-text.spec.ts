import { expect } from 'expect';
import {
  localizedTextProblems,
  slotTextProblems,
  textIn,
  variableTextProblems,
} from '../../src/index.js';

describe('Text by language', () => {
  it('should give the language asked for, else its base, else English, else the first', () => {
    const text = { en: 'Port', tr: 'Bağlantı noktası', pt: 'Porta' };
    expect(textIn(text, 'tr')).toBe('Bağlantı noktası');
    expect(textIn(text, 'pt-BR')).toBe('Porta');
    expect(textIn(text, 'de')).toBe('Port');
    expect(textIn({ tr: 'Yalnız' }, 'de')).toBe('Yalnız');
    /* A text alone: as it is, in whatever language asked */
    expect(textIn('Port', 'tr')).toBe('Port');
    expect(textIn(undefined, 'tr')).toBeUndefined();
  });

  it('should tell a key not a language, an empty text, and nothing for text alone', () => {
    expect(localizedTextProblems('Port', 'x')).toEqual([]);
    expect(localizedTextProblems(undefined, 'x')).toEqual([]);
    expect(localizedTextProblems({ en: 'Port', tr: 'Port' }, 'x')).toEqual([]);
    expect(localizedTextProblems({ english: 'Port', tr: ' ' }, 'x')).toEqual([
      'x is told in "english", not a language: en, tr, pt-BR...',
      'x in tr is empty',
    ]);
    expect(localizedTextProblems({}, 'x')).toEqual([
      "x is text, or text by language: { en: '...', tr: '...' }",
    ]);
    expect(localizedTextProblems(42, 'x')).toHaveLength(1);
  });

  it("should check settings' labels and descriptions, those in groups by their paths", () => {
    expect(
      variableTextProblems(
        {
          port: { label: { en: 'Port', tr: 'Port' }, description: 'The port' },
          tls: {
            label: 'TLS',
            variables: { cert: { description: { turkish: 'Sertifika' } } },
          },
        },
        'HttpServer',
      ),
    ).toEqual([
      `HttpServer's tls.cert description is told in "turkish", not a language: en, tr, pt-BR...`,
    ]);
  });

  it("should tell a slot's description wrong, a slot's within it too, by path", () => {
    expect(
      slotTextProblems(
        {
          client: { interfaceUri: 'p:C', description: { en: 'Client' } },
          server: {
            interfaceUri: 'p:S',
            description: 'Server',
            components: {
              tls: { interfaceUri: 'p:T', description: { turkish: 'x' } },
            },
          },
        },
        'Hl7App',
      ),
    ).toEqual([
      `Hl7App's server.tls component description is told in "turkish", not a language: en, tr, pt-BR...`,
    ]);
  });
});
