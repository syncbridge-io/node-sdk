import { type ComponentBase, ExtensionRegistry } from '@syncbridge/common';
import { loadExtensionPackage } from './load-extension-package.js';
import type { WorkerPlan } from './plan.js';

/**
 * Registers only the packages of a worker's plan, each at its planned
 * version - so whatever the worker looks up in the registry resolves to the
 * versions the plan selected, and nothing else is loaded.
 */
export async function registerPlanPackages(plan: WorkerPlan): Promise<Error[]> {
  const errors: Error[] = [];
  for (const planned of Object.values(plan.packages)) {
    try {
      const pkg =
        planned.source === 'installed'
          ? await loadExtensionPackage(planned.path)
          : await ExtensionRegistry.registerPackage(planned.entryPoint);
      if (planned.source === 'installed') ExtensionRegistry.storePackage(pkg);
      if (pkg.version !== planned.version) {
        throw new Error(
          `Expected ${planned.name}@${planned.version} at ${planned.path}, found ${pkg.version}`,
        );
      }
      if (pkg.errors.length) {
        errors.push(
          new Error(
            `Failed to register extension ${planned.name}@${planned.version}\n  ` +
              pkg.errors
                .map(err => err.message.replace(/\n/g, '\n  '))
                .join('\n  '),
          ),
        );
      }
    } catch (err: any) {
      err.specifier = `${planned.name}@${planned.version}`;
      errors.push(err);
    }
  }
  return errors;
}

/**
 * Loads the class of every app and component of the plan's packages,
 * so every module they import is resolved the way the worker resolves it.
 * Run after registerPlanPackages.
 */
export async function loadPlanClasses(plan: WorkerPlan): Promise<Error[]> {
  const errors: Error[] = [];
  for (const planned of Object.values(plan.packages)) {
    const pkg = ExtensionRegistry.packages
      .get(planned.name)
      ?.find(p => p.version === planned.version);
    for (const ext of [...(pkg?.apps || []), ...(pkg?.components || [])]) {
      try {
        await ext.getClass();
      } catch (err: any) {
        errors.push(
          new Error(`${ext.uri} cannot be loaded: ${err?.message || err}`),
        );
      }
    }
  }
  return errors;
}

/** The URIs of every app and component class of the plan's packages */
export function planClasses(plan: WorkerPlan): string[] {
  return Object.values(plan.packages).flatMap(planned => {
    const pkg = ExtensionRegistry.packages
      .get(planned.name)
      ?.find(p => p.version === planned.version);
    return [...(pkg?.apps || []), ...(pkg?.components || [])].map(e => e.uri);
  });
}

/** The paths of an app's components, nested ones included */
export function componentPaths(element: {
  components: Record<string, ComponentBase>;
}): string[] {
  return Object.values(element.components).flatMap(c => [
    c.path,
    ...componentPaths(c),
  ]);
}
