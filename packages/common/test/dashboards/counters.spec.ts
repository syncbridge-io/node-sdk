import { expect } from 'expect';
import {
  DashboardCounters,
  type DashboardOp,
  Widget,
  widgetIssues,
  widgetMetadataOf,
} from '../../src/index.js';

describe('Chart counts', () => {
  const at0 = 1_000_000;
  const points = (sent: DashboardOp[]) =>
    sent.map(op => (op.op === 'point' ? [op.series, op.value, op.at] : op));

  it('should write each interval its sum, 0 for one with none once counted, and nothing for a series never counted', () => {
    const sent: DashboardOp[] = [];
    const c = new DashboardCounters(op => sent.push(op));
    c.add('w', 'rx', 5, 1000, at0);
    c.add('w', 'rx', 3, 1000, at0 + 400);
    c.tick(at0 + 999);
    expect(sent).toEqual([]);
    c.tick(at0 + 1000);
    c.tick(at0 + 2000);
    c.add('w', 'rx', 2, 1000, at0 + 2500);
    c.tick(at0 + 3000);
    expect(points(sent)).toEqual([
      ['rx', 8, at0 + 1000],
      ['rx', 0, at0 + 2000],
      ['rx', 2, at0 + 3000],
    ]);
  });

  it('should write intervals missed as the first one and a 0 at the last, and flush what is left at a stop, forgotten', () => {
    const sent: DashboardOp[] = [];
    const c = new DashboardCounters(op => sent.push(op));
    c.add('w', 'rx', 4, 1000, at0);
    c.tick(at0 + 10_500);
    c.add('w', 'rx', 6, 1000, at0 + 10_700);
    c.add('w', 'tx', 1, 5000, at0 + 10_700);
    c.flush(at0 + 10_800);
    expect(points(sent)).toEqual([
      ['rx', 4, at0 + 1000],
      ['rx', 0, at0 + 10_000],
      ['rx', 6, at0 + 10_800],
      ['tx', 1, at0 + 10_800],
    ]);
    sent.length = 0;
    c.tick(at0 + 60_000);
    expect(sent).toEqual([]);
  });

  it("should take a chart's interval as '1m' or seconds, within 1 s and 1 h", () => {
    const chart = Widget.chart({ series: ['rx'], interval: '1m' });
    expect(chart.data).toMatchObject({ kind: 'series', interval: 60 });
    expect(widgetIssues(widgetMetadataOf('c', chart), undefined)).toEqual([]);
    expect(
      widgetIssues(
        widgetMetadataOf('c', Widget.chart({ series: ['rx'], interval: 0.5 })),
        undefined,
      ),
    ).toEqual(['its interval is 1 to 3600 seconds']);
    expect(
      widgetIssues(
        widgetMetadataOf(
          's',
          Widget.custom('core.stat@1', {
            data: { kind: 'value', interval: 5 },
          }),
        ),
        undefined,
      ),
    ).toEqual(['only a series has an interval']);
  });
});
