import fs from 'node:fs';
import { WorkerPermission } from '../models/enums/worker-permission.enum.js';
import type { AppMetadata } from '../models/metadata/app-metadata.js';
import type { ComponentMetadata } from '../models/metadata/component-metadata.js';
import type { ElementComponentMetadataRecord } from '../models/metadata/element-component-metadata.js';

/**
 * What of the server a worker reaches: as its app declares, and each
 * component it is given - the one its profile chose, else the one its app
 * asks for - and theirs, all the way down
 */
export function workerPermissionsOf(
  metadata: AppMetadata | undefined,
  find: (uri: string) => ComponentMetadata | undefined,
): WorkerPermission[] {
  const out = new Set<WorkerPermission>(metadata?.permissions ?? []);
  const walk = (components?: ElementComponentMetadataRecord) => {
    for (const slot of Object.values(components ?? {})) {
      const uri = slot.classUri || slot.interfaceUri;
      for (const p of (uri && find(uri)?.permissions) || []) out.add(p);
      walk(slot.components);
    }
  };
  walk(metadata?.components);
  return [...out].sort();
}

/**
 * Node's permission model for a worker: it reads and writes the paths
 * told (any, when none), and reaches native addons and other programs as
 * it declares them (native-code, child-processes) - both outside the
 * model; worker threads never, outside it too
 */
export function nodePermissionArgs(args: {
  read?: string[];
  write?: string[];
  permissions: string[];
}): string[] {
  const all = (paths?: string[]) =>
    paths ? [...new Set(paths.flatMap(p => [p, realpathOf(p)]))] : ['*'];
  return [
    '--permission',
    ...all(args.read).map(p => `--allow-fs-read=${p}`),
    ...all(args.write).map(p => `--allow-fs-write=${p}`),
    ...(args.permissions.includes(WorkerPermission.NativeCode)
      ? ['--allow-addons']
      : []),
    ...(args.permissions.includes(WorkerPermission.ChildProcesses)
      ? ['--allow-child-process']
      : []),
  ];
}

/**
 * What a worker refused by the permission model is to declare, from the
 * error it failed with: none, it was not refused so
 */
export function missingPermissionOf(
  message: string,
): WorkerPermission | undefined {
  if (
    /ERR_DLOPEN_DISABLED|addons is disabled|loading native addons/i.test(
      message,
    )
  )
    return WorkerPermission.NativeCode;
  if (
    /ChildProcess|child_process/i.test(message) &&
    /ERR_ACCESS_DENIED/.test(message)
  )
    return WorkerPermission.ChildProcesses;
}

function realpathOf(p: string) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
