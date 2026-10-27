import type { ElementComponentMetadata } from '../models/metadata/element-component-metadata.js';

type Slot = Pick<ElementComponentMetadata, 'interfaceUri' | 'oneOf'>;

/** The interfaces a slot takes a class of: its oneOf, else its interfaceUri */
export function slotInterfaces(slot: Slot): string[] {
  return slot.oneOf?.length ? slot.oneOf : [slot.interfaceUri];
}

/**
 * Whether a slot takes a class: one of its interfaces it is, or it
 * implements (its metadata's interfaces)
 */
export function slotTakes(
  slot: Slot,
  uri: string,
  interfaces: readonly string[] | undefined,
): boolean {
  return slotInterfaces(slot).some(i => uri === i || !!interfaces?.includes(i));
}
