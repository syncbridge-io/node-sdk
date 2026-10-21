import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import { saveCredentials, viewPackage } from '../src/index.js';

/**
 * A registry telling versions: @acme/gw anybody's, @acme/secret its
 * signed-in user's and its trusted job's alone, @acme/broken failing
 */
function fakeRegistry() {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    const json = (status: number, data?: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    const url = new URL(req.url!, 'http://x');
    asked.push(url.pathname + url.search);
    if (url.pathname === '/gh-oidc')
      return req.headers.authorization === 'Bearer gh-request'
        ? json(200, { value: 'oidc-for-registry' })
        : json(403, {});
    if (url.pathname === '/registry/pkg/ci/versions') {
      if (req.headers['x-sb-ci-token'] !== 'oidc-for-registry')
        return json(401, { errors: [{ message: 'no CI token' }] });
      const name = url.searchParams.get('name');
      return json(200, {
        name,
        versions: name === '@acme/secret' ? ['2.0.0'] : [],
      });
    }
    const user = req.headers.authorization === 'Bearer t0k3n';
    const versions = (...vs: string[]) =>
      json(200, { payload: vs.map(version => ({ version })) });
    if (url.pathname === '/registry/pkg/@acme/gw/versions')
      return versions('1.1.0', '1.0.0');
    if (url.pathname === '/registry/pkg/@acme/secret/versions' && user)
      return versions('2.0.0');
    if (url.pathname === '/registry/pkg/@acme/broken/versions')
      return json(500, { errors: [{ message: 'the database is gone' }] });
    json(404, { errors: [{ message: 'Package not found' }] });
  });
  return { server, asked };
}

describe('spm view', function () {
  this.timeout(10000);
  let dir: string;
  let registry: string;
  let fake: ReturnType<typeof fakeRegistry>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spm-view-spec-'));
    process.env.SB_CONFIG_DIR = path.join(dir, 'config');
    fake = fakeRegistry();
    await new Promise<void>(r => fake.server.listen(0, '127.0.0.1', r));
    registry = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    delete process.env.SB_CONFIG_DIR;
    await new Promise(r => fake.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const signIn = () =>
    saveCredentials(registry, {
      issuer: 'http://issuer.invalid',
      clientId: 'spm',
      refreshToken: 'r',
      accessToken: 't0k3n',
      expiresAt: Date.now() + 3600_000,
    });

  it('should tell the versions anybody sees, newest first, signed in to none', async () => {
    expect(await viewPackage({ name: '@acme/gw', registry })).toEqual({
      registry,
      name: '@acme/gw',
      versions: ['1.1.0', '1.0.0'],
    });
    expect(
      (await viewPackage({ name: '@acme/gw@1.0.0', registry })).versions,
    ).toEqual(['1.0.0']);
    expect(
      (await viewPackage({ name: '@acme/gw@9.9.9', registry })).versions,
    ).toEqual([]);
  });

  it('should tell one not published, or not to be seen, as no versions', async () => {
    expect(
      (await viewPackage({ name: '@acme/none', registry })).versions,
    ).toEqual([]);
    expect(
      (await viewPackage({ name: '@acme/secret', registry })).versions,
    ).toEqual([]);
    signIn();
    expect(
      (await viewPackage({ name: '@acme/secret', registry })).versions,
    ).toEqual(['2.0.0']);
  });

  it('should ask as the GitHub Actions job it runs in: its OIDC token', async () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${registry}/gh-oidc?api-version=2.0`;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'gh-request';
    try {
      expect(
        (await viewPackage({ name: '@acme/secret', registry })).versions,
      ).toEqual(['2.0.0']);
      expect(fake.asked).toContain(
        '/registry/pkg/ci/versions?name=%40acme%2Fsecret',
      );
      /* Told not to: as nobody, signed in to none */
      expect(
        (await viewPackage({ name: '@acme/secret', registry, ci: false }))
          .versions,
      ).toEqual([]);
    } finally {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    }
  });

  it('should fail a registry that cannot tell - never told as not published', async () => {
    await expect(
      viewPackage({ name: '@acme/broken', registry }),
    ).rejects.toThrow(/the database is gone/);
    await expect(
      viewPackage({ name: '@acme/gw', registry: 'http://127.0.0.1:1' }),
    ).rejects.toThrow(/could not be reached/);
    await expect(viewPackage({ name: 'gw', registry })).rejects.toThrow(
      /not a package/,
    );
  });
});
