# Changelog

<!-- rman:documented-up-to 153cdb3c25fb5b48cd899442280a606eebd44b62 -->

## @syncbridge/runtime@2.6.1 (2026-11-01)

### 🐛 Bug Fixes

- **runtime:** a write to the worker's own pipes still on its way is not its app's left open (46e897a)

---

## @syncbridge/runtime@2.6.0 (2026-11-01)

### ✨ Features

- **dashboards:** tone, hint and attention written by the worker (57f48d3)

---

## @syncbridge/runtime@2.5.0 (2026-10-31)

### ✨ Features

- **runtime:** AppWorker ticks its app's chart counts - one timer a worker, each second writing the counts whose interval ended as points, started with the app and stopped with it, what is left counted written as it stops; components carry no timer (d350a87)

---

## @syncbridge/runtime@2.4.0 (2026-10-31)

### ✨ Features

- **runtime:** AppWorker's dashboardSink takes a worker's dashboard writes gathered by a DashboardCoalescer - a value set many times as its last, a series' points and a feed's rows together under their bounds, a table's rows as each one's last change, a clear or a replace dropping what came before, widgets defined first - sent at most once an interval (dashboardInterval, default 1 s, at least 250 ms) and at the stop (547624f)

---

## @syncbridge/runtime@2.3.2 (2026-10-30)

### 🐛 Bug Fixes

- **runtime:** a version installed again from another archive is installed again for its workers - extractPackage writes the archive's SHA-256 into the package (.sb-install), carried to its install directory, and planDigest counts it beside the version; the same archive again changes nothing. Before, the digest held names and versions alone, so a worker or a plugin went on running the replaced version's code from its deps-<digest> copy. A package installed before this has no stamp and keeps its digest: no installation is redone for it (80a6401)

---

## @syncbridge/runtime@2.3.1 (2026-10-28)

### 🐛 Bug Fixes

- **runtime:** a worker whose common is older than 2.10 loads again - runProfileMigrations taken as a migration is asked, not imported with the worker: its module's imports of @syncbridge/common resolve to the host's, the package's own, and an older one has it not (spm verify failed at once for every package on common 2.3); one asked to migrate on an older common is told so (2b90d8b)

---

## @syncbridge/runtime@2.2.0 (2026-10-27)

### 🧪 Tests

- **runtime:** a SyncBridge module a package declared as a peer planned at a newer version installed than the server's, not shared from the host (c38d7d3)

---

## @syncbridge/runtime@2.1.0 (2026-10-26)

### ✨ Features

- **syncbuild:** spm verify checks a package of plugins alone - its classes loaded in a worker from an installation like the engine's, outside the permission model, as the engine runs its plugins in its own process; a plugin that cannot be loaded told with its reason. The runtime's load-only worker loads the plugins' classes with the apps' and components' (ec730f1)

---

## @syncbridge/runtime@2.0.2 (2026-10-21)

### 🐛 Bug Fixes

- **runtime:** a package's own peers - the host's - not given to pnpm when its dependencies are installed: auto-install-peers fetched them from npm, where a registry package is not (a module peering @syncbridge/builtins 2 failed to install, spm verify and the engine alike), and installed copies no one loaded (f2b4c95)

---

## @syncbridge/runtime@2.0.1 (2026-10-19)

### 🐛 Bug Fixes

- **runtime:** a worker ends as soon as its app has stopped - what the app left open is logged as a warning, not waited for; endWorker and resourcesLeft, for the engine's worker too (5874ff1)
- **runtime:** a worker ends as soon as its last message is delivered - not after a fixed 250 ms; an 'ended' message marks it, which hosts ignore (cb26055)

---

## @syncbridge/runtime@2.0.0 (2026-10-19)

### ✨ Features

- worker init - install a worker's packages together (113339e)
- worker log channels (83374f6)
- plugins, which extend SyncBridge in its main process (d58d5ce)
- **runtime:** an installation linked to another host is linked anew (e073b30)
- **runtime,syncbuild:** spm verify loads a package of components alone - its classes, in a worker under the permission model as they declare; a provided package of the same workspace is packed and installed, one that cannot be resolved told so (d749c0b)

### 🐛 Bug Fixes

- **runtime:** a worker's install follows its plan where CI is set (2a8941c)
- **runtime:** a worker ends when its host is gone (83c053f)

### 🔧 Refactoring

- applets are apps - @App, AppBase, AppMetadata, the manifest's "apps", classType "app"; SyncBridge itself the engine to its plugins (host.engine, engine-started) (5bc768e)

---

## @syncbridge/runtime@1.1.1 (2026-10-12)

### 🐛 Bug Fixes

- drop the manifest version, one package layout only (5f5badd)
- workspace dependencies, no package lockfile, verify loads only (b3a4af4)
- spm verify registers what the profile uses, several profiles (7265320)

---

## @syncbridge/runtime@1.1.0 (2026-10-11)

### ✨ Features

- **runtime:** ProcessorWorker, the processor-running core of a worker (2241b19)

---

## @syncbridge/runtime@0.2.0 (2026-10-10)

### ✨ Features

- **runtime:** install and run extension packages from @syncbridge/runtime (f6cbf7d)
