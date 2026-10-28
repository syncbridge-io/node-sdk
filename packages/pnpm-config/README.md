# @syncbridge/pnpm-config

pnpm support for repositories of SyncBridge modules: a
[config dependency](https://pnpm.io/config-dependencies) whose
`readPackage` hook takes SyncBridge's modules from the registry's npm
mirror.

SyncBridge's modules (`@syncbridge/builtins`, `@syncbridge/hl7`, ...) are
not on npm. In development they come from the npm mirror as
`@sbext/syncbridge__<name>`, installed under their own name by an alias.
npm installs flatly, so the alias a package declares serves every package
that asks for the module. pnpm installs each package with what it
declares alone. A mirror package that names a module by its own name -
`@sbext/syncbridge__hl7` peering on `@syncbridge/builtins` - would make
pnpm look for it on npmjs.org, where it is not.

The hook gives every `@sbext` package the modules it names from the
mirror, with the same ranges. A module named as a peer, a dependency or
by the mirror's own name is handled the same way. Nothing else is changed.

## Use

`spm add` (`@syncbridge/syncbuild`) sets it up in a workspace installed
with pnpm. By hand:

```bash
pnpm add --config @syncbridge/pnpm-config
```

```js
// .pnpmfile.cjs
module.exports = require('./node_modules/.pnpm-config/@syncbridge/pnpm-config');
```

pnpm installs config dependencies before anything else, so the hook is in
place on a fresh clone before the packages are resolved. This package has
no dependencies, as a config dependency may not.

## API

- `hooks.readPackage(pkg, context)`: the hook.
- `aliasRange(range)`: a range written without spaces, as pnpm parses an
  alias (`>=2.0.1 <3` as `^2.0.1`).
- `mirrorAlias(name, range)`: a module from the mirror, as an alias:
  `npm:@sbext/syncbridge__hl7@^2.0.1`.
- `isModule(name)`, `SDK_PACKAGES`: SyncBridge's modules, and its SDK,
  which comes from npm.

## License

MIT
