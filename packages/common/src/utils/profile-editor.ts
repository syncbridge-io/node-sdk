import type {
  Profile,
  ProfileComponent,
  ProfileComponentRecord,
} from '../models/index.js';
import type { ProfileCarryChange } from './carry-profile.js';

/**
 * The whole profile, as an app's own migrateProfile is given it
 * (ProfileMigration.profile): what it changes there is the profile's, each
 * change told. A place is written as a profile's issues are located:
 *
 * - `values/readFrequency`: the app's setting; `values/limits/hr` one
 *   down a group of settings;
 * - `components/device`: a component, `components/device/components/hl7`
 *   one in its slots;
 * - `components/device/values/port`: a component's setting.
 *
 * A sealed secret is a token here, moved or dropped as any value: one made
 * or changed is refused once the migration answers.
 */
export class ProfileEditor {
  /** What it changed, in turn */
  readonly changes: ProfileCarryChange[];

  constructor(
    readonly profile: Profile,
    changes?: ProfileCarryChange[],
  ) {
    this.changes = changes ?? [];
  }

  /** Whether something is at a place */
  has(path: string): boolean {
    return this.get(path) !== undefined;
  }

  /** What is at a place: a value, or a component, as it is held */
  get(path: string): any {
    const at = this._locate(path);
    return at.holder?.[at.key];
  }

  /**
   * Puts a value at a place: the settings that hold it made, when none are.
   * A component's place takes a component
   */
  set(path: string, value: any): void {
    const at = this._locate(path, true);
    if (at.component) assertComponent(path, value);
    at.holder![at.key] = value;
    this._tell('set', path, value, `Set "${path}"`);
  }

  /** Takes away what is at a place: false when nothing is */
  remove(path: string): boolean {
    const at = this._locate(path);
    if (at.holder?.[at.key] === undefined) return false;
    delete at.holder[at.key];
    this._tell('removed', path, undefined, `Removed "${path}"`);
    return true;
  }

  /**
   * Moves what is at a place to another: a value to a value's, a component
   * to a component's, with all it holds. False when nothing is there to
   * move; refused when the other place holds something
   */
  move(from: string, to: string): boolean {
    const src = this._locate(from);
    const value = src.holder?.[src.key];
    if (value === undefined) return false;
    const dst = this._locate(to);
    if (dst.component !== src.component)
      throw new Error(
        `Cannot move "${from}" to "${to}": a ${src.component ? 'component' : 'value'} goes to a ${src.component ? "component's" : "value's"} place`,
      );
    if (dst.holder?.[dst.key] !== undefined)
      throw new Error(`Cannot move "${from}" to "${to}": it holds one`);
    const made = this._locate(to, true);
    made.holder![made.key] = value;
    delete src.holder![src.key];
    this._tell('moved', to, from, `Moved "${from}" to "${to}"`);
    return true;
  }

  /** Moves what is at a place to another name beside it */
  rename(path: string, name: string): boolean {
    const parts = split(path);
    parts[parts.length - 1] = name;
    return this.move(path, parts.join('/'));
  }

  /**
   * A component put in a slot, of a class: what is given in it with it.
   * One there already, of that class, is answered as it is; of another,
   * refused
   */
  addComponent(
    path: string,
    uri: string,
    init?: Omit<ProfileComponent, 'uri'>,
  ): ProfileComponent {
    const at = this._locate(path, true);
    if (!at.component)
      throw new Error(
        `"${path}" is not a component's place: components/<slot>`,
      );
    const held = at.holder![at.key] as ProfileComponent | undefined;
    if (held) {
      if (held.uri === uri) return held;
      throw new Error(
        `Cannot add "${uri}" at "${path}": "${held.uri}" is there`,
      );
    }
    const component = { ...init, uri } as ProfileComponent;
    at.holder![at.key] = component;
    this._tell('added', path, uri, `Added "${uri}" at "${path}"`);
    return component;
  }

  protected _tell(
    kind: ProfileCarryChange['kind'],
    location: string,
    from: any,
    message: string,
  ) {
    this.changes.push({
      kind,
      location,
      from: typeof from === 'string' ? from : '',
      message,
    });
  }

  /**
   * What holds a place and its key in it: none when what leads there is
   * not; made down the way when told to
   */
  protected _locate(
    path: string,
    make = false,
  ): { holder?: Record<string, any>; key: string; component: boolean } {
    const parts = split(path);
    let element: Profile | ProfileComponent | undefined = this.profile;
    let i = 0;
    while (parts[i] === 'components') {
      const slot = parts[i + 1];
      if (!slot) break;
      if (i + 2 === parts.length) {
        if (make && element) element.components ??= {};
        return {
          holder: element?.components as ProfileComponentRecord | undefined,
          key: slot,
          component: true,
        };
      }
      element = element?.components?.[slot];
      i += 2;
    }
    if (parts[i] !== 'values' || i + 1 >= parts.length)
      throw new Error(
        `"${path}" is no place in a profile: values/<name> or components/<slot>...`,
      );
    if (make && !element)
      throw new Error(`Cannot reach "${path}": no component holds it`);
    let holder: Record<string, any> | undefined = element;
    let key = 'values';
    for (const part of parts.slice(i + 1)) {
      let next = holder?.[key];
      if (next === undefined && make && holder) next = holder[key] = {};
      if (next !== undefined && (typeof next !== 'object' || next === null))
        throw new Error(`Cannot reach "${path}": "${key}" holds a value`);
      holder = next;
      key = part;
    }
    return { holder, key, component: false };
  }
}

function split(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) throw new Error('A place in a profile was not told');
  return parts;
}

function assertComponent(path: string, value: any) {
  if (!value || typeof value !== 'object' || typeof value.uri !== 'string')
    throw new Error(`"${path}" takes a component, with its uri`);
}
