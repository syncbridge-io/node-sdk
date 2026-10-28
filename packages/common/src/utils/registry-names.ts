import { SbError } from '../classes/sb-error.js';

/** Prefix that marks a registry package in an import specifier */
export const SB_SPECIFIER_PREFIX = 'sb:';

/**
 * The npm scope registry packages are published under for development and
 * tests: `@abisena/iomt` becomes `@sbext/abisena__iomt`. Reserved, so no
 * registry organization can take it.
 */
export const SBEXT_SCOPE = 'sbext';

/**
 * Organization names the registry does not let anyone create. A policy for
 * creating organizations, not a naming rule: `syncbridge` is reserved for its
 * owner, while `@syncbridge/sqb` is still a valid registry name.
 */
export const RESERVED_SCOPES: readonly string[] = [SBEXT_SCOPE, 'syncbridge'];

/** The SDK: on npm, not in the registry; the host provides them */
export const SDK_PACKAGES: readonly string[] = [
  '@syncbridge/common',
  '@syncbridge/runtime',
  '@syncbridge/syncbuild',
  '@syncbridge/testing',
  '@syncbridge/plugin-api',
  '@syncbridge/pnpm-config',
];

/** Whether a name is one of the SDK's packages, which come from npm */
export const isSdkPackage = (name: string) => SDK_PACKAGES.includes(name);

/**
 * Whether a name is one of SyncBridge's own registry packages
 * (`@syncbridge/builtins`, `@syncbridge/hl7`, ...). They are registry
 * packages like any other - a server comes with a version of each, and
 * installs a newer one a package needs from the registry - but a package
 * imports one under its own name, `@syncbridge/builtins`, not
 * `sb:@syncbridge/builtins`.
 */
export const isSyncBridgeModule = (name: string) =>
  name.startsWith('@syncbridge/') && !isSdkPackage(name);

/** npm's limit on the length of a whole package name, scope included */
const MAX_NAME_LENGTH = 214;

/** Lower-case, URL-safe, and not starting with `.` or `_` */
const NAME_PART_PATTERN = /^[a-z0-9-][a-z0-9._-]*$/;

/**
 * Checks a registry organization name - the scope, with or without its `@`.
 * Returns the problems found; an empty array means it is valid.
 *
 * `__` is refused because `toSbextName` joins the scope and the name with
 * it: a scope containing one could not be split back apart.
 */
export function validateScopeName(scope: string): string[] {
  const s = scope.startsWith('@') ? scope.slice(1) : scope;
  if (!s) return ['Scope must not be empty'];
  const problems: string[] = [];
  if (!NAME_PART_PATTERN.test(s))
    problems.push(
      `Scope "${s}" may only contain lower-case letters, digits, "-", "." and "_", and must not start with "." or "_"`,
    );
  if (s.includes('__')) problems.push(`Scope "${s}" must not contain "__"`);
  /* Unlike the other reserved scopes, this one can never be a vendor's */
  if (s === SBEXT_SCOPE)
    problems.push(`Scope "${s}" is reserved for the npm mirror`);
  return problems;
}

/**
 * Checks a registry package name. Registry names are scoped (`@vendor/name`)
 * and follow npm's naming rules, and neither part may contain `__`.
 * Returns the problems found; an empty array means it is valid.
 */
export function validateRegistryName(name: string): string[] {
  const m = /^@([^/]*)\/([^/]*)$/.exec(name);
  if (!m) return [`"${name}" must be a scoped name, "@vendor/name"`];
  const [, scope, pkg] = m;
  const problems = validateScopeName(scope);
  if (!pkg) problems.push(`"${name}" has no name after the scope`);
  else {
    if (!NAME_PART_PATTERN.test(pkg))
      problems.push(
        `Name "${pkg}" may only contain lower-case letters, digits, "-", "." and "_", and must not start with "." or "_"`,
      );
    if (pkg.includes('__'))
      problems.push(`Name "${pkg}" must not contain "__"`);
  }
  if (name.length > MAX_NAME_LENGTH)
    problems.push(`"${name}" is longer than ${MAX_NAME_LENGTH} characters`);
  return problems;
}

function assertRegistryName(name: string) {
  const problems = validateRegistryName(name);
  if (problems.length)
    throw new SbError(`Invalid registry name. ${problems.join('. ')}`);
}

/**
 * Maps a registry name to the npm name it is published under:
 * `@abisena/iomt` -> `@sbext/abisena__iomt`.
 */
export function toSbextName(name: string): string {
  assertRegistryName(name);
  const [scope, pkg] = name.slice(1).split('/');
  return `@${SBEXT_SCOPE}/${scope}__${pkg}`;
}

/**
 * Maps an npm name under `@sbext` back to its registry name:
 * `@sbext/abisena__iomt` -> `@abisena/iomt`.
 */
export function fromSbextName(npmName: string): string {
  const prefix = `@${SBEXT_SCOPE}/`;
  if (!npmName.startsWith(prefix))
    throw new SbError(`"${npmName}" is not under the @${SBEXT_SCOPE} scope`);
  const parts = npmName.slice(prefix.length).split('__');
  if (parts.length !== 2)
    throw new SbError(
      `"${npmName}" is not a "@${SBEXT_SCOPE}/<vendor>__<name>" name`,
    );
  const name = `@${parts[0]}/${parts[1]}`;
  assertRegistryName(name);
  return name;
}

/**
 * Parses an import specifier that names a registry package:
 * `sb:@abisena/iomt/protocol` -> `{ name: '@abisena/iomt', subpath: './protocol' }`.
 * Returns `undefined` for a specifier without the `sb:` prefix, and throws for
 * one that has it but does not name a valid registry package.
 */
export function parseSbSpecifier(
  specifier: string,
): { name: string; subpath: string } | undefined {
  if (!specifier.startsWith(SB_SPECIFIER_PREFIX)) return;
  const rest = specifier.slice(SB_SPECIFIER_PREFIX.length);
  const m = /^(@[^/]+\/[^/]+)(\/.*)?$/.exec(rest);
  if (!m)
    throw new SbError(
      `"${specifier}" must name a registry package, "sb:@vendor/name"`,
    );
  assertRegistryName(m[1]);
  return { name: m[1], subpath: m[2] ? '.' + m[2] : '.' };
}
