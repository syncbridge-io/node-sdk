# Changelog

## @syncbridge/plugin-api@2.0.0 (2026-10-19)

### ✨ Features

- plugins, which extend SyncBridge in its main process (d58d5ce)
- the app's logs in the worker's log view, and a details field for records (6ca4521)

### 🔧 Refactoring

- applets are apps - @App, AppBase, AppMetadata, the manifest's "apps", classType "app"; SyncBridge itself the engine to its plugins (host.engine, engine-started) (5bc768e)
