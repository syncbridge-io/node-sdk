import 'reflect-metadata';
import { merge } from '@jsopen/objects';

/** A former name, or several: a list of them, none when empty */
export function formerNames(
  names: string | string[] | undefined,
): string[] | undefined {
  const list = (Array.isArray(names) ? names : names ? [names] : []).filter(
    n => typeof n === 'string' && n,
  );
  return list.length ? Array.from(new Set(list)) : undefined;
}

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
