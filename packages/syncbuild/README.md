# @syncbridge/syncbuild

SyncBridge Extension Package Builder: builds, checks and verifies SyncBridge extension packages.

## Installation

```bash
npm install @syncbridge/syncbuild
```

A package written for syncbuild 1.0.x and `@syncbridge/common` 1.1.x
(processors, `metadata/`, `TransmitLogger`) is brought to the current form
by [MIGRATION.md](MIGRATION.md).

## Starting a package

```bash
npx @syncbridge/syncbuild init @acme/patient-monitor
cd patient-monitor && npm install && npm test
```

`spm init <@vendor/name> [directory]` creates an extension package: its
`package.json` (`@syncbridge/common` as a peer), its
`syncbridge-manifest.json`, TypeScript and mocha setup, an
example app and its first test, written with
[`@syncbridge/testing`](../testing/README.md). `--app <ClassName>`
names the example app. Existing files are never overwritten. The
package is built from `src` with `tsconfig-build.json`; `tsconfig.json`
covers the tests as well.

## The manifest

A package's manifest says what SyncBridge needs to know of it. Its author
writes it in `syncbridge-manifest.json` at the package's root, or in the
`syncbridge` field of `package.json` - never both:

```json
{
  "name": "@acme/patient-monitor",
  "dependencies": { "@acme/hl7": "^1.2.0" }
}
```

- `name`: the name the package registers under, when it differs from the
  npm name; optional.
