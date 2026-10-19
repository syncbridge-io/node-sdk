# @syncbridge/runtime

How SyncBridge installs extension packages and runs apps in workers,
as a library. The SyncBridge engine uses it, and so does `spm verify`
(`@syncbridge/syncbuild`), so a package verified before release is
installed and run by the same code as in production.

```sh
npm i @syncbridge/runtime
```

## Installing a package

`installPackage(zipFile, options)` runs the install steps in order:
extract the archive, read its `syncbridge-manifest.json`, check that the
registry packages it depends on are installed and the host provides its
peers, move it into place and install its npm dependencies with pnpm.
A package carries no lockfile: its ranges are resolved when it is
installed, peers of its dependencies included, and the `pnpm-lock.yaml`
pnpm writes in its directory records what it runs on. Each step is also exported on its own
(`extractPackage`, `readPackage`, `verifyDependencies`, `placePackage`,
`installDependencies`).

## Running an app

```ts
import { computeWorkerPlan, startWorker } from '@syncbridge/runtime';

const plan = computeWorkerPlan({ app, metadata, versionsOf, isInstalled, hostURL });
const worker = await startWorker({ plan, profile, dataDirectory });
await worker.waitForStatus(['started']);
await worker.stop();
```

- `computeWorkerPlan` picks one version of every registry package the
  app needs, or throws listing what cannot be satisfied.
- `startWorker` writes the plan, forks a worker that preloads the plan's
  resolve hooks (`LOADER_URL`), registers the planned packages and creates
  the app from the profile. The worker reports its status, the
  status of its components and its logs. With `createOnly` it loads every
  class of the planned packages and creates the app without
  initializing or starting it, reaching status `created` (`spm verify`).

Inside the worker, `AppWorker` runs the app: it creates it
from a profile, updates it when the profile changes (the class cannot
change), starts and stops it, and emits `status-change` and
`component-status-change`. The SyncBridge engine's worker and `startWorker`'s
both run it, each adding only its own messaging and logging.

Once the app has stopped, `endWorker` ends the process - both workers use
it. Whatever the app left open (a timer, a socket, a library's pool) would
only keep a stopped process alive, so the worker does not wait for it: it
logs a warning naming what was left (`resourcesLeft`), for the module's
developer to close in `_stop()`, and exits.

Requires Node.js 22.15 or later (`module.registerHooks`).

## License

MIT
