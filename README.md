# SyncBridge Node.js SDK

The libraries and tools to build, test and publish **SyncBridge modules**:
npm packages of components and apps that SyncBridge runs as workers, each
a Node.js process of its own, managed from SyncBridge Console.

| Package | What it is |
| --- | --- |
| [`@syncbridge/common`](packages/common) | What a module is written against: `@App`, `@Component`, variables, log channels, `AppBase`, `ComponentBase` |
| [`@syncbridge/syncbuild`](packages/syncbuild) | `spm`: creates, builds, checks, packs, verifies and publishes a module |
| [`@syncbridge/testing`](packages/testing) | Tests a module's apps and components without SyncBridge, with any test runner |
| [`@syncbridge/runtime`](packages/runtime) | How SyncBridge installs a module and runs its apps in workers - the engine's own code, and `spm verify`'s |
| [`@syncbridge/plugin-api`](packages/plugin-api) | The API SyncBridge plugins (log targets and more) are written against |

## Getting started

```bash
npx @syncbridge/syncbuild init @acme/my-module
```

The modules SyncBridge ships are open source too, and the best examples:
[syncbridge-io/public-modules](https://github.com/syncbridge-io/public-modules).

## Development

```bash
npm ci
npm run build   # rman build: every package into its build/
npm test        # type check, then mocha
npx rman lint
```

Packages publish from their `build/` directory, never from the source tree.

## Releases

Versions come from [Conventional Commits](https://www.conventionalcommits.org)
on `main`: `fix:` a patch, `feat:` a minor, a breaking change a major.
`.github/workflows/release.yml` versions, publishes to npm by Trusted
Publishing - each version with its provenance - and makes the GitHub
Release.

## License

[MIT](LICENSE)
