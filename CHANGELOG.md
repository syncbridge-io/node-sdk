# Changelog

<!-- rman:documented-up-to d538e84ec2754227729aa97ea56d63442277efb1 -->

## v2026.10.31-1700 (2026-10-31)

### 🧹 Chores

- sync lockfile [skip ci] (7909a61)

---

## v2026.10.31-1458 (2026-10-31)

### 🧹 Chores

- sync lockfile [skip ci] (d79eef3)
- @swc/core 1.16.21 (90a29bb)

---

## v2026.10.30-2327 (2026-10-30)

### 🧹 Chores

- sync lockfile [skip ci] (7c0691a)

---

## v2026.10.30-1203 (2026-10-30)

### 🧹 Chores

- sync lockfile [skip ci] (465a8c7)

---

## v2026.10.30-1023 (2026-10-30)

### 🧹 Chores

- sync lockfile [skip ci] (1d1350d)
- update dependencies (777918b)

---

## v2026.10.29-2126 (2026-10-29)

### 🧹 Chores

- sync lockfile [skip ci] (d1e44f1)

---

## v2026.10.29-1948 (2026-10-29)

### 🧹 Chores

- sync lockfile [skip ci] (77d010a)

---

## v2026.10.29-1809 (2026-10-29)

### 🧹 Chores

- sync lockfile [skip ci] (60d3e40)

---

## v2026.10.28-2216 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (3d40704)

---

## v2026.10.28-2142 (2026-10-28)

### ✨ Features

- a class carrying its own values from its earlier versions - common: @App.MigrateProfile() / @Component.MigrateProfile() mark a static method (staticEvents.migrateProfile, components' too), given a ProfileMigration ({ values, from, to, path }) and answering the values; profileMigrations(profile) tells the classes to run, runProfileMigrations runs them, a sealed secret moved or dropped, never made; carryProfile keeps what a migrating class no longer defines, for it to read. runtime: a worker sent "migrate" runs them, its plan's packages registered, nothing created. testing: migrateProfileTo(profile) carries and checks one in the test's process. syncbuild: spm verify carries the profiles of test/profiles/<version>/ to the package, in a worker, and checks them (5e3a0a5)

### 📚 Documentation

- the modules repository is syncbridge-io/syncbridge-extensions, renamed from public-modules (287d3f2)

### 🧹 Chores

- sync lockfile [skip ci] (6d0b726)
- update dependencies - @panates/rman-preset 2, pnpm 12.16 (9e74389)
- update dependencies - @types/node 26.6.6, valgen 7.0.6 (dcc258b)

### 💬 General Changes

- Merge branch 'sdk-locales-extends' into dev (b9562e8)

---

## v2026.10.28-1531 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (51010bd)
- update dependencies - pnpm 12.16 (8d40383)

---

## v2026.10.28-1404 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (39001dd)

---

## v2026.10.28-1248 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (0175529)

---

## v2026.10.28-1152 (2026-10-28)

### ✨ Features

- **pnpm-config,syncbuild:** @syncbridge/pnpm-config, pnpm's config dependency for module repositories - the readPackage hook taking SyncBridge's modules the npm mirror's packages name from the mirror, in a package of its own with no dependencies; spm add adds it with pnpm add --config and writes a .pnpmfile.cjs of one line taking its hooks, so the code stays in the SDK and is in place on a fresh clone before anything is resolved. spm check tells it missing or older than syncbuild's; common counts it in the SDK (0e9c3d1)

### 🧹 Chores

- sync lockfile [skip ci] (fd9d68d)

---

## v2026.10.28-944 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (30af829)

---

## v2026.10.28-859 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (9b3b46a)

---

## v2026.10.28-824 (2026-10-28)

### 🧹 Chores

- sync lockfile [skip ci] (d79cbea)

---

## v2026.10.27-1450 (2026-10-27)

### ✨ Features

- plugins declare what they reach - `permissions` and `hosts` in @Plugin (PluginPermission: worker-environment, log-records, workers, network, child-processes, native-code), shown to the server's admins and given once they approve it. syncbuild writes them into the manifest; spm verify loads a plugin under Node's permission model with what it declares, telling what it failed to declare (d397bb0)
- SyncBridge's modules registry packages like any other - a server comes with a version of @syncbridge/builtins, hl7, sqb..., and installs from the registry a newer one a package needs, no update of its own asked. Declared in the manifest's dependencies, imported under their own name: the loader takes @syncbridge/builtins to the version the worker's plan picked, as it does sb:. A package that still declares one as a peer installs as if it were in its manifest; spm add moves it there, spm check tells it. The SDK alone the host's peers (a6067d0)

### 🧹 Chores

- sync lockfile [skip ci] (75b5533)

---

## v2026.10.26-1456 (2026-10-26)

### 🧹 Chores

- sync lockfile [skip ci] (84ce65e)
- update dependencies (1fc7aa5)

---

## v2026.10.26-816 (2026-10-26)

### 🧹 Chores

- sync lockfile [skip ci] (197276e)
- update dependencies (dd8f998)

---

## v2026.10.24-1603 (2026-10-24)

### 🧹 Chores

- sync lockfile (bba54ea)

---

## v2026.10.23-1255 (2026-10-23)

### 🧹 Chores

- sync lockfile (b16aa92)

---

## v2026.10.23-1039 (2026-10-23)

### 🧹 Chores

- sync lockfile (5206319)

---

## v2026.10.23-800 (2026-10-23)

### 🧹 Chores

- sync lockfile (6412637)

---

## v2026.10.22-1210 (2026-10-22)

### 🧹 Chores

- sync lockfile (b0971dc)
- update dependencies (cf150e4)

---

## v2026.10.21-2232 (2026-10-21)

### 🧹 Chores

- sync lockfile (cd007ab)

---

## v2026.10.21-2207 (2026-10-21)

### 🧹 Chores

- sync lockfile (27caca8)

---

## v2026.10.21-2045 (2026-10-21)

### 🧹 Chores

- sync lockfile (fa397a7)

---

## v2026.10.21-1533 (2026-10-21)

### 🧹 Chores

- sync lockfile (32214de)

---

## v2026.10.21-1316 (2026-10-21)

### 🧹 Chores

- sync lockfile (6c462c8)
- **ci:** a manual release run may skip the tests (skip-tests), as the other repositories' - the release then runs with the test job skipped (640f04d)
- @opra/common 1.33.0, @panates/eslint-config(-ts) 2.3.3, @panates/rman-preset 1.12.1 - the lockfile with them (bc5087c)

---

## v2026.10.20-1135 (2026-10-20)

### 📚 Documentation

- the platform repository is syncbridge-io/syncbridge, at ~/dev/syncbridge/syncbridge - renamed from syncbridge-cloud (19ed8c0)

### 🧹 Chores

- sync lockfile (66f5200)

---

## v2026.10.19-1816 (2026-10-19)

### 📚 Documentation

- the platform repository is at ~/dev/syncbridge/cloud [no-release] (4c255b3)

### 🤖 Continuous Integration

- remove redundant Quality Check workflow (642226a)

### 🧹 Chores

- the SyncBridge Node.js SDK - @syncbridge/common, runtime, syncbuild, testing and plugin-api at 2.0.0, moved out of the platform repository [no-release] (4bbb280)

### 💬 General Changes

- Initial commit (15c67b8)
- graphify's output and Claude's state are not the repository's - ignored by git and prettier (3920d82)
