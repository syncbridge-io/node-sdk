import { expect } from 'expect';
import { unmetPeers } from '../../src/index.js';

describe('unmetPeers', () => {
  const host = {
    '@syncbridge/common': '2.4.0',
    '@syncbridge/plugin-api': '2.3.0',
  };

  it('should tell the peers the host provides too old a version of, with the range asked', () => {
    expect(
      unmetPeers(
        {
          '@syncbridge/common': '^2.5.0',
          '@syncbridge/plugin-api': '^2.1.0',
        },
        host,
      ),
    ).toEqual({ '@syncbridge/common': '^2.5.0' });
  });

  it('should be none when all are met, or none asked', () => {
    expect(unmetPeers({ '@syncbridge/common': '^2.0.0' }, host)).toEqual({});
    expect(unmetPeers(undefined, host)).toEqual({});
  });

  it('should leave to the host the peers it does not name, and judge nothing when it names none', () => {
    expect(unmetPeers({ 'reflect-metadata': '^9.0.0' }, host)).toEqual({});
    expect(unmetPeers({ '@syncbridge/common': '^9.0.0' }, undefined)).toEqual(
      {},
    );
  });
});
