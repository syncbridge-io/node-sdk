# Changelog

<!-- rman:documented-up-to 9a529577bf206212d0345c4b937f689ec920c9b8 -->

## @syncbridge/common@2.20.0 (2026-11-01)

### ✨ Features

- **dashboards:** tone, hint and attention written by the worker (57f48d3)

### 🧪 Tests

- **dashboards:** a count's interval begins at its first add, not the test's start (8f0d6af)

---

## @syncbridge/common@2.19.0 (2026-10-31)

### ✨ Features

- **common:** a card's least width - Widget.Cards' cardWidth s, m or l - for a card of several values side by side (53e9408)

### 🐛 Bug Fixes

- **common:** a profile's values coded by its components' versions the worker loads (componentVersion, the worker's plan's) - a setting only a newer version has was dropped; an ignored setting with no default left out, not set to its validator (a81bd7f)

---

## @syncbridge/common@2.18.1 (2026-10-31)

### 🐛 Bug Fixes

- **common:** a worker's metadata takes its components at the version it loads - told by componentVersion (the worker's plan's), else a component of the app's package at the app's version - not the first of several registered: their dashboards, settings and channels were an older version's (4a82fcf)

---

## @syncbridge/common@2.18.0 (2026-10-31)

### ✨ Features

- **common:** dashboard texts by language (ceeb105)

---

## @syncbridge/common@2.17.0 (2026-10-31)

### ✨ Features

- **common:** components' dashboard widgets shown where their app takes them (c256717)

---

## @syncbridge/common@2.16.0 (2026-10-31)

### ✨ Features

- **common:** a chart counts - Widget.Chart's count(series, amount) adds to a sum kept in the worker (DashboardCounters), written as one point each interval (the chart's interval, '1s' unless told, 1 s to 1 h): 0 for an interval with none once the series was counted, intervals missed as the first one and a 0 at the last, what is left written and forgotten at a stop; a clear or an undefine drops its counts. A busy source counts each event and sends a point a second. AppOptions.dashboardCounters; widgetIssues checks an interval (1af8e13)

---

## @syncbridge/common@2.15.0 (2026-10-31)

### ✨ Features

- **common:** worker dashboards - a DashboardBase class holds a dashboard's sections (@DashboardSections) and widgets (@Widget), and an app or component gives itself one with @UseDashboard on a property of that class, several properties several dashboards. A widget holds its data, of one of four kinds (value, series, table, feed) whatever its type: Widget.Stat, Status, Gauge, Progress, Chart (line, area, bar, stacked; a window of 200 points unless told), Feed, Table, Cards (a template of primitives, no code), Bars, Pie, or a plugin's type by id. The writers a widget property holds check each write against its kind and the bounds where it is made, refusing it in the element's log, and hand it to the worker's dashboard sink; DashboardBase.define adds a widget as the worker runs into a dynamic section, returning its writer. The core types' schemas and widgetIssues/templateIssues check a definition; dashboards are in an element's metadata (materialized for components), the hidden paths in a profile's settings.dashboard (4a9c5bf)
- **common:** a widget type checked whole - widgetTypeIssues tells what is wrong with its name and version, its data's kinds, its properties' schemas and a template type's tree; a template's node may bind data.<name> too, to the scopes it is drawn with (templateScopes: a value or a series once, as data.value or data.<series>; a table or a feed for each row, as row.<field>; prop.<name> always), an app's cards binding their row and properties alone (2594269)

### 📚 Documentation

- dashboards for module and plugin authors - common's README a DashboardBase of sections and widgets given with @UseDashboard, the four kinds of data and their writers, the bounds, writes checked where made and gathered, all in memory, widgets defined as the worker runs, a plugin's type by id; plugin-api's README registerWidgetType, its template's bindings by the data's kind, versions, what is refused (401655a)

---

## @syncbridge/common@2.14.0 (2026-10-30)

### ✨ Features

- **common:** EngineProvides - what an engine provides a package as its peers, by npm name at its version; hostPeerProblems tells what a host lacks of a package's peers in SyncBridge's own words ("The host does not provide ..."), for spm and the registry to refuse it as a server would (f84144b)

### 🧹 Chores

- update dependencies (777918b)

---

## @syncbridge/common@2.13.1 (2026-10-29)

### 🐛 Bug Fixes

- **common:** a slot redeclared without a description keeps its base's - with the texts its locales give it; one told, its own (abd7ed5)

---

## @syncbridge/common@2.13.0 (2026-10-29)

### ✨ Features

- **common:** what of a host's packages is in use, counted alone - HostStatusMessage tells usage: each installed version of each package and how many workers take it (0 for none), and the plugins running by their package; summarizeUsage counts it. No worker named, nothing of their configurations: a package's statistics, for its publisher in Console (a2d42fe)
- **common:** a host's usage told as Console takes it - one map, a package's registry name then its version, each { workers, plugin? }; what did not come from the registry left out (SyncBridge's own modules, local, linked, a file installed); MAX_USAGE_VERSIONS (500) versions at most (edd0ff7)

---

## @syncbridge/common@2.12.0 (2026-10-29)

### ✨ Features

- a component slot's description told by language - common: ElementComponentMetadata.description is LocalizedText (a text alone in the package's own language), slotTextProblems checks one; syncbuild: locales/ tells a class's slots under "components", a slot within one by its dotted path, a base's taken through "@extends" as its other texts are, what a language lacks of them told, a slot the class has not refused (66655e6)

---

## @syncbridge/common@2.11.0 (2026-10-28)

