# Changelog

<!-- rman:documented-up-to 51bc4f79b27c9c175a8b233b98c7607429da9fd1 -->

## @syncbridge/common@2.3.0 (2026-10-24)

### ✨ Features

- **common:** a host's packages' updates asked in one call - to check, of each version it has, the newest of its minor and of its major and a newer major; to install, the very versions it takes, each with a short-lived grant to read it (48030b2)

---

## @syncbridge/common@2.2.0 (2026-10-23)

### ✨ Features

- **common:** the permissions inside a host - HostPermission, the roles as their sets, and the header Console passes them on with (85e109b)

---

## @syncbridge/common@2.1.0 (2026-10-21)

### ✨ Features

- **common:** a setting's label and description by language - { en: '...', tr: '...' }, as a module's summary is - shown in the reader's language, else English; textIn picks it, spm checks the languages told (b8add25)

---

## @syncbridge/common@2.0.1 (2026-10-19)

### 🐛 Bug Fixes

- **runtime:** a worker ends as soon as its app has stopped - what the app left open is logged as a warning, not waited for; endWorker and resourcesLeft, for the engine's worker too (5874ff1)

### 📚 Documentation

- **common:** a README - components, apps, variables, lifecycle, log channels and permissions, with examples (863f51f)

---

## @syncbridge/common@2.0.0 (2026-10-19)

### ✨ Features

- worker init - install a worker's packages together (113339e)
- worker log channels (83374f6)
- log time ranges, size-limited downloads, server-zone times (5499146)
- the log store and log targets, set apart in the config (1c4a0e2)
- plugins, which extend SyncBridge in its main process (d58d5ce)
- settings changed from the settings window (352b799)
- the app's logs in the worker's log view, and a details field for records (6ca4521)
- components' traffic logged when turned on, by the events picked (cabd140)
- a log channel's settings from the Logs tab, and warnings of wrong ones (c1a81ed)
- SyncBridge Cloud's workspaces, apart from the registry (ddcff2c)
- a host's identity - its own key pair, short-lived signed tokens, pairing codes (86d6151)
- hosts paired once by a code, then known by keys of their own (cb02958)
- each applet, component and plugin a README of its own - docs/<ClassName>.md put in the package by spm, its path in the definition; one without told of, a misspelt one refused (f7dfbc7)
- **spm:** a package's documents - docs/ whole, in languages, its links checked (bcc8a2f)
- **docs:** sidebar.json tells how a package's documents are listed; a document may be in another language alone (60663df)
- **registry:** a publish told before it is sent, and sending only what the package lacks (eba202b)
- **registry:** a person's publish approved in Console with a second factor - publish requests (22388bb)
- **registry:** how a module is found in the Marketplace - its summary, functions, connections, screenshots (cce9fb1)
- **common:** what a host and Console tell of its workers' profiles to keep them; a key pair to seal for drawn from a secret (e1a1393)
- **engine:** its workers' configurations told Console - all as the link comes up, each as it changes; their secrets opened here and sealed for Console (f5bbe60)
- **console:** a host's plan to install a registry package - its version and what it needs, its workspace's to download alone, each with its hash and a short-lived link, access asked again as it is read (9d0a099)
- **console:** a host reinstalled takes its workers back - a new pairing code, none forgotten until it tried each; their secrets sealed for its new key, the version of their package told; where each is kept (a1c7865)
- **common,engine:** an enum variable's values that depend on the server are a source - serial-ports, network-addresses - filled in by the engine as the UI asks, never at a module's import nor when it is packed; Runnable._restart() stops and starts in place, a stop meanwhile aborting it (66c920b)
- **common,engine,web-ui:** a worker's permissions - what of the server it reaches beyond its own directory, as its app and components declare (serial-ports: the dialout group); a subclass has its base's; told in its state and shown on its page (a7b35ef)
- **common,engine,syncbuild:** Node's permission model holds an isolated worker - reading its code, installation, plan and data, writing its data alone; native addons and other programs only as declared (native-code, child-processes), worker threads never; spm verify runs a module under it, telling what it failed to declare (e7f6781)

### 🐛 Bug Fixes

- a missing required value is told as required (18f0863)
- **common:** a secret value already encrypted read by its text, not its prefix; values sealed for one host (X25519, HKDF, AES-GCM) (04fdc73)

### 🔧 Refactoring

- an extension's README in a directory of its own - docs/<ClassName>/README.md, kept at the same path in the package, so what it links to is found from where it is (7cbf635)
- applets are apps - @App, AppBase, AppMetadata, the manifest's "apps", classType "app"; SyncBridge itself the engine to its plugins (host.engine, engine-started) (5bc768e)
- **common:** a module tells its summary and screenshots alone - where it is shown is the registry's (4b3ca34)

---

## @syncbridge/common@1.1.4 (2026-10-12)

### 🐛 Bug Fixes

- drop the manifest version, one package layout only (5f5badd)

---

## @syncbridge/common@1.1.2 (2026-10-12)

### 🐛 Bug Fixes

- build again after the dependency update (63e8889)

### 💬 General Changes

- Merge branch 'main' into dev: the release commits (6dc683a)

---

## @syncbridge/common@1.1.0 (2026-10-11)

### ✨ Features

- **common:** enumStrict, an enum whose listed values are suggestions (834a7ea)

---

## @syncbridge/common@1.0.0 (2026-10-10)

### ✨ Features

- **common:** ExtensionRegistry.current and use() to work with a registry of one's own (631e2e9)

---

## @syncbridge/common@0.14.2 (2026-10-10)

### 🐛 Bug Fixes

- **common:** value rules no longer drop a variable's default, type and required (719cf7b)

---

## @syncbridge/common@0.14.0 (2026-10-08)

### ✨ Features

- **common:** registry names, sbext mapping and the package manifest (237cabb)

### 🐛 Bug Fixes

- load the processor version the profile asks for (189e6f8)
- **common:** give components the registry name of their package (25b2417)

---

## @syncbridge/common@0.13.8 (2026-10-06)

### 🧹 Chores

- version every package independently (8f9dc3b)
