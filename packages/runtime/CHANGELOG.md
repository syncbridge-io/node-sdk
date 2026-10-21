# Changelog

<!-- rman:documented-up-to ffbc6d88d7995850ffca3bc97080890e7e937d5f -->

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