- `dependencies`: the registry packages it uses, with their ranges (see
  [Registry dependencies](#registry-dependencies)).

The built package always has its manifest in `syncbridge-manifest.json`,
never in `package.json`: syncbuild adds what the package brings - each
app, component and plugin (`@syncbridge/plugin-api`) with its
definition, its `exportName` and the module its class is declared in
(`entryPoint`), so a worker loads only its app's and components' code
and the engine's main process only its plugins'. Fields SyncBridge does
not know are passed over with a warning.

## Verifying a package

```bash
spm verify [--profile profiles/] [--with lib-1.2.0.zip] [--keep]
```

`spm verify` checks that SyncBridge can install and load the package,
without SyncBridge: it packs the package, installs the archive into a
sandbox with the engine's own install steps (dependency checks, `pnpm
install`) and, in a worker process with its version plan, loads every
app, component and plugin class and creates each app from a profile.
It exits with 1 when one cannot be, with the reason. A package of
components alone - no app to create - has its classes loaded, unless a
profile of an app using them is given. So does a package of plugins
alone, under Node's permission model with what each plugin declares
(`permissions` in `@Plugin`), as the engine runs each plugin in a process
of its own. So does an app whose default values
are not valid - a required component is to be chosen: it is told as not
created, and creating it takes a profile that chooses its components
(by `uri`), kept with the package, e.g. `verify/*.yml`.

Apps are not initialized or started. What starting needs - a device,
a database, a service - belongs to the environment, and verify cannot tell
a missing one from a broken package. Whether an app works is for the
package's tests ([`@syncbridge/testing`](../testing/README.md)).

It catches what a test in the project cannot: a test resolves modules from
the project's `node_modules`, so a package used without being declared in
`dependencies` works there and fails in SyncBridge. The worker's host
provides only `@syncbridge/common` and the package's peers, as SyncBridge
does, so `spm verify` fails the same way.

Profiles of the package's earlier versions, kept in
`test/profiles/<version>/` (YAML or JSON), are carried to it as
SyncBridge carries them - what its classes declare, then their own
`migrateProfile`, in the worker - and each must then be a valid profile
of it; one that is not fails the verify, telling why.

The worker runs under Node's permission model, as SyncBridge runs it:
native addons and other programs only as the app and its components
declare them (`permissions: [WorkerPermission.NativeCode]`,
`ChildProcesses`). One undeclared fails, telling which to declare.

A profile can use components SyncBridge provides, such as
`@syncbridge/net:TcpClient`: like the engine at its start, verify registers
those packages from the project's `node_modules`, so the project needs
them, as devDependencies at least. A package whose code uses them declares
them in the manifest's `dependencies` (see Registry dependencies), so the
worker loads the one version its plan picks. One that is a package of the
same workspace is packed and installed, as a workspace dependency is; so
is a peer of the same workspace the host provides, its sources not being a
package to load.

npm dependencies that are packages of the same workspace are installed
from the workspace when its version satisfies the range, so a package can
be verified before the release that publishes them. SyncBridge installs
them from the registry.

| Option                 | Description                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--profile <files...>` | Profiles (YAML or JSON) to create, or directories of them; default: each app with its default values                                                                            |
| `--with <archives...>` | Registry packages to install first; otherwise a package of the same workspace is packed and installed as the package is, or the `@sbext/` mirror copy in `node_modules` is used |
| `--timeout <ms>`       | How long creating an app may take (default 30000)                                                                                                                               |
| `--keep`               | Leave the sandbox in place for inspection                                                                                                                                       |

## Building a package

```bash
spm build [-p <dir>] [-o build] [--tsconfig tsconfig-build.json]
spm pack  [-p <dir>] [-o dist]  [--tsconfig tsconfig-build.json]
```

`spm build` writes the package into a directory, `spm pack` into a zip to
upload to SyncBridge. Both first run `spm check`, then:

1. compile the sources with TypeScript: one `.js` and one `.d.ts` per
   source file, nothing bundled. The entry point must compile to
   `index.js` at the root of the output (`rootDir: "src"`);
2. import the output and find its apps, components and plugins, with
   their definitions and modules;
3. put the package's documents in it, each one's README among them -
   see below;
4. write a `package.json` (`dependencies`, `peerDependencies`, and
   `homepage` and `repository` - shown with the package in the registry,
   as on npm) and `syncbridge-manifest.json`: the manifest its author
   wrote, with the apps, components and plugins added.

### Documents

A package is published as a whole, but each of its apps, components
and plugins is a product of its own, with its own page in the
Marketplace and in Console. What it does is told in its README; how its
device is set up, the network it needs, a user guide - in documents
beside it. Its settings and variables are not told there: its page
shows them from its definition - their labels and descriptions, in each
language, are where to explain them. A README tells what they cannot:
how it behaves, its events, an example. All are in `docs/` at the
package's root:

```
docs/
  ModbusGateway/          # the ModbusGateway app's
    README.md             #   its page
    README.tr.md          #   its page in Turkish
    device-setup.md
    network.md
    user-guide.pdf
    images/topology.svg
  guides/                 # the package's own: not named as a class
    installation.md
  images/
```

- **What docs/ takes:** Markdown (`.md`, 256 KB at most), PDF (20 MB)
  and images - `.png`, `.jpg`, `.gif`, `.webp`, `.svg` (5 MB); 50 MB
  together. Names are letters, digits, `.`, `_` and `-`. Hidden files
  (`.DS_Store`) are left out; any other file is refused.
- **Whose:** a directory named as a class (PascalCase) is that app's,
  component's or plugin's; one that no extension of the package has is
  refused - a misspelt name would lose its documents. Everything else is
  the package's own.
- **Languages:** a document's languages share its name. It names no
  language in the package's own - `docsLanguage` in the manifest, `en`
  if not told - and its language before its extension in any other:
  `network.tr.md`, `guide.pt-BR.pdf` (ISO 639-1, its region if any). A
  document may be in another language alone (`user-guide.en.pdf`, a
  maker's manual). The reader is shown theirs, if there is one; else the
  package's own, marked so.
- **Front matter:** a document may tell its `title` (otherwise its first
  heading) and its `order` among the others:

  ```md
  ---
  title: Network
  order: 2
  ---
  ```

- **Links:** a link to a document or an image is from where the document
  is (`network.md`, `../images/map.svg`), and must find it in `docs/`;
  out of the package, `http(s)` and `mailto` alone. HTML is not shown.
- **Sidebar:** how the documents are listed - their order, titles in
  each language (a PDF's too), categories - a `sidebar.json` may tell:
  `docs/sidebar.json` for the package's own, `docs/<ClassName>/sidebar.json`
  for an extension's. A document is named as in the package's own
  language, from where the sidebar is; one not listed is read by a link
  alone. Without one, they are listed by their front matter.

  ```json
  {
    "items": [
      "README.md",
      {
        "doc": "user-guide.pdf",
        "title": { "tr": "Kullanım kılavuzu", "en": "User guide" }
      },
      {
        "label": { "tr": "Ağ", "en": "Network" },
        "items": ["network.md", "firewall.md"]
      }
    ]
  }
  ```

- **Shared:** extensions alike - one device family's - may share
  documents rather than each keep a copy. They are put in a directory
  not named as a class (`docs/shared/`), and each extension's sidebar
  lists those it takes, from where it is: `"../shared/setup.md"`, its
  languages with it. Taken by an extension, a document is that
  extension's - shown on its page, not among the package's own unless
  `docs/sidebar.json` lists it too. Two of five may share one, the
  other three not.

  ```
  docs/
    shared/
      README.md  README.tr.md
      setup.md   setup.tr.md
    GEDash3000/
      sidebar.json      { "items": ["../shared/README.md", "../shared/setup.md"] }
    GEDash4000/
      README.md         # its own page
      sidebar.json      { "items": ["README.md", "../shared/setup.md"] }
  ```

  An extension with no README of its own has the one its sidebar lists as
  its page; a sidebar lists one README at most.

`spm build` and `spm pack` check all of it, every problem told at once,
and put `docs/` in the package at the same paths, each extension's
README path in its definition's `readme` - its own, or the one its
sidebar shares. One with no README is told of,
and packed still; so is an image no document shows, and a document a
sidebar does not list.

The registry takes `docs/` out of the package when it is published: what
SyncBridge installs carries code alone, and its documents are read from
the registry - in the Marketplace, in Console, and linked to from
SyncBridge.

The archive carries no lockfile, and packing needs no registry: SyncBridge
resolves the dependencies' ranges, their peers included, when it installs
the package, and keeps the versions it installed from then on.

Nothing that is not spm's is removed:

- `spm pack` writes `<name>-<version>.zip` into the output directory and
  touches nothing else there - older versions' zips stay;
- `spm build` writes the package into the output directory itself. An
  empty directory, or a previous build of the same package, is used (the
  build emptied first); any other directory is left as it is and the
  build refused - `--clean` empties it anyway;
- the build is made in a directory of spm's own, in the package's `.spm`
  (add it to `.gitignore`) or inside `--temp-dir`, and that alone is
  removed after.

| Option                          | Description                                        | Default         |
| ------------------------------- | -------------------------------------------------- | --------------- |
| `-p, --package-dir <directory>` | Directory of the package                           | `.`             |
| `-o, --out <directory>`         | Output directory                                   | `dist`          |
| `--temp-dir <directory>`        | Directory to make the temp build directory in      | `.spm`          |
| `--tsconfig <fileName>`         | tsconfig file                                      | `tsconfig.json` |
| `--clean`                       | `spm build`: empty an output directory not a build | -               |

### Translations

The names, descriptions and summaries of the apps, components and
plugins, and the labels and descriptions of their settings, are shown in
SyncBridge's UI and the Marketplace in the reader's language. The code
tells them in the package's own language (`docsLanguage`, English unless
told); the others are in `locales/<language>.json` at the package root,
one file a language (`tr.json`, `pt-BR.json`), by class name, settings by
their dotted path:

```json
{
  "HL7Client": {
    "displayName": "HL7 İstemcisi",
    "description": "...",
    "summary": "...",
    "variables": {
      "host": { "label": "Sunucu", "description": "..." },
      "tls.cert": { "label": "Sertifika" }
    }
  }
}
```

An app's or a component's slots (`@UseComponent({ description })`) are
told under `components`, a slot within one by its dotted path:

```json
{
  "Hl7DeviceApp": {
    "components": {
      "hl7Client": { "description": "HL7 istemci bileşeni" },
      "hl7Server.tls": { "description": "TLS" }
    }
  }
}
```

A plugin's name is its `title`. Building takes them into the manifest:
each text becomes text by language (`{ "en": "HL7 Client", "tr": "HL7
İstemcisi" }`). A file not of a language, a class or a setting the
package has not, or a text not text fails the build; what a language
lacks is told as a warning, shown in the package's own language
meanwhile.

A class built on another's takes its texts with `"@extends"`: a class
built on a base class, or a group of settings whose settings are a class
of settings - the package's own (`"IomtBaseApp"`), or one of a registry
dependency (`"@abisena/iomt-common:IomtBaseApp"`):

```json
{
  "GeDashApp": {
    "@extends": "@abisena/iomt-common:IomtBaseApp",
    "displayName": "GE Dash monitörü",
    "variables": {
      "breathChannels": {
        "@extends": "@abisena/iomt-common:TestConfigurationVariables",
        "label": "Nefes kanalları"
      }
    }
  }
}
```

The base's texts come first - all but its name - then the class's own
over them. So a package others build on tells, in its own `locales/`, the
texts of what it exports for them: its abstract apps and components, and
its classes of settings (`"TestConfigurationVariables": { "variables":
{ ... } }`). `locales/` is packed with each `"@extends"` taken in: a
dependency is read from the workspace, or as installed - one built
without it gives no texts, and what it does not give is told as lacking.
An `"@extends"` naming a package not among the manifest's dependencies,
a class the package has not, or going round fails the build.

## Publishing a package

```sh
spm login              # a code to enter in a browser, on any device
spm whoami             # who you are signed in as, and your organizations
spm publish            # packs the package and publishes it
spm publish dist/acme-net-1.2.0.zip --access public
spm logout
```

`spm login` signs in by the device authorization grant: it shows a code
and opens the browser (`--no-browser`: the address alone), and the
sign-in lasts until `spm logout`. It is kept in
`~/.syncbridge/credentials.json` (`SB_CONFIG_DIR`), readable by you
alone. The registry is `--registry`, `SB_REGISTRY_URL`, or
`https://registry.syncbridge.io`.

`spm publish` packs the package (or takes an archive `spm pack` made)
and asks the registry first whether the version may be published - you a
publisher of the package, the version new - before anything large is
sent. Of its documents, a PDF or an image the package's earlier versions
had is not sent again: the archive carries what the registry lacks, and
lists the rest by their SHA-256. A new package is private unless
`--access public` is told; a later version keeps the package's.
`--dry-run` tells what would be sent, sending nothing.
`--skip-existing` skips a version the registry has already instead of
failing: a release publishing each of its packages - most of them
unchanged - is run again safely.

Before it asks, the version is compared with the package's last
published one, as the registry keeps it: what a worker's profile written
for that one cannot be carried across with nothing declared - a class, a
component slot, a setting or a choice gone, a setting or a slot newly
required with no default - refuses a version that is not a major (a 0.x
minor counts as one), and is told in a major. A former name still in use
(`formerly`, `formerlyValues`) is refused in any version. A registry that
cannot be reached, or a package it does not show, is told and not
compared. See [@syncbridge/common](../common/README.md#changing-what-a-profile-holds).

A publish is approved by you, in Console, with your second factor: spm
shows the address (and opens it, unless `--no-browser`), the page shows
what is being published - the package and version, its files, where it
is sent from - and spm sends it once you approve. The approval is for
that content alone, and once: your sign-in alone publishes nothing.

### From GitHub Actions

A workflow publishes with no person and no secret: an owner or admin of
the organization trusts its repository in Console (the organization's
settings, Trusted publishers: a GitHub owner's repositories - all, or
those chosen - optionally only a workflow file, an environment, a ref
like `refs/tags/v*`). The job asks GitHub for its OIDC token, which tells
the registry which repository, workflow and ref it is, and `spm publish`
sends it in place of a sign-in - no approval asked:

```yaml
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # GitHub's OIDC token: who the run is
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx spm publish
```

A package CI published stays with its repository: a later version from
another is refused, unless an admin moves it. Each version tells where it
came from - the repository, commit, workflow and run. In GitHub Actions
spm publishes as the job; `--no-ci` publishes as the signed-in user.

## Registry dependencies

```bash
spm add @vendor/name@^1.2.0
spm check
```

A package that uses another extension package declares it in
the manifest's `dependencies` and imports it as `sb:@vendor/name`. `spm add`
writes that declaration, the `@sbext/vendor__name` devDependency that
carries its types and the tsconfig `paths` entry. `spm check` reports what
is missing or inconsistent among them.

The packages come from the registry's npm mirror, https://npm.syncbridge.io/,
under `@sbext`: `spm add` adds `@sbext:registry=https://npm.syncbridge.io/`
to the workspace's `.npmrc` when it is not there (`SB_NPM_MIRROR` names
another mirror). Public packages need no sign-in.

SyncBridge's own modules - `@syncbridge/builtins`, `@syncbridge/hl7`, ... -
are registry packages too. A server comes with a version of each, and
installs from the registry a newer one a package needs, without an update
of its own. They are imported under their own name, not with `sb:`:
`spm add @syncbridge/builtins@^2.0.0` declares it in the manifest's
`dependencies` and installs the mirror's copy under that name for
development (`"npm:@sbext/syncbridge__builtins@^2.0.0"`); no `paths` entry
is needed. A package that still declares one in `peerDependencies`, as
they once were, installs as if it were in the manifest; `spm add` moves it
there. The SDK itself (`@syncbridge/common`, `runtime`, `syncbuild`,
`testing`, `plugin-api`) comes from npm and is the host's: a peer.

A dependency that is a package of the same workspace - linked into
`node_modules`, not published - needs no `@sbext` copy: `spm add` maps
`sb:@vendor/name` to the declarations its build writes (its tsconfig's
`outDir`), and `sb:` imports resolve to its build, before an `@sbext` copy.
Build it before the package that uses it, as for any project reference.

### pnpm

npm installs flatly: the mirror's copy of a SyncBridge module, installed
under its own name, serves every package that asks for it. pnpm installs
each package with what it declares alone, so a mirror package that names a
module by its own name - `@sbext/syncbridge__hl7` peering on
`@syncbridge/builtins` - would have pnpm look for it on npmjs.org, where it
is not.

In a workspace installed with pnpm (a `pnpm-lock.yaml`, a
`pnpm-workspace.yaml` or `packageManager: "pnpm@..."`), `spm add` sets up
[`@syncbridge/pnpm-config`](../pnpm-config):

- It adds the package as a pnpm config dependency, through `pnpm add
  --config`, into `pnpm-workspace.yaml`. pnpm installs config dependencies
  before anything else.
- It sets `minimumReleaseAge: 0` in `pnpm-workspace.yaml`, unless the
  workspace sets its own: pnpm refuses a config dependency published
  within it (a day by default), so a new `@syncbridge/pnpm-config` could
  not be taken for a day. Only this workspace's setting changes.
- It writes a one-line `.pnpmfile.cjs` at the workspace root that takes
  the package's hooks:

  ```js
  module.exports = require('./node_modules/.pnpm-config/@syncbridge/pnpm-config');
  ```

The package's `readPackage` hook gives every `@sbext` package the modules
it names from the mirror, with the same ranges. Nothing else changes: your
packages keep the ranges in one place, and the modules' own peers
(`hl7v2`, `@sqb/postgres`) install as any peer does; with
`autoInstallPeers`, those your packages declare too. On a fresh clone the
hook is in place before anything is resolved.

- Commit `.pnpmfile.cjs`, `pnpm-workspace.yaml` and the lockfile.
  `spm add` moves the config dependency to the version of the syncbuild
  it runs with; `spm check` reports it missing or older.
- pnpm does not parse an alias whose range has spaces
  (`npm:@sbext/x@>=2.0.1 <3`), so `spm add` writes the same range without
  them (`^2.0.1`).
- If the workspace already has a `.pnpmfile.cjs` of its own, it is kept
  and `spm check` warns. Take the config dependency's hooks from it
  yourself.

## API

```typescript
import { packPackage } from '@syncbridge/syncbuild';

await packPackage({
  packageDir: './my-extension',
  outDir: './dist',
  tsconfig: 'tsconfig-build.json',
  pack: true,
});
```

`checkPackage`, `addDependency` and `verifyPackage` are exported as well.

## Requirements

- Node.js >= 22.15
