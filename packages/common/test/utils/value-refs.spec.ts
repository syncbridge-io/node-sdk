import { expect } from 'expect';
import {
  App,
  AppBase,
  decodeProfile,
  DefineVariable,
  encodeProfile,
  ExtensionRegistry,
  formatValueRef,
  hasValueRef,
  hostVariable,
  parseValueRefs,
  profileValueRefs,
  resolveValueRefs,
  resolveValueText,
  VariableFormat,
  VariableType,
} from '../../src/index.js';

class RefVariables {
  @DefineVariable({ format: VariableFormat.Url, required: true })
  declare url: string;

  @DefineVariable({ type: VariableType.Number, minValue: 1 })
  declare port?: number;

  @DefineVariable({ type: VariableType.String, isArray: true })
  declare hosts?: string[];

  @DefineVariable({ type: VariableType.Secret })
  declare password?: string;
}

@App({ displayName: 'Refs' })
class RefApp extends AppBase {
  @App.UseVariables(RefVariables)
  declare values: RefVariables;
}

const VARS: Record<string, string> = {
  HBYS_URL: 'https://hbys.example',
  PORT: '8080',
  EDGE: 'edge-1',
};
const lookup = (kind: string, name: string) =>
  kind === 'vars' ? VARS[name] : undefined;

describe('value references', () => {
  before(async () => {
    await ExtensionRegistry.registerClass(RefApp);
  });

  const profile = (values: Record<string, any>, components?: any): any => ({
    id: 'refs',
    displayName: 'Refs',
    appUri: (RefApp as any).uri,
    values,
    ...(components ? { components } : {}),
  });

  it('should read the references of a text, spaces inside the braces or not', () => {
    expect(
      parseValueRefs(
        '${{ vars.HBYS_URL }}/api/${{vars.PORT}}${{  secrets.DB  }}',
      ),
    ).toEqual({
      refs: [
        { kind: 'vars', name: 'HBYS_URL' },
        { kind: 'vars', name: 'PORT' },
        { kind: 'secrets', name: 'DB' },
      ],
      errors: [],
    });
    expect(formatValueRef('vars', 'X')).toBe('${{ vars.X }}');
    expect(hasValueRef('plain')).toBe(false);
    expect(hasValueRef(8)).toBe(false);
    expect(hasValueRef('a ${{ vars.X }}')).toBe(true);
  });

  it('should tell an expression that is not a reference, not keep it as text', () => {
    const { refs, errors } = parseValueRefs(
      '${{ env.X }} ${{ vars.lower }} ${{ vars.X',
    );
    expect(refs).toEqual([]);
    expect(errors).toEqual([
      expect.stringMatching(/"\$\{\{ env\.X \}\}" is not a reference/),
      expect.stringMatching(/"\$\{\{ vars\.lower \}\}" is not a reference/),
      expect.stringMatching(/"\$\{\{ vars\.X" is not closed with "\}\}"/),
    ]);
  });

  it('should resolve a text, "$${{" written as "${{", and tell what it does not find', () => {
    expect(
      resolveValueText(
        '${{ vars.HBYS_URL }}:${{ vars.PORT }}/$${{ x }}',
        lookup,
      ),
    ).toEqual({
      value: 'https://hbys.example:8080/${{ x }}',
      missing: [],
      errors: [],
    });
    expect(
      resolveValueText('${{ vars.NONE }}-${{ secrets.DB }}', lookup),
    ).toEqual({
      value: '-',
      missing: ['vars.NONE', 'secrets.DB'],
      errors: [],
    });
  });

  it("should resolve a profile's values alone - the app's, the components' down, arrays and objects - leaving the profile given as it was", () => {
    const given = profile(
      {
        url: '${{ vars.HBYS_URL }}/api',
        port: '${{ vars.PORT }}',
        hosts: ['${{ vars.EDGE }}', 'b'],
      },
      {
        server: {
          uri: 'x:Server',
          values: { nested: { at: '${{ vars.NONE }}' } },
          components: {
            inner: { uri: 'x:Inner', values: { bad: '${{ env.X }}' } },
          },
        },
      },
    );
    given.displayName = '${{ vars.EDGE }}';
    const r = resolveValueRefs(given, lookup);
    expect(r.profile.values).toEqual({
      url: 'https://hbys.example/api',
      port: '8080',
      hosts: ['edge-1', 'b'],
    });
    expect(r.profile.displayName).toBe('${{ vars.EDGE }}');
    expect(r.profile.components.server.values.nested.at).toBe('');
    expect(r.missing).toEqual(['vars.NONE']);
    expect(r.errors).toEqual([
      expect.stringMatching(
        /^components\/server\/components\/inner\/values\/bad: "\$\{\{ env\.X \}\}" is not a reference/,
      ),
    ]);
    expect(given.values.url).toBe('${{ vars.HBYS_URL }}/api');
  });

  it('should tell the names a profile uses, qualified, each once', () => {
    expect(
      profileValueRefs(
        profile(
          { url: '${{ vars.HBYS_URL }}', hosts: ['${{ vars.HBYS_URL }}'] },
          {
            server: {
              uri: 'x:Server',
              values: { password: '${{ secrets.DB }}' },
            },
          },
        ),
      ),
    ).toEqual(['secrets.DB', 'vars.HBYS_URL']);
  });

  it('should check a resolved value as any value: a number taken from text, a URL still a URL', () => {
    const resolved = resolveValueRefs(
      profile({ url: '${{ vars.HBYS_URL }}', port: '${{ vars.PORT }}' }),
      lookup,
    ).profile;
    expect(decodeProfile(resolved).values).toMatchObject({
      url: 'https://hbys.example',
      port: 8080,
    });
    const notUrl = resolveValueRefs(
      profile({ url: '${{ vars.EDGE }}' }),
      lookup,
    ).profile;
    expect(() => decodeProfile(notUrl)).toThrow(/url/i);
  });

  it('should keep a value holding a reference unchecked when told the profile is not resolved, of any type, encoded too', () => {
    const raw = profile({
      url: '${{ vars.HBYS_URL }}',
      port: '${{ vars.PORT }}',
      hosts: ['${{ vars.EDGE }}'],
      password: '${{ secrets.DB }}',
    });
    expect(() => decodeProfile(raw)).toThrow();
    expect(decodeProfile(raw, { unresolved: true }).values).toEqual(raw.values);
    expect(
      encodeProfile(raw, {
        unresolved: true,
        cryptoSecretKey: 'k'.repeat(32),
      }).values,
    ).toEqual(raw.values);
    /* A value without one is checked as before */
    expect(() =>
      decodeProfile(profile({ url: 'not a url' }), { unresolved: true }),
    ).toThrow(/url/i);
  });

  it("should take a host's own variable over its workspace's", () => {
    const vars = { workspace: { A: 'w', B: 'w' }, host: { A: 'h', C: '' } };
    expect(hostVariable(vars, 'A')).toBe('h');
    expect(hostVariable(vars, 'B')).toBe('w');
    expect(hostVariable(vars, 'C')).toBe('');
    expect(hostVariable(vars, 'D')).toBeUndefined();
    expect(hostVariable(undefined, 'A')).toBeUndefined();
  });
});
