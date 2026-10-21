import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { expect } from 'expect';
import {
  ApprovalRequiredError,
  publishPackage,
  saveCredentials,
} from '../src/index.js';

const PDF = Buffer.from('%PDF-1.7\n% a manual\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A registry taking publishes: what it was sent, kept */
function fakeRegistry() {
  const state = {
    exists: false,
    /** The version is published already: refused as the registry does */
    published: false,
    kept: new Set<string>(),
    /** Hashes it refuses once, as lacking them */
    lackOnce: [] as string[],
    prepared: [] as any[],
    /** Whether a publish is approved first; how its approval goes */
    approval: false,
    decisions: ['pending', 'approved'] as string[],
    requests: [] as any[],
    audiences: [] as (string | null)[],
    sent: [] as { query: string; zip: AdmZip }[],
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (status: number, data?: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(data === undefined ? '' : JSON.stringify(data));
      };
      const [url, query = ''] = req.url!.split('?');
      /* GitHub, handing a job its OIDC token for an audience */
      if (url === '/gh-oidc') {
        if (req.headers.authorization !== 'Bearer gh-request')
          return json(403, {});
        state.audiences.push(new URLSearchParams(query).get('audience'));
        return json(200, { value: 'oidc-for-registry' });
      }
      if (url.startsWith('/registry/pkg/ci')) {
        if (req.headers['x-sb-ci-token'] !== 'oidc-for-registry')
          return json(401, { errors: [{ message: 'no CI token' }] });
        if (url === '/registry/pkg/ci/prepare') {
          state.prepared.push(JSON.parse(body.toString()));
          return json(200, { exists: true, approval: false, missing: [] });
        }
        state.sent.push({ query: `ci ${query}`, zip: new AdmZip(body) });
        return json(204);
      }
      if (req.headers.authorization !== 'Bearer t0k3n')
        return json(401, { errors: [{ message: 'Unauthorized' }] });
      if (url === '/registry/pkg/prepare' && state.published)
        return json(409, {
          errors: [
            {
              code: 'VERSION_PUBLISHED',
              message:
                'Version 1.1.0 of package "@acme/gw" is already published',
            },
          ],
        });
      if (url === '/registry/pkg/prepare') {
        const input = JSON.parse(body.toString());
        state.prepared.push(input);
        return json(200, {
          exists: state.exists,
          approval: state.approval,
          missing: input.docs
            .filter(
              (d: any) => !d.path.endsWith('.md') && !state.kept.has(d.sha256),
            )
            .map((d: any) => d.sha256),
        });
      }
      if (url === '/registry/publish-requests') {
        state.requests.push(JSON.parse(body.toString()));
        return json(201, {
          id: 'req-1',
          approveUrl: 'http://console.test/publish/req-1',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      if (url === '/registry/publish-requests/req-1')
        return json(200, { status: state.decisions.shift() ?? 'approved' });
      if (url === '/registry/pkg') {
        const zip = new AdmZip(body);
        state.sent.push({ query, zip });
        const lacking = state.lackOnce.splice(0);
        if (lacking.length)
          return json(422, {
            errors: [{ message: 'lacks', details: { missing: lacking } }],
          });
        return json(204);
      }
      json(404, { errors: [{ message: 'nope' }] });
    });
  });
  return { server, state };
}

describe('spm publish', function () {
  this.timeout(10000);
  let dir: string;
  let registry: string;
  let archive: string;
  let fake: ReturnType<typeof fakeRegistry>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spm-publish-spec-'));
    process.env.SB_CONFIG_DIR = path.join(dir, 'config');
    fake = fakeRegistry();
    await new Promise<void>(r => fake.server.listen(0, '127.0.0.1', r));
    registry = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
    saveCredentials(registry, {
      issuer: 'http://issuer.invalid',
      clientId: 'spm',
      refreshToken: 'r',
      accessToken: 't0k3n',
      expiresAt: Date.now() + 3600_000,
    });
    const zip = new AdmZip();
    zip.addFile(
      'package.json',
      Buffer.from(JSON.stringify({ name: '@acme/gw', version: '1.1.0' })),
    );
    zip.addFile('index.js', Buffer.from('export {};'));
    zip.addFile('docs/Gw/README.md', Buffer.from('# Gw'));
    zip.addFile('docs/Gw/manual.pdf', PDF);
    zip.addFile('docs/Gw/sidebar.json', Buffer.from('{"items":[]}'));
    archive = path.join(dir, 'acme-gw-1.1.0.zip');
    zip.writeZip(archive);
  });

  afterEach(async () => {
    delete process.env.SB_CONFIG_DIR;
    await new Promise(r => fake.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('should publish a new package whole, private unless told', async () => {
    const r = await publishPackage({ archive, registry });
    expect(r).toMatchObject({
      name: '@acme/gw',
      version: '1.1.0',
      created: true,
    });
    expect(fake.state.prepared[0].docs.map((d: any) => d.path).sort()).toEqual(
      ['docs/Gw/README.md', 'docs/Gw/manual.pdf'].sort(),
    );
    const [sent] = fake.state.sent;
    expect(sent.query).toBe('visibility=private');
    expect(sent.zip.getEntry('docs/Gw/manual.pdf')).toBeTruthy();
    expect(sent.zip.getEntry('syncbridge-docs.json')).toBeNull();
  });

  it('should leave out the files the registry has, telling them in syncbridge-docs.json', async () => {
    fake.state.exists = true;
    fake.state.kept.add(sha(PDF));
    const r = await publishPackage({ archive, registry });
    expect(r.created).toBe(false);
    expect(r.reused).toEqual([
      { path: 'docs/Gw/manual.pdf', size: PDF.length },
    ]);
    const [sent] = fake.state.sent;
    /* Its visibility as it is */
    expect(sent.query).toBe('');
    expect(sent.zip.getEntry('docs/Gw/manual.pdf')).toBeNull();
    expect(sent.zip.getEntry('docs/Gw/README.md')).toBeTruthy();
    expect(sent.zip.getEntry('docs/Gw/sidebar.json')).toBeTruthy();
    const told = JSON.parse(sent.zip.readAsText('syncbridge-docs.json'));
    expect(told.files).toContainEqual({
      path: 'docs/Gw/manual.pdf',
      sha256: sha(PDF),
      size: PDF.length,
    });
  });

  it('should send again, with them, the files the registry turns out to lack', async () => {
    fake.state.exists = true;
    fake.state.kept.add(sha(PDF));
    fake.state.lackOnce.push(sha(PDF));
    const r = await publishPackage({ archive, registry });
    expect(fake.state.sent).toHaveLength(2);
    expect(fake.state.sent[1].zip.getEntry('docs/Gw/manual.pdf')).toBeTruthy();
    expect(r.reused).toEqual([]);
  });

  it('should have it approved first, when the registry asks it, and send it under the approval', async () => {
    fake.state.approval = true;
    const told: string[] = [];
    await publishPackage({
      archive,
      registry,
      pollMs: 1,
      onApproval: a => told.push(a.url),
    });
    expect(told).toEqual(['http://console.test/publish/req-1']);
    const [asked] = fake.state.requests;
    expect(asked).toMatchObject({
      name: '@acme/gw',
      version: '1.1.0',
      files: 5,
      docs: 2,
      client: { platform: process.platform },
    });
    expect(asked.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(asked.client.tool).toMatch(/^spm /);
    expect(new URLSearchParams(fake.state.sent[0].query).get('request')).toBe(
      'req-1',
    );
  });

  it('should not wait on an approval when told not to: refused at once, nothing sent', async () => {
    fake.state.approval = true;
    await expect(
      publishPackage({ archive, registry, pollMs: 1, wait: false }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(fake.state.requests).toHaveLength(0);
    expect(fake.state.sent).toHaveLength(0);
  });

  it('should send nothing denied', async () => {
    fake.state.approval = true;
    fake.state.decisions = ['pending', 'denied'];
    await expect(
      publishPackage({ archive, registry, pollMs: 1 }),
    ).rejects.toThrow(/denied/);
    expect(fake.state.sent).toHaveLength(0);
  });

  it('should publish as the GitHub Actions job it runs in: its OIDC token, no sign-in, no approval', async () => {
    fake.state.approval = true;
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${registry}/gh-oidc?api-version=2.0`;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'gh-request';
    /* No one signed in */
    fs.rmSync(path.join(dir, 'config'), { recursive: true });
    try {
      const r = await publishPackage({ archive, registry, pollMs: 1 });
      expect(r.ci).toBe(true);
      expect(fake.state.audiences).toEqual([registry, registry]);
      expect(fake.state.requests).toHaveLength(0);
      expect(fake.state.sent.map(x => x.query)).toEqual(['ci ']);
      /* Told not to: as the user, who is signed in to none */
      await expect(
        publishPackage({ archive, registry, ci: false }),
      ).rejects.toThrow(/run spm login/);
    } finally {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    }
  });

  it('should tell a job given no OIDC token what it needs', async () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${registry}/gh-oidc`;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'wrong';
    try {
      await expect(publishPackage({ archive, registry })).rejects.toThrow(
        /id-token: write/,
      );
    } finally {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    }
  });

  it('should tell what would be sent, sending nothing', async () => {
    fake.state.exists = true;
    fake.state.kept.add(sha(PDF));
    const r = await publishPackage({ archive, registry, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.reused).toHaveLength(1);
    expect(fake.state.sent).toHaveLength(0);
  });

  it('should refuse a version published already, unless told to skip it', async () => {
    fake.state.published = true;
    await expect(publishPackage({ archive, registry })).rejects.toThrow(
      /is already published/,
    );
    const r = await publishPackage({ archive, registry, skipExisting: true });
    expect(r).toMatchObject({
      name: '@acme/gw',
      version: '1.1.0',
      skipped: true,
      sentBytes: 0,
    });
    expect(fake.state.sent).toHaveLength(0);
  });

  it('should tell what the registry refuses', async () => {
    fs.rmSync(path.join(dir, 'config'), { recursive: true });
    await expect(publishPackage({ archive, registry })).rejects.toThrow(
      /run spm login/,
    );
  });
});
