# CLAUDE.md

## Project

SyncBridge's Node.js SDK (MIT, public): the npm packages module developers
use - `@syncbridge/common`, `runtime`, `syncbuild` (`spm`), `testing`,
`plugin-api` - in `packages/<name>`. Moved out of the private platform
repository (syncbridge-io/syncbridge-cloud, at
`/Users/ehanoglu/dev/panates/syncbridge`) at 2.0.0, with a fresh history.

The platform consumes these packages from npm: the engine
(`syncbridge-engine`) and the cloud services there depend on them. Work
touching both is done by the same Claude session (named `syncbridge`):
the SDK change here, released first; the platform then takes the new
version. Until it is released, the platform and
[public-modules](https://github.com/syncbridge-io/public-modules) take
this repository's local builds.

## How to work here

- **Language**: talk to the user in Turkish; code, comments, commits and
  docs in English.
- **Commits**: Conventional Commits - `feat`, `fix`, `refactor`, `chore`,
  `dev`, `test`, `docs`, `style`, `perf`, with a scope when it helps
  (`feat(common): ...`). They decide the versions. End each with the
  `Co-Authored-By` line. Ask before pushing; push with `--follow-tags`.
- **Public code**: everything here is read by module developers. Keep the
  READMEs right, and never commit secrets, internal addresses or notes
  about the private platform.
- **Checks** before a commit: `npx tsc -b tsconfig-test.json --noEmit`,
  `npx rman lint`, `npx rman check`, `npx mocha`.
- **Builds** for the platform and public-modules: `npx rman build`
  (plain tsc leaves `build/package.json` stale).
- A peer dependency on a sibling (`@syncbridge/common`): on its new major,
  move the dependents' ranges by hand first (`version.dependentRanges:
  keep`).
