import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'expect';
import {
  accessTokenOf,
  credentialsOf,
  login,
  logout,
  registryFetch,
  resolveRegistry,
} from '../src/index.js';

/** A token whose payload names its user, as Keycloak's do */
const token = (name: string, n: number) =>
  `h.${Buffer.from(JSON.stringify({ preferred_username: name })).toString('base64url')}.${n}`;

/**
 * A registry and its identity provider in one: the device authorization
 * grant, refresh, revocation; /auth/cli and an API refusing stale tokens
 */
function fakeServer() {
  const state = {
    polls: 0,
    issued: 0,
    revoked: [] as string[],
    current: '',
    denied: false,
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const issue = () => {
        state.current = token('bob', ++state.issued);
        json(200, {
          access_token: state.current,
          refresh_token: `refresh-${state.issued}`,
          expires_in: 300,
        });
      };
      switch (req.url) {
        case '/auth/cli':
          return json(200, { issuer: `${base}/realm`, clientId: 'spm' });
        case '/realm/.well-known/openid-configuration':
          return json(200, {
            device_authorization_endpoint: `${base}/realm/device`,
            token_endpoint: `${base}/realm/token`,
            revocation_endpoint: `${base}/realm/revoke`,
          });
        case '/realm/device':
          expect(form.get('scope')).toBe('openid offline_access');
          return json(200, {
            device_code: 'dev-1',
            user_code: 'ABCD-EFGH',
            verification_uri: `${base}/realm/device`,
            expires_in: 60,
            interval: 0,
          });
        case '/realm/token':
          if (form.get('grant_type') === 'refresh_token') return issue();
          if (state.denied) return json(400, { error: 'access_denied' });
          /* Its user signs in on the second poll */
          if (++state.polls < 2)
            return json(400, { error: 'authorization_pending' });
          return issue();
        case '/realm/revoke':
          state.revoked.push(form.get('token')!);
          return json(200, {});
        case '/auth/me':
          if (req.headers.authorization !== `Bearer ${state.current}`)
            return json(401, { errors: [{ message: 'Unauthorized' }] });
          return json(200, { username: 'bob' });
        default:
          return json(404, { errors: [{ message: 'nope' }] });
      }
    });
  });
  return { server, state };
}

describe('the registry client', function () {
  this.timeout(10000);
  let dir: string;
  let registry: string;
  let fake: ReturnType<typeof fakeServer>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spm-config-'));
    process.env.SB_CONFIG_DIR = dir;
    fake = fakeServer();
    await new Promise<void>(r => fake.server.listen(0, '127.0.0.1', r));
    registry = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    delete process.env.SB_CONFIG_DIR;
    await new Promise(r => fake.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should tell the registry, without a trailing slash', () => {
    expect(resolveRegistry('https://api.example.com/')).toBe(
      'https://api.example.com',
    );
    const env = process.env.SB_REGISTRY_URL;
    delete process.env.SB_REGISTRY_URL;
    try {
      expect(resolveRegistry()).toBe('https://api.syncbridge.io');
    } finally {
      if (env !== undefined) process.env.SB_REGISTRY_URL = env;
    }
    expect(() => resolveRegistry('ftp://x')).toThrow(/not a registry/);
  });

  it('should sign in by a code entered elsewhere, and keep it for its owner alone', async () => {
    const told: string[] = [];
    const credentials = await login(registry, code => told.push(code.userCode));
    expect(told).toEqual(['ABCD-EFGH']);
    expect(credentials.username).toBe('bob');
    expect(credentialsOf(registry)?.refreshToken).toBe('refresh-1');
    const mode = fs.statSync(path.join(dir, 'credentials.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('should tell a sign-in denied', async () => {
    fake.state.denied = true;
    await expect(login(registry, () => undefined)).rejects.toThrow(/denied/);
  });

  it('should renew a token ended, or refused, by its refresh token', async () => {
    await login(registry, () => undefined);
    const first = await accessTokenOf(registry);
    expect(first).toBe(fake.state.current);
    /* Refused by the API: renewed once, asked again */
    fake.state.current = 'another';
    const me = await (await registryFetch(registry, 'auth/me')).json();
    expect(me).toEqual({ username: 'bob' });
    expect(credentialsOf(registry)?.refreshToken).toBe('refresh-2');
  });

  it('should sign out: its token revoked, forgotten', async () => {
    await login(registry, () => undefined);
    expect(await logout(registry)).toBe(true);
    expect(fake.state.revoked).toEqual(['refresh-1']);
    expect(credentialsOf(registry)).toBeUndefined();
    expect(await logout(registry)).toBe(false);
    await expect(accessTokenOf(registry)).rejects.toThrow(/run spm login/);
  });
});
