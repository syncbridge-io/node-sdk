# Changelog

<!-- rman:documented-up-to f813a9862f12ca77eb5067c7eb414f3046e2f0f1 -->

## @syncbridge/plugin-api@2.4.0 (2026-10-31)

### ✨ Features

- **plugin-api:** host.ui.registerWidgetType adds a kind of dashboard widget, a template of the web UI's primitives bound to the widget's properties and data - nothing of the plugin's code in the browser - its id <plugin>.<name>@<version>, one given again replacing it, what removes it returned and undone as the plugin is deactivated; common ^2.15.0, of the dashboards (423cc05)

### 🐛 Bug Fixes

- **plugin-api:** common ^2.14.0 as its peer for now - the workspace's version, the releases keeping the ranges they find; moved to ^2.15.0 once common's dashboards are published (d8c21e5)

### 📚 Documentation

- dashboards for module and plugin authors - common's README a DashboardBase of sections and widgets given with @UseDashboard, the four kinds of data and their writers, the bounds, writes checked where made and gathered, all in memory, widgets defined as the worker runs, a plugin's type by id; plugin-api's README registerWidgetType, its template's bindings by the data's kind, versions, what is refused (401655a)

---

## @syncbridge/plugin-api@2.3.0 (2026-10-28)

### ✨ Features

- **plugin-api:** lifecycle hooks and UI contributions - install once per version (its data copied first, put back on failure or going back), uninstall as its package is removed, settingsChanged taken live or restarted alone, checkSettings before they are saved; host.ui.contribute to twelve named points of the UI, each with its component (menu-item, button, nav-item, badge, card), its properties, a declarative when over the point's filters, resolve and run, host.ui.refresh (454464a)

---

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
