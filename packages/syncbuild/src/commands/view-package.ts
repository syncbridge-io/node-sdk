import { SbError } from '@syncbridge/common';
import { credentialsOf, resolveRegistry } from '../registry/credentials.js';
import {
  ciFetch,
  inGitHubActions,
  RegistryError,
  registryFetch,
} from '../registry/registry-client.js';

const PACKAGE_NAME = /^@[\w.-]+\/[\w-]+$/;

export interface ViewOptions {
  /** The package, `@org/name`, or one version of it, `@org/name@1.2.3` */
  name: string;
  registry?: string;
  /**
   * Asks as the GitHub Actions job it runs in - its OIDC token, which sees
   * the private packages its organization's trust lets it publish: when in
   * one, unless told not to
   */
  ci?: boolean;
}

export interface ViewResult {
  registry: string;
  name: string;
  /**
   * Its published versions, newest first - the one asked alone, if one was:
   * none if it is not published, or may not be seen by who asks
   */
  versions: string[];
}

/**
 * The published versions of a package, as whoever publishes it would see
 * them: a GitHub Actions job by its OIDC token, else the signed-in user,
 * else anybody. Not published, or not to be seen, is no versions; a
 * registry that cannot tell is an error - never told as not published.
 */
export async function viewPackage(options: ViewOptions): Promise<ViewResult> {
  const registry = resolveRegistry(options.registry);
  const at = options.name.indexOf('@', 1);
  const name = at > 0 ? options.name.slice(0, at) : options.name;
  const version = at > 0 ? options.name.slice(at + 1) : undefined;
  if (!PACKAGE_NAME.test(name) || version === '')
    throw new SbError(
      `"${options.name}" is not a package: @organization/name[@version]`,
    );
  const ci = options.ci ?? inGitHubActions();
  let versions: string[];
  if (ci) {
    const resp = await ciFetch(
      registry,
      `registry/pkg/ci/versions?name=${encodeURIComponent(name)}`,
    );
    versions = ((await resp.json()) as { versions: string[] }).versions;
  } else {
    const resp = await (credentialsOf(registry)
      ? registryFetch(registry, `registry/pkg/${name}/versions`).catch(e => {
          if (e instanceof RegistryError && e.status === 404) return undefined;
          throw e;
        })
      : anonymousFetch(registry, `registry/pkg/${name}/versions`));
    versions = resp
      ? ((await resp.json()) as { payload: { version: string }[] }).payload.map(
          v => v.version,
        )
      : [];
  }
  return {
    registry,
    name,
    versions: version ? versions.filter(v => v === version) : versions,
  };
}

/** A request to a registry as nobody: undefined for a 404 */
export async function anonymousFetch(
  registry: string,
  path: string,
): Promise<Response | undefined> {
  let resp: Response;
  try {
    resp = await fetch(`${registry}/${path}`);
  } catch (e: any) {
    throw new SbError(
      `${registry} could not be reached: ${e.cause?.message ?? e.message}`,
    );
  }
  if (resp.status === 404) return undefined;
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    throw new RegistryError(
      resp.status,
      (body as any)?.errors?.[0]?.message || text || resp.statusText,
      body,
    );
  }
  return resp;
}
