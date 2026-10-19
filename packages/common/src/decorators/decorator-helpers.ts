import 'reflect-metadata';
import { merge } from '@jsopen/objects';

export function defineOwnMetadata(
  target: any,
  metadataKey: string | symbol,
  overwrite?: any,
) {
  let metadata: any = Reflect.getOwnMetadata(metadataKey, target);
  const sources: any[] = [];
  if (!metadata) {
    metadata = {};
    const base = Object.getPrototypeOf(target);
    const baseMetadata = Reflect.getMetadata(metadataKey, base);
    if (baseMetadata) sources.push(baseMetadata);
  }
  if (overwrite) sources.push(overwrite);
  if (sources.length)
    merge(metadata, sources, {
      deep: 'full',
      mergeArrays: true,
      ignoreNulls: false,
      ignoreUndefined: false,
    });
  Reflect.defineMetadata(metadataKey, metadata, target);
  return metadata;
}
