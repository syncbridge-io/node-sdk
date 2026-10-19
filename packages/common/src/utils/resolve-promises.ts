import { isPlainObject } from '@jsopen/objects';

export async function resolvePromisesDeep(obj: any) {
  obj = await obj;
  if (obj && isPlainObject(obj)) {
    for (const k of Object.keys(obj)) {
      obj[k] = await resolvePromisesDeep(obj[k]);
    }
  }
  return obj;
}
