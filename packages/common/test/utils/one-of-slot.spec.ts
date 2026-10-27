import { expect } from 'expect';
import {
  App,
  AppBase,
  Component,
  ComponentBase,
  ExtensionRegistry,
  materializeMetadataSilent,
  slotInterfaces,
  slotTakes,
} from '../../src/index.js';

@Component({ className: 'OneOfClient' })
class OneOfClient extends ComponentBase {}

@Component({ className: 'OneOfServer' })
class OneOfServer extends ComponentBase {}

@Component({ className: 'OneOfOther' })
class OneOfOther extends ComponentBase {}

@App({ className: 'OneOfApp' })
class OneOfApp extends AppBase {
  @App.UseComponent({ oneOf: [OneOfClient, OneOfServer], required: true })
  declare link: OneOfClient | OneOfServer;
}

describe('A slot of one of several', () => {
  before(async () => {
    for (const cls of [OneOfClient, OneOfServer, OneOfOther, OneOfApp])
      await ExtensionRegistry.registerClass(cls as any);
  });

  const profile = (uri?: string) => ({
    id: 'w',
    displayName: 'W',
    appUri: OneOfApp.uri,
    components: uri ? { link: { uri } } : {},
  });

  it('should declare each, the first its interfaceUri', () => {
    const slot = ExtensionRegistry.getApp(OneOfApp.uri).metadata.components!
      .link;
    expect(slot).toMatchObject({
      interfaceUri: OneOfClient.uri,
      oneOf: [OneOfClient.uri, OneOfServer.uri],
      required: true,
    });
    expect(slotInterfaces(slot)).toEqual([OneOfClient.uri, OneOfServer.uri]);
    expect(slotInterfaces({ interfaceUri: 'p:X' })).toEqual(['p:X']);
    expect(slotTakes(slot, OneOfServer.uri, [])).toBe(true);
    expect(slotTakes(slot, 'p:Sub', [OneOfServer.uri])).toBe(true);
    expect(slotTakes(slot, OneOfOther.uri, [])).toBe(false);
  });

  it('should take a class of either, and refuse another', () => {
    for (const uri of [OneOfClient.uri, OneOfServer.uri]) {
      const r = materializeMetadataSilent(profile(uri) as any);
      expect(r.result).toBe(true);
      expect((r as any).metadata.components.link).toMatchObject({
        classUri: uri,
        oneOf: [OneOfClient.uri, OneOfServer.uri],
      });
    }
    const other = materializeMetadataSilent(profile(OneOfOther.uri) as any);
    expect(other.result).toBe(false);
    expect(other.issues![0].message).toMatch(
      new RegExp(`do not implement ${OneOfClient.uri} or ${OneOfServer.uri}`),
    );
  });

  it('should need one when required, telling its kinds while empty', () => {
    expect(materializeMetadataSilent(profile() as any).result).toBe(false);
    const r = materializeMetadataSilent(profile() as any, {
      returnUndefinedComponentsAsAbstract: true,
    });
    expect((r as any).metadata.components.link).toEqual({
      interfaceUri: OneOfClient.uri,
      oneOf: [OneOfClient.uri, OneOfServer.uri],
      required: true,
    });
  });
});
