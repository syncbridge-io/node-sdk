# Changelog

<!-- rman:documented-up-to 0f1654ca4394b2da66777a3c90f9a2eb35b83421 -->

## @syncbridge/syncbuild@2.11.0 (2026-10-28)

### ✨ Features

- a profile carried across a module's declared changes - common: formerly on @App/@Component (a class renamed, its own and not its base's), @UseComponent (a slot) and @DefineVariable (a setting), formerlyValues on an enum's choices; carryProfile(profile) moves what a profile written for earlier versions holds to the names declared now, drops what is no longer defined and tells each change, no code of the module's run. syncbuild: spm publish compares the version with the package's last published one as the registry keeps it - a class, a slot, a setting or a choice gone with nothing declared, a setting or a slot newly required with no default, refuse a version that is not a major and are told in a major; a former name still in use is refused in any; a registry that cannot tell is told, not compared (d21a0a6)
- a class's translations taken from the class it is built on - in locales/, "@extends": "<ClassName>", or "@vendor/name:<ClassName>" of a registry dependency, on a class (its base's texts, all but its name) or on a group of settings (a class of settings' texts), its own over them; locales/ may tell the texts of the abstract apps and components and the classes of settings the package exports, and is packed with each "@extends" taken in, for the packages built on it; an "@extends" naming a package not among the dependencies, a class the package has not, or going round fails the build (6f9ba1e)

### 🧹 Chores

- update dependencies - @panates/rman-preset 2, pnpm 12.16 (9e74389)

### 💬 General Changes

- Merge branch 'dev' into sdk-carry (8c0066f)

---

## @syncbridge/syncbuild@2.10.0 (2026-10-28)

### ✨ Features

- translations kept out of the code - locales/<language>.json at a package's root, by class name and settings by their dotted path, taken into the manifest as it is built: each name, description and summary of an app, a component or a plugin (its title), each label and description of their settings, becomes text by language, the code's text in the package's own language; a file not of a language, a class or a setting the package has not, a text not text refuse the build, what a language lacks is told; locales/ is not packed. common: an element's displayName and description, a plugin's title and description, are LocalizedText - a text alone is in the package's own language - ExtensionBase.displayName still English, displayNameIn(language) the reader's (a994fcc)

### 🧹 Chores

- update dependencies - pnpm 12.16 (8d40383)

---

## @syncbridge/syncbuild@2.9.0 (2026-10-28)

### ✨ Features

- **pnpm-config,syncbuild:** @syncbridge/pnpm-config, pnpm's config dependency for module repositories - the readPackage hook taking SyncBridge's modules the npm mirror's packages name from the mirror, in a package of its own with no dependencies; spm add adds it with pnpm add --config and writes a .pnpmfile.cjs of one line taking its hooks, so the code stays in the SDK and is in place on a fresh clone before anything is resolved. spm check tells it missing or older than syncbuild's; common counts it in the SDK (0e9c3d1)
- **syncbuild:** spm add turns off pnpm's minimumReleaseAge in the workspace, unless it sets its own - pnpm refuses a config dependency published within it, a new @syncbridge/pnpm-config for a day (9aee055)

---

## @syncbridge/syncbuild@2.8.0 (2026-10-28)

### ✨ Features

- **syncbuild:** SyncBridge's modules in a workspace installed with pnpm - spm add writes a .pnpmfile.cjs whose readPackage hook gives the npm mirror's packages the modules they name (a peer, as they once were, a dependency, or the mirror's own @sbext name) from the mirror, their ranges kept: pnpm no longer looks for @syncbridge/builtins on npmjs.org, and the modules' own peers install as any peer. A module's alias written spaceless (>=2.0.1 <3 as ^2.0.1), as pnpm parses it; spm check tells the hook missing or outdated, and a workspace's own kept (5c121c4)

---

## @syncbridge/syncbuild@2.7.0 (2026-10-27)

### ✨ Features

- **common,syncbuild:** documents shared by modules - a module's sidebar.json lists documents beyond its directory ("../shared/setup.md"), their languages with them; taken by a module they are its, not the package's own; a shared README.md listed is the page of a module with none of its own, one at most (fd40c84)

### 💬 General Changes

- Merge branch 'plugin-permissions' into sdk-release (29cc8ad)
- Merge branch 'docs-shared' into sdk-release (772a0bd)

---

## @syncbridge/syncbuild@2.6.0 (2026-10-26)

### ✨ Features

- **syncbuild:** spm verify checks a package of plugins alone - its classes loaded in a worker from an installation like the engine's, outside the permission model, as the engine runs its plugins in its own process; a plugin that cannot be loaded told with its reason. The runtime's load-only worker loads the plugins' classes with the apps' and components' (ec730f1)

---

## @syncbridge/syncbuild@2.5.1 (2026-10-26)

### 🧹 Chores

- update dependencies (dd8f998)

---

## @syncbridge/syncbuild@2.5.0 (2026-10-23)

### ✨ Features

- **syncbuild:** a package's homepage and repository kept in the package.json it packs (f824d01)

---

## @syncbridge/syncbuild@2.4.3 (2026-10-23)

### 🐛 Bug Fixes

- **syncbuild:** documents named after an abstract class told to go among the package's own - shown nowhere, not "named after no class" (61dde79)

---

## @syncbridge/syncbuild@2.4.2 (2026-10-22)

### 🐛 Bug Fixes

- **syncbuild:** spm init's README no longer lists the app's variables - its page shows them from its definition; the README rule says a README does not repeat them (8be2dbd)

### 🧹 Chores

- update dependencies (cf150e4)

---

## @syncbridge/syncbuild@2.4.1 (2026-10-21)

### ⚡ Performance and Optimizations

- **syncbuild:** spm verify takes npm dependencies from one pnpm store, kept between verifies (SB_SPM_STORE_DIR, else ~/.cache/syncbridge/pnpm-store; --store-dir) - a workspace verifying its packages side by side downloaded the same ones into a store of each sandbox (234ecd5)

---

## @syncbridge/syncbuild@2.4.0 (2026-10-21)

### ✨ Features

- **common:** a setting's label and description by language - { en: '...', tr: '...' }, as a module's summary is - shown in the reader's language, else English; textIn picks it, spm checks the languages told (b8add25)

### 🐛 Bug Fixes

- **syncbuild:** an abstract app or component left out of the manifest - a base of others, never run nor offered in the Marketplace, so asked for no summary nor README (a17cf9f)

---

## @syncbridge/syncbuild@2.3.0 (2026-10-21)

### ✨ Features

- **syncbuild:** the modules SyncBridge ships with every server added as the host's - spm add @syncbridge/builtins declares it in peerDependencies, imported under its own name, and installs the npm mirror's copy under that name (npm:@sbext/...); spm add sends @sbext to the mirror in the workspace's .npmrc; spm check reports one declared as a registry dependency or imported by sb:, a peer with no copy to develop against, and the mirror not configured (9d8e43e)

---

## @syncbridge/syncbuild@2.2.0 (2026-10-21)

### ✨ Features

- **syncbuild:** spm view - a package's published versions, as its publisher would see them (a GitHub Actions job by its OIDC token, else the signed-in user, else anybody), --json for tools; spm publish --no-wait fails at once (exit code 3) rather than waits on a Console approval (cbc10bc)

---

## @syncbridge/syncbuild@2.1.0 (2026-10-20)

### ✨ Features

- **syncbuild:** spm's default registry is https://registry.syncbridge.io - the SyncBridge Registry API's own address now that it is apart from Console's (api.syncbridge.io); its CI runs' OIDC audience with it (8415afd)

---

## @syncbridge/syncbuild@2.0.0 (2026-10-19)

### ✨ Features

- plugins, which extend SyncBridge in its main process (d58d5ce)
- test fixtures, and a guide to migrate packages (f070e3f)
- the app's logs in the worker's log view, and a details field for records (6ca4521)
- components' traffic logged when turned on, by the events picked (cabd140)
- a log channel's settings from the Logs tab, and warnings of wrong ones (c1a81ed)
- an IO client's connects and disconnects tell what it connects to (97d3e60)
- each applet, component and plugin a README of its own - docs/<ClassName>.md put in the package by spm, its path in the definition; one without told of, a misspelt one refused (f7dfbc7)
- **spm:** a package's documents - docs/ whole, in languages, its links checked (bcc8a2f)
- **docs:** sidebar.json tells how a package's documents are listed; a document may be in another language alone (60663df)
- **spm:** login, logout, whoami - signed in by the device authorization grant (cdea02a)
- **spm:** publish - asked first, then only what the registry lacks (f667ea0)
- **spm:** publish approved in Console - asked for, waited for, sent under it (02ffb96)
- **spm:** publish from GitHub Actions - the job's OIDC token, no sign-in, no approval (0540196)
- **registry:** how a module is found in the Marketplace - its summary, functions, connections, screenshots (cce9fb1)
- **common,engine,syncbuild:** Node's permission model holds an isolated worker - reading its code, installation, plan and data, writing its data alone; native addons and other programs only as declared (native-code, child-processes), worker threads never; spm verify runs a module under it, telling what it failed to declare (e7f6781)
- **runtime,syncbuild:** spm verify loads a package of components alone - its classes, in a worker under the permission model as they declare; a provided package of the same workspace is packed and installed, one that cannot be resolved told so (d749c0b)
- **syncbuild:** spm verify packs a peer of the same workspace the host provides rather than linking its sources; an app whose default values are not valid is loaded, told as not created, its profile to choose its components (d1012e9)
- **cloud,syncbuild:** a version published already is refused with code VERSION_PUBLISHED; spm publish --skip-existing skips it rather than failing, so a release is run again safely (89e0355)

### 🐛 Bug Fixes

- **syncbuild:** spm removes nothing that is not its own (ca6691d)
- **syncbuild:** spm verify points the peers of a host copy it installed at the host's - pnpm gave it registry copies of its own, which shadowed them (375e42f)

### 🔧 Refactoring

- an extension's README in a directory of its own - docs/<ClassName>/README.md, kept at the same path in the package, so what it links to is found from where it is (7cbf635)
- applets are apps - @App, AppBase, AppMetadata, the manifest's "apps", classType "app"; SyncBridge itself the engine to its plugins (host.engine, engine-started) (5bc768e)
- **common:** a module tells its summary and screenshots alone - where it is shown is the registry's (4b3ca34)

### 💬 General Changes

- **syncbuild:** spm runs in this checkout (b9e22ac)

---

## @syncbridge/syncbuild@1.0.4 (2026-10-12)

### 🐛 Bug Fixes

- drop the manifest version, one package layout only (5f5badd)
- workspace dependencies, no package lockfile, verify loads only (b3a4af4)
- spm verify registers what the profile uses, several profiles (7265320)

---

## @syncbridge/syncbuild@1.0.0 (2026-10-10)

### 🧹 Chores

- depend on the 1.0 @syncbridge packages in the app, cloud services and spm init (516d819)

---

## @syncbridge/syncbuild@0.14.0 (2026-10-10)

### ✨ Features

- **syncbuild:** spm init creates a package with its first test (a7c5d95)
- **syncbuild:** unbundled packages, spm add/check and a register hook (ac368e7)
- **syncbuild:** spm check reports a package depending on itself (9649ea8)
- **syncbuild:** spm check refuses the npm mirror's copies as runtime dependencies (8ea2bc3)
- **syncbuild:** spm verify installs a package as SyncBridge does and starts it (8ce2d4d)

### 🐛 Bug Fixes

- **syncbuild:** spm build of a v2 package writes into the output directory itself (60f5e83)

### 🧪 Tests

- **syncbuild:** spm verify tests use @syncbridge/common's sources, not its build (5701569)

---

## @syncbridge/syncbuild@0.13.11 (2026-10-08)

### 🐛 Bug Fixes

- **syncbuild:** spm build writes into the output directory itself (b80fad8)
- **syncbuild:** spm exits with 1 when a build fails (fa2ad1d)
- **syncbuild:** say what to fix when a build fails, without the stack (4befdf5)

---

## @syncbridge/syncbuild@0.13.8 (2026-10-06)

### 🧹 Chores

- version every package independently (8f9dc3b)
