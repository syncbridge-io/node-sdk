/**
 * `node --import @syncbridge/syncbuild/register ...` - runs an extension
 * package's tests with `sb:` imports resolved the way a SyncBridge worker
 * resolves them. See `installResolveHooks`.
 */
import { installResolveHooks } from './hooks.js';

if (!installResolveHooks()) {
  throw new Error(
    '@syncbridge/syncbuild/register requires Node.js 22.15 or later (module.registerHooks)',
  );
}
