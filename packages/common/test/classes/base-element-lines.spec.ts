import { expect } from 'expect';
import { BaseElement } from '../../src/index.js';

describe('BaseElement lines', () => {
  class Element extends BaseElement {
    protected async _start(): Promise<void> {}
    protected async _terminate(): Promise<void> {}
    glanceIs(text?: string, tone?: any) {
      this.setGlance(text, tone);
    }
    activityIs(text?: string, tone?: any) {
      this.setActivity(text, tone);
    }
  }
  const element = () => new Element({ name: 'e', values: {} });

  it('should keep a line on one line, trimmed, cut at 80 characters', () => {
    const e = element();
    e.glanceIs('  lis.local:2575\n  ');
    expect(e.glance).toEqual({ text: 'lis.local:2575' });
    e.glanceIs('x'.repeat(100));
    expect(e.glance!.text).toHaveLength(BaseElement.LINE_MAX_LENGTH);
    expect(e.glance!.text.endsWith('…')).toBe(true);
  });

  it('should keep a known tone, leave out an unknown one', () => {
    const e = element();
    e.activityIs('Queue 980 / 1000', 'warning');
    expect(e.activity).toEqual({ text: 'Queue 980 / 1000', tone: 'warning' });
    e.activityIs('Queue 10 / 1000', 'loud');
    expect(e.activity).toEqual({ text: 'Queue 10 / 1000' });
  });

  it('should clear a line set empty', () => {
    const e = element();
    e.glanceIs('lis.local:2575');
    e.glanceIs('   ');
    expect(e.glance).toBeUndefined();
  });

  it('should tell a change once, not a line set again the same', () => {
    const e = element();
    const told: any[] = [];
    e.on('line-change', (kind, line) => told.push([kind, line]));
    e.activityIs('a');
    e.activityIs('a');
    e.activityIs('a', 'ok');
    e.glanceIs('g');
    e.activityIs(undefined);
    expect(told).toEqual([
      ['activity', { text: 'a' }],
      ['activity', { text: 'a', tone: 'ok' }],
      ['glance', { text: 'g' }],
      ['activity', undefined],
    ]);
  });
});
