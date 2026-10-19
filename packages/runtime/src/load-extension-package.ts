import fs from 'node:fs';
import path from 'node:path';
import { updateErrorMessage } from '@jsopen/objects';
import {
  AppExtension,
  ComponentExtension,
  ExtensionPackage,
  MANIFEST_FILE,
  normalizeAppMetadata,
  normalizeComponentMetadata,
  normalizePluginMetadata,
  PluginExtension,
  readExtensionManifest,
  SbError,
} from '@syncbridge/common';

/**
 * Reads an installed extension package: its manifest, which syncbuild
 * wrote to syncbridge-manifest.json, and in it what the package brings -
 * each app, component and plugin with its definition and the module its class
 * is exported from. Nothing of the package's code is loaded.
 */
export async function loadExtensionPackage(dirname: string) {
  const filename = path.join(dirname, 'package.json');
  if (!fs.existsSync(filename))
    throw new SbError(`Directory "${dirname}" does not contain package.json`);
  const pkgJson = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!fs.existsSync(path.join(dirname, MANIFEST_FILE)))
    throw new SbError(
      `"${pkgJson.name}" has no ${MANIFEST_FILE}: it is not a SyncBridge extension package built by syncbuild`,
    );
  const read = readExtensionManifest(dirname, pkgJson)!;
  const { manifest } = read;

  const out = new ExtensionPackage();
  out.assignManifest(pkgJson, manifest);
  out.path = dirname;
  out.entryPoint = path.join(dirname, pkgJson.module || pkgJson.main);
  for (const field of read.unknownFields)
    out.warnings.push(
      `${MANIFEST_FILE} of "${out.name}": "${field}" is not known, passed over`,
    );

  for (const entry of manifest.components || []) {
    const { exportName: name, entryPoint, ...definition } = entry;
    try {
      if (!name || !entryPoint)
        throw new SbError('it gives no exportName or entryPoint');
      const metadata = await normalizeComponentMetadata(definition as any);
      if (metadata.abstract) continue;
      const extension = new ComponentExtension(out, name, metadata);
      extension.entryPoint = path.resolve(dirname, entryPoint);
      out.components.push(extension);
    } catch (e: any) {
      updateErrorMessage(
        e,
        `Component (${name}) in ${MANIFEST_FILE}: ` + e.message,
      );
      out.errors.push(e);
    }
  }

  for (const entry of manifest.apps || []) {
    const { exportName: name, entryPoint, ...definition } = entry;
    try {
      if (!name || !entryPoint)
        throw new SbError('it gives no exportName or entryPoint');
      const metadata = await normalizeAppMetadata(definition as any);
      if (metadata.abstract) continue;
      const extension = new AppExtension(out, name, metadata);
      extension.entryPoint = path.resolve(dirname, entryPoint);
      out.apps.push(extension);
    } catch (e: any) {
      updateErrorMessage(e, `App (${name}) in ${MANIFEST_FILE}: ` + e.message);
      out.errors.push(e);
    }
  }
  for (const entry of manifest.plugins || []) {
    const { exportName: name, entryPoint, ...definition } = entry;
    try {
      if (!name || !entryPoint)
        throw new SbError('it gives no exportName or entryPoint');
      const metadata = await normalizePluginMetadata(definition as any);
      const extension = new PluginExtension(out, name, metadata);
      extension.entryPoint = path.resolve(dirname, entryPoint);
      out.plugins.push(extension);
    } catch (e: any) {
      updateErrorMessage(
        e,
        `Plugin (${name}) in ${MANIFEST_FILE}: ` + e.message,
      );
      out.errors.push(e);
    }
  }
  return out;
}
