import { merge } from '@jsopen/objects';
import type { ElementComponentMetadata } from '../models/metadata/element-component-metadata.js';
import type { VariableMetadataRecord } from '../models/metadata/variable-metadata.js';

type Slot = Pick<ElementComponentMetadata, 'variables' | 'variablesOf'>;

/** A class's name, the end of its uri: "PacketCapture" */
export function classNameOf(uri: string): string {
  return uri.slice(uri.lastIndexOf(':') + 1);
}

/**
 * The settings of a class put in a slot: the class's own, with what the
 * slot overrides of them - its `variables`, then those it gives this class
 * alone (`variablesOf`, by class name), over them. An override of a setting
 * the class does not define is passed over: one class of a oneOf slot is
 * not given another's. A class with no `variablesOf` of its own name takes
 * those of the nearest class it extends (`interfaces`, its bases' uris):
 * a subclass taken by a oneOf slot, e.g. a test's mock of the class.
 */
export function slotClassVariables(
  slot: Slot | undefined,
  classUri: string,
  own: VariableMetadataRecord | undefined,
  interfaces?: string[],
): VariableMetadataRecord {
  const defined = own || {};
  const ofIts = (overrides?: VariableMetadataRecord) =>
    Object.fromEntries(
      Object.entries(overrides || {}).filter(([name]) => name in defined),
    );
  return merge(
    {},
    [
      defined,
      ofIts(slot?.variables),
      ofIts(variablesOfClass(slot, classUri, interfaces)),
    ],
    { deep: 'full' },
  ) as VariableMetadataRecord;
}

/**
 * What a slot gives a class alone: by its name, else by the name of the
 * nearest class it extends (the last of `interfaces`, its bases' uris)
 */
function variablesOfClass(
  slot: Slot | undefined,
  classUri: string,
  interfaces: string[] = [],
): VariableMetadataRecord | undefined {
  const of = slot?.variablesOf;
  if (!of) return;
  for (const uri of [classUri, ...[...interfaces].reverse()]) {
    const name = classNameOf(uri);
    if (Object.prototype.hasOwnProperty.call(of, name)) return of[name];
  }
}
