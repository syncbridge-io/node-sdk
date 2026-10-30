import { expect } from 'expect';
import { hostPeerProblems } from '../../src/index.js';

describe('hostPeerProblems', () => {
  const provides: Record<string, string> = {
    '@syncbridge/common': '2.13.1',
    '@sqb/connect': '6.3.3',
  };

  it("should tell each peer the host lacks or has at a version out of its range, as SyncBridge's install check does", () => {
    expect(
      hostPeerProblems(
        {
          '@syncbridge/common': '^2.13.0',
          '@sqb/connect': '^7.0.0',
          mysql2: '^3.0.0',
        },
        name => provides[name],
      ),
    ).toEqual([
      'The host provides "@sqb/connect" 6.3.3, which does not satisfy ^7.0.0',
      'The host does not provide "mysql2"',
    ]);
  });

  it('should tell nothing of peers it provides, or of none', () => {
    expect(
      hostPeerProblems({ '@syncbridge/common': '^2.0.0' }, n => provides[n]),
    ).toEqual([]);
    expect(hostPeerProblems(undefined, n => provides[n])).toEqual([]);
  });
});
