import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DOCS_DIR,
  DOCS_MANIFEST_FILE,
  type DocsManifestFile,
  isDocLeftOut,
  MANIFEST_FILE,
  packageDigest,
  parseDocPath,
  SbError,
  SIDEBAR_FILE,
} from '@syncbridge/common';
import AdmZip from 'adm-zip';
import semver from 'semver';
import { version as spmVersion } from '../constants.js';
import { packPackage } from '../pack-package.js';
import { resolveRegistry } from '../registry/credentials.js';
import {
  ciFetch,
  inGitHubActions,
  RegistryError,
  registryFetch,
} from '../registry/registry-client.js';
import {
  compareMetadata,
  type ElementDefinition,
  isMajorChange,
  publishedDefinitions,
} from './compare-published.js';

export type PackageAccess = 'public' | 'private';

export interface PublishOptions {
  /** A packed archive; none: the package in packageDir is packed first */
  archive?: string;
  packageDir?: string;
  tsconfig?: string;
  tempDir?: string;
  registry?: string;
  /**
   * Who may see it, when it is published first: private if not told.
   * Later versions keep what it has, unless told.
   */
  access?: PackageAccess;
  /** Tells what would be sent, sending nothing */
  dryRun?: boolean;
  /**
   * Told where the publish is approved, when the registry asks it: its
   * user approves it in Console, with a second factor
   */
  onApproval?: (approval: { url: string; expiresAt: string }) => void;
  /** How often the approval is asked after: ms, 2 s if not told */
  pollMs?: number;
  /**
   * Waits for the approval the registry asks (the default); false: an
   * ApprovalRequiredError at once instead - for a run no one watches
   */
  wait?: boolean;
  /**
   * Publishes as the GitHub Actions job it runs in - its OIDC token, no
   * sign-in, no approval: when in one, unless told not to
   */
  ci?: boolean;
  /**
   * A version the registry has already: skipped, not an error - a release
   * publishing each of its packages, most of them unchanged, run again
   * safely
   */
  skipExisting?: boolean;
  logger?: (message: string) => void;
}

/**
 * The registry asks the publish approved in Console, and spm was told not
 * to wait for it (wait: false): nothing was sent
 */
export class ApprovalRequiredError extends SbError {
  constructor(name: string, version: string) {
    super(
      `${name}@${version} must be approved in Console first: run spm publish where you can approve it, or publish from a GitHub Actions job its organization trusts`,
    );
  }
}

export interface PublishResult {
  registry: string;
  name: string;
  version: string;
  /** Whether it is a package's first version */
  created: boolean;
  /** What it would be whole, and what was sent */
  archiveBytes: number;
  sentBytes: number;
  /** Its documents' files the registry had: not sent */
  reused: { path: string; size: number }[];
  /** Published as a GitHub Actions job, not as a person */
  ci: boolean;
  dryRun: boolean;
  /** The registry had the version already: nothing sent (skipExisting) */
  skipped?: boolean;
}

/** The files of an archive's documents, each by its hash */
function docsOf(zip: AdmZip): (DocsManifestFile & { leftOut: boolean })[] {
  return zip
    .getEntries()
    .filter(
      e =>
        !e.isDirectory &&
        e.entryName.startsWith(DOCS_DIR + '/') &&
        path.posix.basename(e.entryName) !== SIDEBAR_FILE,
    )
    .map(e => {
      const data = e.getData();
      let leftOut = false;
      try {
        leftOut = isDocLeftOut(parseDocPath(e.entryName).type);
      } catch {
        /* Not one docs/ takes: the registry tells */
      }
      return {
        path: e.entryName,
        sha256: createHash('sha256').update(data).digest('hex'),
        size: data.length,
        leftOut,
      };
    });
}

/**
 * The archive to send: the whole one, if the registry lacks all it may
 * leave out; else without the files it has, all of them listed in
 * syncbridge-docs.json
 */
