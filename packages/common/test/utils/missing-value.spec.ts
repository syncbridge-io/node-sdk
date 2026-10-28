import { expect } from 'expect';
import {
  App,
  AppBase,
  Component,
  ComponentBase,
  decodeProfileSilent,
  DefineVariable,
  ExtensionRegistry,
  isMissingValue,
  type Profile,
} from '../../src/index.js';

class MissingValueVariables {
  @DefineVariable({ required: true })
  declare host: string;

  @DefineVariable()
  declare port?: number;
}

@Component({ className: 'MissingValueLink' })
class MissingValueLink extends ComponentBase {}

@App({ className: 'MissingValueApp' })
class MissingValueApp extends AppBase {
  @App.UseVariables(MissingValueVariables)
  declare values: MissingValueVariables;

  @App.UseComponent({ required: true })
  declare link: MissingValueLink;
}

describe('A value only its user can give', () => {
  let end: () => void;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    for (const cls of [MissingValueLink, MissingValueApp])
      await ExtensionRegistry.registerClass(cls as any);
  });

  after(() => end());

  const issuesOf = (profile: Partial<Profile>) =>
    (
      decodeProfileSilent({
        id: 'w',
        displayName: 'W',
        appUri: (MissingValueApp as any).uri,
        ...profile,
      } as Profile) as any
    ).issues as any[];

  it('should tell a required setting, and a required component, not given', () => {
    const component = issuesOf({ values: { host: 'h' } });
    expect(component.map(i => [i.location, isMissingValue(i)])).toEqual([
      ['components/link', true],
    ]);
    const setting = issuesOf({
      components: { link: { uri: (MissingValueLink as any).uri } },
    });
    expect(setting.map(i => [i.location, isMissingValue(i)])).toEqual([
      ['values/host', true],
    ]);
  });

  it('should not tell a value given wrong', () => {
    const wrong = issuesOf({
      values: { host: 'h', port: 'not a number' },
      components: { link: { uri: (MissingValueLink as any).uri } },
    });
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong.some(isMissingValue)).toBe(false);
  });
});
