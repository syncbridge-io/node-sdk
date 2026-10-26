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
 * Every class of the plan's packages - their apps, components and plugins -
 * each by its URI, `<package>:<class>`
 */
function planExtensions(
  plan: WorkerPlan,
): { uri: string; getClass(): Promise<unknown> }[] {
  return Object.values(plan.packages).flatMap(planned => {
    const pkg = ExtensionRegistry.packages
      .get(planned.name)
      ?.find(p => p.version === planned.version);
    if (!pkg) return [];
    return [
      ...pkg.apps,
      ...pkg.components,
      ...pkg.plugins.map(p => ({
        uri: `${pkg.name}:${p.exportName}`,
        getClass: () => p.getClass(),
      })),
    ];
  });
}

/**
 * Loads the class of every app, component and plugin of the plan's
 * packages, so every module they import is resolved the way the worker
 * resolves it. A plugin runs in the engine's own process, never a worker's;
 * loaded here, its package is checked as the engine loads it. Run after
 * registerPlanPackages.
 */
export async function loadPlanClasses(plan: WorkerPlan): Promise<Error[]> {
  const errors: Error[] = [];
  for (const ext of planExtensions(plan)) {
    try {
      await ext.getClass();
    } catch (err: any) {
      errors.push(
        new Error(`${ext.uri} cannot be loaded: ${err?.message || err}`),
      );
    }
  }
  return errors;
}

/** The URIs of every app, component and plugin class of the plan's packages */
export function planClasses(plan: WorkerPlan): string[] {
  return planExtensions(plan).map(e => e.uri);
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
