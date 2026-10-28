# Changelog

<!-- rman:documented-up-to d5bd3cc3d819a178b2be0f56d71910f807b30981 -->

## @syncbridge/testing@2.1.0 (2026-10-27)

### ✨ Features

- **common:** a component slot of one of several kinds - @UseComponent({ oneOf: [HL7Client, HL7Server], required: true }), each a class or its uri; its metadata's oneOf, interfaceUri the first for what reads that alone; a class of any of them taken, another refused naming them all; slotInterfaces and slotTakes tell it. testing asks which one a test means (5376d24)

---

## @syncbridge/testing@2.0.0 (2026-10-19)

### ✨ Features

- log component traffic to communication channels (c8ac186)
- test fixtures, and a guide to migrate packages (f070e3f)
- the app's logs in the worker's log view, and a details field for records (6ca4521)
- components' traffic logged when turned on, by the events picked (cabd140)
- an IO client's connects and disconnects tell what it connects to (97d3e60)

### 🔧 Refactoring

- the extension packages in packages/extensions (669a212)
- applets are apps - @App, AppBase, AppMetadata, the manifest's "apps", classType "app"; SyncBridge itself the engine to its plugins (host.engine, engine-started) (5bc768e)
- the SyncBridge modules (builtins, net, hl7, kafka, redis, sqb, serialport, ngrok, pinggy) moved to their own open source repository, syncbridge-public-modules; testing's virtual network and serial tests with them, its own tests on fixtures of their own (c4f16dd)

---

## @syncbridge/testing@1.1.0 (2026-10-11)

### ✨ Features

- **common:** enumStrict, an enum whose listed values are suggestions (834a7ea)

---

## @syncbridge/testing@1.0.0 (2026-10-10)

### ✨ Features

- **testing:** virtual serial ports for tests (a1d6278)
- **common:** ExtensionRegistry.current and use() to work with a registry of one's own (631e2e9)
- **testing:** type profile options from the processor class (2b0e88b)

---

## @syncbridge/testing@0.3.0 (2026-10-09)

### ✨ Features

- **testing:** mock protected methods (27f62a2)

---

## @syncbridge/testing@0.2.0 (2026-10-09)

### ✨ Features

- **testing:** a virtual network, connections to components and replay (a78576f)

---

## @syncbridge/testing@0.1.0 (2026-10-09)

### ✨ Features

- **testing:** a test environment for extension packages (7cba964)

### 🧹 Chores

- rman 2.22.0, and @syncbridge/testing starts at 0.1.0 (f465201)
