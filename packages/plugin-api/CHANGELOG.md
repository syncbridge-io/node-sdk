# Changelog

<!-- rman:documented-up-to 67c2d6ca886b9d0793f951d58fb7d79a79a24d52 -->

## @syncbridge/plugin-api@2.1.0 (2026-10-26)

### ✨ Features

- **plugin-api:** plugins that talk to the user - host.status, how a plugin is doing; host.ui.ask, a question to the admins answered once and kept; host.ui.registerAction, buttons of its own; host.workers.addEnvironment, what every worker starts with - a native library's directory. Drawn by SyncBridge: nothing of a plugin runs in the browser (458ae3f)

---

## @syncbridge/plugin-api@2.0.0 (2026-10-19)

### ✨ Features

- plugins, which extend SyncBridge in its main process (d58d5ce)
- the app's logs in the worker's log view, and a details field for records (6ca4521)

### 🔧 Refactoring

- applets are apps - @App, AppBase, AppMetadata, the manifest's "apps", classType "app"; SyncBridge itself the engine to its plugins (host.engine, engine-started) (5bc768e)