function archiveToSend(
  zip: AdmZip,
  docs: ReturnType<typeof docsOf>,
  missing: Set<string>,
): { buffer: Buffer; reused: { path: string; size: number }[] } {
  const reused = docs.filter(d => d.leftOut && !missing.has(d.sha256));
  if (!reused.length) return { buffer: zip.toBuffer(), reused: [] };
  const skip = new Set(reused.map(d => d.path));
  const out = new AdmZip();
  for (const e of zip.getEntries()) {
    if (skip.has(e.entryName)) continue;
    if (e.isDirectory) out.addFile(e.entryName, Buffer.alloc(0));
    else out.addFile(e.entryName, e.getData(), '', e.attr);
  }
  out.addFile(
    DOCS_MANIFEST_FILE,
    Buffer.from(
      JSON.stringify({
        files: docs.map(({ path: p, sha256, size }) => ({
          path: p,
          sha256,
          size,
        })),
      }),
    ),
  );
  return {
    buffer: out.toBuffer(),
    reused: reused.map(d => ({ path: d.path, size: d.size })),
  };
}

/**
 * Asks the registry for the publish to be approved - the package, its
 * version, its content's digest - tells where (onApproval), and waits for
 * its user: the request's id once approved; denied or ended, refused
 */
async function approve(
  registry: string,
  zip: AdmZip,
  publish: {
    name: string;
    version: string;
    size: number;
    docs: number;
    onApproval?: PublishOptions['onApproval'];
    pollMs: number;
  },
): Promise<string> {
  const files = zip
    .getEntries()
    .filter(e => !e.isDirectory)
    .map(e => ({
      path: e.entryName,
      sha256: createHash('sha256').update(e.getData()).digest('hex'),
    }));
  const asked = (await (
    await registryFetch(registry, 'registry/publish-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: publish.name,
        version: publish.version,
        digest: await packageDigest(files),
        size: publish.size,
        files: files.length,
        docs: publish.docs,
        client: {
          hostname: os.hostname(),
          platform: process.platform,
          tool: `spm ${spmVersion}`,
        },
      }),
    })
  ).json()) as { id: string; approveUrl: string; expiresAt: string };
  publish.onApproval?.({ url: asked.approveUrl, expiresAt: asked.expiresAt });
  for (;;) {
    await sleep(publish.pollMs);
    const { status } = (await (
      await registryFetch(registry, `registry/publish-requests/${asked.id}`)
    ).json()) as { status: string };
    if (status === 'approved') return asked.id;
    if (status === 'denied') throw new SbError('The publish was denied');
    if (status !== 'pending')
      throw new SbError(
        `The publish was not approved in time (${status}): run spm publish again`,
      );
  }
}

/** The hashes a refused publish tells the registry lacks */
function missingOf(error: unknown): string[] | undefined {
  if (!(error instanceof RegistryError) || error.status !== 422) return;
  const missing = (error.body as any)?.errors?.[0]?.details?.missing;
  return Array.isArray(missing) ? missing : undefined;
}

/**
 * Publishes a version of a package: packed first if no archive is given;
 * the registry asked first whether it may be published - who sends it, the
 * version new - and which of its documents' files it lacks: the archive
 * sent carries those alone (and every Markdown document). Should the
 * registry lack one after all (another publish of the package between),
 * sent once more with it.
 */