### ✨ Features

- **common:** what Console tells of a host's workers - needs-config a problem; HostWorker tells heldBack and migrationPending, and HostWorkerSummary names the workers held on an older version or waiting for their migrations that have no problem (notices, the first ten), counted as started or stopped as they are (f2a6f33)

---

## @syncbridge/common@2.10.0 (2026-10-28)

### ✨ Features

- a profile carried across a module's declared changes - common: formerly on @App/@Component (a class renamed, its own and not its base's), @UseComponent (a slot) and @DefineVariable (a setting), formerlyValues on an enum's choices; carryProfile(profile) moves what a profile written for earlier versions holds to the names declared now, drops what is no longer defined and tells each change, no code of the module's run. syncbuild: spm publish compares the version with the package's last published one as the registry keeps it - a class, a slot, a setting or a choice gone with nothing declared, a setting or a slot newly required with no default, refuse a version that is not a major and are told in a major; a former name still in use is refused in any; a registry that cannot tell is told, not compared (d21a0a6)
- **common:** a worker waiting for its configuration - ServiceStatus needs-config, for one lacking only what its user can give; isMissingValue(issue) tells such an issue, a setting or a component required and not given (a component's now told with rule "required" as a setting's is); carryProfile skips a registry record of no package (39771ad)

### 🧹 Chores

- update dependencies - @types/node 26.6.6, valgen 7.0.6 (dcc258b)

---

## @syncbridge/common@2.9.0 (2026-10-28)

### ✨ Features

- translations kept out of the code - locales/<language>.json at a package's root, by class name and settings by their dotted path, taken into the manifest as it is built: each name, description and summary of an app, a component or a plugin (its title), each label and description of their settings, becomes text by language, the code's text in the package's own language; a file not of a language, a class or a setting the package has not, a text not text refuse the build, what a language lacks is told; locales/ is not packed. common: an element's displayName and description, a plugin's title and description, are LocalizedText - a text alone is in the package's own language - ExtensionBase.displayName still English, displayNameIn(language) the reader's (a994fcc)

---

## @syncbridge/common@2.8.0 (2026-10-28)

### ✨ Features

- **common:** secrets of a host and its workspace - sealForWeb, the sealed box made with WebCrypto byte for byte as sealFor makes it, and sealKeyFingerprint, in @syncbridge/common/web, which imports nothing of Node (and the main entry); the host link's secrets: HostSecrets and key grants in host/values, the names a host cannot open yet (locked), the workspace key jobs Console asks of a host (HOST_VALUES_KEY_PATH: made, handed over, rotated) and HOST_CONSOLE_SERVICE_HEADER, Console's own call for no user (55eaf10)

---

## @syncbridge/common@2.7.0 (2026-10-28)

### ✨ Features

- **common:** references to the values a host or its workspace keeps - ${{ vars.NAME }} anywhere in a worker's string values, ${{ secrets.NAME }} reserved, $${{ the text itself, anything else between ${{ }} an error; parseValueRefs, resolveValueRefs (the values trees alone, what is missing qualified), profileValueRefs, hasValueRef; the codec keeps a value holding a reference unchecked when told the profile is not resolved (unresolved); the host link's values: HOST_VALUES_PATH, HOST_VALUES_CHANGED_PATH, HostValuesRequest/Response with the names a host's workers use, hostVariable (9d10a76)

---

## @syncbridge/common@2.6.0 (2026-10-28)

### ✨ Features

- **pnpm-config,syncbuild:** @syncbridge/pnpm-config, pnpm's config dependency for module repositories - the readPackage hook taking SyncBridge's modules the npm mirror's packages name from the mirror, in a package of its own with no dependencies; spm add adds it with pnpm add --config and writes a .pnpmfile.cjs of one line taking its hooks, so the code stays in the SDK and is in place on a fresh clone before anything is resolved. spm check tells it missing or older than syncbuild's; common counts it in the SDK (0e9c3d1)

---

## @syncbridge/common@2.5.0 (2026-10-28)

### ✨ Features

- **common:** what a host provides its packages as peers, in its update check and install plan - HostProvides, sent as `host`; an offer telling its peerDependencies, a newer version the host cannot take told as `held` with what it needs; unmetPeers, judging only the peers the host names (98828d3)

---

## @syncbridge/common@2.4.0 (2026-10-27)

### ✨ Features

- **common,syncbuild:** documents shared by modules - a module's sidebar.json lists documents beyond its directory ("../shared/setup.md"), their languages with them; taken by a module they are its, not the package's own; a shared README.md listed is the page of a module with none of its own, one at most (fd40c84)
- **common:** a profile records the versions its values were written with - writtenWith on a profile (its app's) and on each of its components, kept through decoding and encoding; the engine's to set on every save, what a migration starts from (5340285)
- **common:** a component slot of one of several kinds - @UseComponent({ oneOf: [HL7Client, HL7Server], required: true }), each a class or its uri; its metadata's oneOf, interfaceUri the first for what reads that alone; a class of any of them taken, another refused naming them all; slotInterfaces and slotTakes tell it. testing asks which one a test means (5376d24)

---

## @syncbridge/common@2.3.1 (2026-10-26)

### 🐛 Bug Fixes

- **common:** a running app's hot-plug lists replaced whole, a list still - a list of groups was made an object ({"0": {...}}) and its new rows dropped on the first profile update; a hot-plug group's settings all updated, not only those marked hot-plug themselves; each value its own copy, not the profile's (7024d0f)

---

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
