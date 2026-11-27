import { expect } from 'expect';
import {
  App,
  AppBase,
  carryProfile,
  Component,
  ComponentBase,
  DefineVariable,
  ExtensionRegistry,
  materializeMetadataSilent,
  type Profile,
  slotClassVariables,
} from '../../src/index.js';

class ListenVariables {
  @DefineVariable()
  declare port?: number;
}

@Component({ className: 'SlotListen' })
class SlotListen extends ComponentBase {
  @Component.UseVariables(ListenVariables)
  declare values: ListenVariables;
}

class CaptureVariables {
  @DefineVariable()
  declare port?: number;

  @DefineVariable()
  declare filter?: string;
}

@Component({ className: 'SlotCapture' })
class SlotCapture extends ComponentBase {
  @Component.UseVariables(CaptureVariables)
  declare values: CaptureVariables;
}

@App({ className: 'SlotVarsApp' })
class SlotVarsApp extends AppBase {
  @App.UseComponent({
    oneOf: [SlotListen, SlotCapture],
    required: true,
    variables: { port: { default: 24000 } },
    variablesOf: { SlotCapture: { filter: { default: 'udp port 24000' } } },
  })
  declare mirror: SlotListen | SlotCapture;
}

describe("A slot's settings for the class put in it", () => {
  let end: () => void;

  before(async () => {
    end = ExtensionRegistry.use(new ExtensionRegistry());
    for (const cls of [SlotListen, SlotCapture, SlotVarsApp])
      await ExtensionRegistry.registerClass(cls as any);
  });

  after(() => end());

  const profile = (uri: string, values?: Record<string, any>): Profile =>
    ({
      id: 'w',
      displayName: 'W',
      appUri: SlotVarsApp.uri,
      writtenWith: '0.0.1',
      components: {
        mirror: { uri, writtenWith: '0.0.1', ...(values ? { values } : {}) },
      },
    }) as Profile;

  const slotOf = (uri: string) => {
    const r = materializeMetadataSilent(profile(uri) as any);
    expect(r.result).toBe(true);
    return (r as any).metadata.components.mirror;
  };

  it('should give each class what the slot overrides of its own, and its own alone', () => {
    const listen = slotOf(SlotListen.uri);
    expect(Object.keys(listen.variables)).toEqual(['port']);
    expect(listen.variables.port.default).toBe(24000);
    expect(listen.variablesOf).toBeUndefined();
    const capture = slotOf(SlotCapture.uri);
    expect(capture.variables.port.default).toBe(24000);
    expect(capture.variables.filter.default).toBe('udp port 24000');
  });

  it('should pass over an override of a setting the class does not define', () => {
    expect(
      slotClassVariables(
        { variables: { filter: { default: 'x' } } as any },
        SlotListen.uri,
        { port: { type: 'number' } } as any,
      ),
    ).toEqual({ port: { type: 'number' } });
  });

  it("should carry a profile by the class's own settings, as the slot gives them", () => {
    const { profile: carried } = carryProfile(
      profile(SlotListen.uri, { port: 1, filter: 'udp' }),
    );
    expect(carried.components?.mirror?.values).toEqual({ port: 1 });
  });

  it('should refuse a class name not of its oneOf', () => {
    expect(() => {
      class Wrong extends AppBase {
        @App.UseComponent({
          oneOf: [SlotListen, SlotCapture],
          variablesOf: { SlotOther: {} },
        } as any)
        declare mirror: SlotListen;
      }
      return Wrong;
    }).toThrow(/variablesOf names "SlotOther", not a class of its oneOf/);
  });
});
