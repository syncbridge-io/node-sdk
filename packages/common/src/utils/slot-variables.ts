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
 * not given another's.
 */
export function slotClassVariables(
  slot: Slot | undefined,
  classUri: string,
  own: VariableMetadataRecord | undefined,
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
      ofIts(slot?.variablesOf?.[classNameOf(classUri)]),
    ],
    { deep: 'full' },
  ) as VariableMetadataRecord;
}
