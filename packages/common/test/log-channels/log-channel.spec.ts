import { expect } from 'expect';
import {
  App,
  AppBase,
  AppFactory,
  Component,
  ComponentBase,
  decodeProfileSilent,
  ExtensionRegistry,
  LogChannel,
  type Profile,
} from '../../src/index.js';

@Component({ displayName: 'Channel component' })
class ChannelComponent extends ComponentBase {
  @LogChannel({
    name: 'communication',
    kind: 'transmit',
    title: 'Device',
    events: ['connect', 'disconnect', 'read', 'write'],
  })
  declare readonly ioLogChannel: LogChannel;
}

@App({ displayName: 'Channel app' })
class ChannelApp extends AppBase {
  @LogChannel({ level: 'warn' })
  declare readonly audit: LogChannel;

  @App.UseComponent({ required: true })
  declare readonly device: ChannelComponent;
}

describe('LogChannel', () => {
  const written: [string, LogChannel.Entry][] = [];
  const logSink: LogChannel.Sink = (channel, entry) =>
    written.push([channel, entry]);

  before(async () => {
    await ExtensionRegistry.registerClass(ChannelComponent);
    await ExtensionRegistry.registerClass(ChannelApp);
  });

  beforeEach(() => (written.length = 0));

  const profile = (settings?: any): Profile =>
    ({
      id: 'p1',
      displayName: 'Channels',
      appUri: ChannelApp.uri,
      settings,
      components: {
        device: { uri: ChannelComponent.uri, settings: undefined },
      },
    }) as any;

  it('should be in the metadata, its name defaulting to the property', () => {
    const prc = ExtensionRegistry.getApp(ChannelApp.uri);
    expect(prc.metadata.logChannels).toEqual({
      audit: expect.objectContaining({
        name: 'audit',
        propertyKey: 'audit',
        kind: 'text',
        level: 'warn',
      }),
    });
    const cmp = ExtensionRegistry.getComponent(ChannelComponent.uri);
    expect(cmp.metadata.logChannels?.communication).toEqual(
      expect.objectContaining({
        name: 'communication',
        propertyKey: 'ioLogChannel',
        kind: 'transmit',
        title: 'Device',
        events: ['connect', 'disconnect', 'read', 'write'],
      }),
    );
  });

  it('should assign the channels to their properties and hand records to the sink', async () => {
    const app = (await AppFactory.createApp(profile(), {
      logSink,
    })) as ChannelApp;
    expect(app.audit.fullName).toBe('audit');
    expect(app.device.ioLogChannel.fullName).toBe('device/communication');
    app.device.ioLogChannel.write({
      direction: 'in',
      details: '10.0.0.5:2575',
      data: 'MSH|^~\\&',
    });
    expect(written).toEqual([
      [
        'device/communication',
        expect.objectContaining({
          direction: 'in',
          details: '10.0.0.5:2575',
          data: 'MSH|^~\\&',
          source: 'device',
          time: expect.any(Date),
        }),
      ],
    ]);
  });

  it('should drop records below the level and of disabled channels', async () => {
    const app = (await AppFactory.createApp(profile(), {
      logSink,
    })) as ChannelApp;
    app.audit.info('below warn');
    app.audit.error('kept');
    expect(written.map(([, e]) => e.message)).toEqual(['kept']);

    written.length = 0;
    const p = profile({ logs: { channels: { audit: { enabled: false } } } });
    p.components!.device.settings = {
      logs: { channels: { communication: { enabled: false } } },
    };
    await AppFactory.updateApp(app, p);
    app.audit.error('dropped');
    app.device.ioLogChannel.write({ direction: 'out', data: 'x' });
    expect(written).toEqual([]);
    expect(app.audit.enabled).toBe(false);
  });

  it('should write only the events a profile picks, data as read and write', async () => {
    const p = profile();
    p.components!.device.settings = {
      logs: { channels: { communication: { events: ['connect', 'write'] } } },
    };
    const app = (await AppFactory.createApp(p, {
      logSink,
    })) as ChannelApp;
    const channel = app.device.ioLogChannel;
    channel.write({ direction: 'info', event: 'connect', message: 'up' });
    channel.write({ direction: 'in', data: 'received' });
    channel.write({ direction: 'out', data: 'sent' });
    channel.write({ direction: 'info', event: 'disconnect', message: 'down' });
    /* A note of no event is not picked out */
    channel.write({ direction: 'info', message: 'note' });
    expect(written.map(([, e]) => [e.event, e.message ?? e.data])).toEqual([
      ['connect', 'up'],
      ['write', 'sent'],
      [undefined, 'note'],
    ]);

    /* Without events picked, all are written */
    written.length = 0;
    await AppFactory.updateApp(app, profile());
    channel.write({ direction: 'in', data: 'received' });
    expect(written.map(([, e]) => e.event)).toEqual(['read']);
  });

  it('should warn of settings naming a channel or an event the element does not have', async () => {
    const p = profile({
      logs: { channels: { console: { retentionDays: 3 }, audt: {} } },
    });
    p.components!.device.settings = {
      logs: {
        channels: { communication: { events: ['connect', 'conect', 'ack'] } },
      },
    };
    const r = decodeProfileSilent(p);
    /* Warnings: the worker is not stopped for a log setting */
    expect(r.result).toBe(true);
    expect(r.issues?.map(i => [i.severity, i.location, i.message])).toEqual([
      [
        'warning',
        'settings/logs/channels/audt',
        '"audt" is not a log channel of this element',
      ],
      [
        'warning',
        'components/device/settings/logs/channels/communication/events',
        '"conect", "ack" are not events of the "communication" channel. It has: connect, disconnect, read, write',
      ],
    ]);
  });
});
