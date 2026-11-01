import type { DashboardOp } from '@syncbridge/common';
import { expect } from 'expect';
import { DashboardCoalescer } from '../src/index.js';

describe('DashboardCoalescer', () => {
  let batches: DashboardOp[][];
  let c: DashboardCoalescer;

  beforeEach(() => {
    batches = [];
    c = new DashboardCoalescer(ops => batches.push(ops), 60000);
  });
  afterEach(() => c.stop());

  it('should send a value set many times as its last', () => {
    for (let i = 0; i < 1000; i++)
      c.push({ op: 'set', widget: 'd/q', value: i });
    c.flush();
    expect(batches).toEqual([[{ op: 'set', widget: 'd/q', value: 999 }]]);
  });

  it("should send a table's rows as each one's last change, after a replace or a clear", () => {
    c.push({ op: 'upsert', widget: 'd/t', key: 'a', row: { v: 1 } });
    c.push({
      op: 'replace',
      widget: 'd/t',
      rows: [{ key: 'b', row: { v: 2 } }],
    });
    c.push({ op: 'upsert', widget: 'd/t', key: 'c', row: { v: 3 } });
    c.push({ op: 'upsert', widget: 'd/t', key: 'c', row: { v: 4 } });
    c.push({ op: 'upsert', widget: 'd/t', key: 'd', row: { v: 5 } });
    c.push({ op: 'remove', widget: 'd/t', key: 'd' });
    c.flush();
    expect(batches[0]).toEqual([
      { op: 'replace', widget: 'd/t', rows: [{ key: 'b', row: { v: 2 } }] },
      { op: 'upsert', widget: 'd/t', key: 'c', row: { v: 4 } },
      { op: 'remove', widget: 'd/t', key: 'd' },
    ]);
    c.push({ op: 'upsert', widget: 'd/t', key: 'a', row: { v: 1 } });
    c.push({ op: 'clear', widget: 'd/t' });
    c.flush();
    expect(batches[1]).toEqual([{ op: 'clear', widget: 'd/t' }]);
  });

  it("should send a series' points and a feed's rows together, within the bounds, a clear dropping those before", () => {
    c.push({ op: 'point', widget: 'd/s', series: 'in', value: 1, at: 1 });
    c.push({ op: 'clear', widget: 'd/s', series: 'in' });
    c.push({ op: 'point', widget: 'd/s', series: 'in', value: 2, at: 2 });
    c.push({ op: 'point', widget: 'd/s', series: 'out', value: 3, at: 3 });
    for (let i = 0; i < 250; i++)
      c.push({ op: 'append', widget: 'd/f', row: { i }, at: i });
    c.flush();
    const [ops] = batches;
    expect(ops.slice(0, 3)).toEqual([
      { op: 'clear', widget: 'd/s', series: 'in' },
      { op: 'point', widget: 'd/s', series: 'in', value: 2, at: 2 },
      { op: 'point', widget: 'd/s', series: 'out', value: 3, at: 3 },
    ]);
    const appended = ops.filter(o => o.op === 'append');
    expect(appended).toHaveLength(200);
    expect(appended[0]).toMatchObject({ row: { i: 50 } });
  });

  it('should keep a clear first, though no write told its kind before it', () => {
    c.push({ op: 'clear', widget: 'd/f' });
    c.push({ op: 'append', widget: 'd/f', row: { x: 1 }, at: 1 });
    c.flush();
    expect(batches[0]).toEqual([
      { op: 'clear', widget: 'd/f' },
      { op: 'append', widget: 'd/f', row: { x: 1 }, at: 1 },
    ]);
  });

  it('should send widgets defined first, in their order, and drop what an undefined one had pending', () => {
    c.push({ op: 'set', widget: 'd/x', value: 1 });
    c.push({ op: 'define', dashboard: 'd', widget: { id: 'x' } as any });
    c.push({ op: 'undefine', dashboard: 'd', id: 'x' });
    c.push({ op: 'set', widget: 'd/q', value: 2 });
    c.flush();
    expect(batches[0]).toEqual([
      { op: 'define', dashboard: 'd', widget: { id: 'x' } },
      { op: 'undefine', dashboard: 'd', id: 'x' },
      { op: 'set', widget: 'd/q', value: 2 },
    ]);
  });

  it("should send attention after the data, the last for each widget, row or field, a row's going with the row", () => {
    c.push({ op: 'attend', widget: 'd/q', attention: 'pulse' });
    c.push({ op: 'attend', widget: 'd/q', attention: null });
    c.push({ op: 'attend', widget: 'd/t', key: 'a', attention: 'pulse' });
    c.push({
      op: 'attend',
      widget: 'd/t',
      key: 'a',
      field: 'hr',
      attention: 'highlight',
      until: 5,
    });
    c.push({ op: 'attend', widget: 'd/t', key: 'b', attention: 'pulse' });
    c.push({ op: 'upsert', widget: 'd/t', key: 'a', row: { hr: 1 } });
    c.push({ op: 'remove', widget: 'd/t', key: 'b' });
    c.flush();
    expect(batches[0]).toEqual([
      { op: 'upsert', widget: 'd/t', key: 'a', row: { hr: 1 } },
      { op: 'remove', widget: 'd/t', key: 'b' },
      { op: 'attend', widget: 'd/q', attention: null },
      { op: 'attend', widget: 'd/t', key: 'a', attention: 'pulse' },
      {
        op: 'attend',
        widget: 'd/t',
        key: 'a',
        field: 'hr',
        attention: 'highlight',
        until: 5,
      },
    ]);
    c.push({ op: 'attend', widget: 'd/t', key: 'a', attention: 'pulse' });
    c.push({ op: 'attend', widget: 'd/t', key: 'c', attention: 'pulse' });
    c.push({ op: 'attend', widget: 'd/t', attention: 'highlight' });
    c.push({ op: 'replace', widget: 'd/t', rows: [{ key: 'c', row: {} }] });
    c.push({ op: 'attend', widget: 'd/u', key: 'x', attention: 'pulse' });
    c.push({ op: 'clear', widget: 'd/u' });
    c.flush();
    expect(batches[1]).toEqual([
      { op: 'replace', widget: 'd/t', rows: [{ key: 'c', row: {} }] },
      { op: 'clear', widget: 'd/u' },
      { op: 'attend', widget: 'd/t', key: 'c', attention: 'pulse' },
      { op: 'attend', widget: 'd/t', attention: 'highlight' },
    ]);
  });

  it('should send once the interval is up, nothing when nothing was written', async () => {
    const fast = new DashboardCoalescer(ops => batches.push(ops), 250);
    fast.push({ op: 'set', widget: 'd/q', value: 1 });
    fast.push({ op: 'set', widget: 'd/q', value: 2 });
    expect(batches).toEqual([]);
    await new Promise(r => setTimeout(r, 300));
    expect(batches).toEqual([[{ op: 'set', widget: 'd/q', value: 2 }]]);
    fast.flush();
    expect(batches).toHaveLength(1);
    expect(new DashboardCoalescer(() => undefined, 10).interval).toBe(250);
  });
});