export async function publishPackage(
  options: PublishOptions,
): Promise<PublishResult> {
  const registry = resolveRegistry(options.registry);
  const log = options.logger;
  let packed: string | undefined;
  let archive = options.archive;
  try {
    if (!archive) {
      packed = fs.mkdtempSync(path.join(os.tmpdir(), 'spm-publish-'));
      await packPackage({
        pack: true,
        packageDir: options.packageDir ?? '.',
        outDir: packed,
        tsconfig: options.tsconfig,
        tempDir: options.tempDir,
        logger: log,
      });
      const zips = fs.readdirSync(packed).filter(f => f.endsWith('.zip'));
      archive = path.join(packed, zips[0]);
    }
    if (!fs.existsSync(archive)) throw new SbError(`${archive} does not exist`);
    const zip = new AdmZip(archive);
    const pkgEntry = zip.getEntry('package.json');
    if (!pkgEntry)
      throw new SbError(`${archive} is not a package: no package.json`);
    const { name, version } = JSON.parse(zip.readAsText(pkgEntry));
    await checkCarried(registry, zip, name, version, log);
    const docs = docsOf(zip);
    /* As the CI job it runs in, or as its signed-in user */
    const ci = options.ci ?? inGitHubActions();
    const call = ci ? ciFetch : registryFetch;

    const skippedResult = (): PublishResult => ({
      registry,
      name,
      version,
      created: false,
      archiveBytes: fs.statSync(archive!).size,
      sentBytes: 0,
      reused: [],
      ci,
      dryRun: !!options.dryRun,
      skipped: true,
    });
    const published = (e: unknown) =>
      !!options.skipExisting && isVersionPublished(e);
    let prepareResponse: Response;
    try {
      prepareResponse = await call(
        registry,
        ci ? 'registry/pkg/ci/prepare' : 'registry/pkg/prepare',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            version,
            docs: docs.map(({ path: p, sha256, size }) => ({
              path: p,
              sha256,
              size,
            })),
          }),
        },
      );
    } catch (e) {
      if (published(e)) return skippedResult();
      throw e;
    }
    const prepared = (await prepareResponse.json()) as {
      exists: boolean;
      approval: boolean;
      missing: string[];
    };

    const missing = new Set(prepared.missing);
    let sending = archiveToSend(zip, docs, missing);
    const access = options.access ?? (prepared.exists ? undefined : 'private');
    const result: PublishResult = {
      registry,
      name,
      version,
      created: !prepared.exists,
      archiveBytes: fs.statSync(archive).size,
      sentBytes: sending.buffer.length,
      reused: sending.reused,
      ci,
      dryRun: !!options.dryRun,
    };
    if (options.dryRun) return result;

    /* Approved by its user first, when the registry asks it */
    if (prepared.approval && !ci && options.wait === false)
      throw new ApprovalRequiredError(name, version);
    const request =
      prepared.approval && !ci
        ? await approve(registry, zip, {
            name,
            version,
            size: result.archiveBytes,
            docs: docs.length,
            onApproval: options.onApproval,
            pollMs: options.pollMs ?? 2000,
          })
        : undefined;
    const query = new URLSearchParams();
    if (access) query.set('visibility', access);
    if (request) query.set('request', request);
    const send = (buffer: Buffer) =>
      call(
        registry,
        `registry/pkg${ci ? '/ci' : ''}${query.size ? `?${query}` : ''}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: new Uint8Array(buffer),
        },
      );
    try {
      await send(sending.buffer);
    } catch (e) {
      /* Published meanwhile - by a run before this one */
      if (published(e)) return skippedResult();
      const lacking = missingOf(e);
      if (!lacking?.length) throw e;
      log?.(
        `The registry lacks ${lacking.length} of the files left out: sending them too`,
      );
      for (const sha of lacking) missing.add(sha);
      sending = archiveToSend(zip, docs, missing);
      await send(sending.buffer);
      result.sentBytes = sending.buffer.length;
      result.reused = sending.reused;
    }
    return result;
  } finally {
    if (packed) fs.rmSync(packed, { recursive: true, force: true });
  }
}

/**
 * The profiles written for the package's last published version carried
 * to this one: what changed with nothing declared to carry it refuses a
 * version that is not a major, and is told in a major. A registry that
 * cannot tell is told, not refused: the comparison is a help, its check
 * the package's own
 */
async function checkCarried(
  registry: string,
  zip: AdmZip,
  name: string,
  version: string,
  log?: (message: string) => void,
): Promise<void> {
  const entry = zip.getEntry(MANIFEST_FILE);
  if (!entry) return;
  const manifest = JSON.parse(zip.readAsText(entry));
  const current: ElementDefinition[] = [
    ...(manifest.apps || []),
    ...(manifest.components || []),
  ];
  let published: Awaited<ReturnType<typeof publishedDefinitions>>;
  try {
    published = await publishedDefinitions(registry, name);
  } catch (e: any) {
    log?.(`Not compared with its last published version: ${e.message}`);
    return;
  }
  if (!published) return;
  if (!semver.gt(version, published.version)) {
    log?.(
      `Not compared with ${published.version}, published already: it is not older`,
    );
    return;
  }
  const r = compareMetadata(published.definitions, current, {
    major: isMajorChange(published.version, version),
  });
  for (const w of r.warnings) log?.(`Changed since ${published.version}: ${w}`);
  if (r.errors.length)
    throw new SbError(
      `${name}@${version} cannot carry the profiles written for ${published.version}:\n  - ` +
        r.errors.join('\n  - ') +
        '\nDeclare what changed (formerly, formerlyValues, a default), or make it a major version',
    );
}

/** The registry's answer that the version is published already */
function isVersionPublished(e: unknown): boolean {
  return (
    e instanceof RegistryError &&
    e.status === 409 &&
    (e.body as any)?.errors?.[0]?.code === 'VERSION_PUBLISHED'
  );
}
