import type { Profile } from '../models/index.js';

/*
 * References in a worker's values: `${{ vars.NAME }}` names a variable its
 * host or its workspace keeps, anywhere in a string value and more than
 * once; `${{ secrets.NAME }}` a secret. `$${{` writes `${{` itself. A
 * profile keeps the references as written - stored, synced to Console,
 * restored - and the host resolves them before the profile is decoded, so
 * a resolved value is checked as any value is.
 */

/** The name of a variable or a secret: UPPER_SNAKE, at most 64 characters */
export const VALUE_REF_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

/** What a reference names: a variable, or a secret */
export type ValueRefKind = 'vars' | 'secrets';

export interface ValueRef {
  kind: ValueRefKind;
  name: string;
}

/** A reference as told: "vars.NAME" */
export const qualifiedRef = (ref: ValueRef) => `${ref.kind}.${ref.name}`;

/** A reference as written in a value: "${{ vars.NAME }}" */
export const formatValueRef = (kind: ValueRefKind, name: string) =>
  '${{ ' + kind + '.' + name + ' }}';

const OPEN = '${{';
const CLOSE = '}}';

/**
 * Whether a value holds a reference - or writes `${{` itself - so that it
 * is not its final value until resolved
 */
export function hasValueRef(value: unknown): value is string {
  return typeof value === 'string' && value.includes(OPEN);
}

/**
 * Goes through a text: its pieces of plain text, and its references. An
 * expression that is not one - another kind than vars or secrets, a name
 * not UPPER_SNAKE, no closing braces - is an error, not text: a slip is
 * not kept as written.
 */
function scan(
  text: string,
  on: { text(piece: string): void; ref(ref: ValueRef): void },
): string[] {
  const errors: string[] = [];
  let at = 0;
  for (;;) {
    const open = text.indexOf(OPEN, at);
    if (open < 0) break;
    /* `$${{`: the text `${{` */
    if (open > 0 && text[open - 1] === '$') {
      on.text(text.slice(at, open - 1) + OPEN);
      at = open + OPEN.length;
      continue;
    }
    on.text(text.slice(at, open));
    const close = text.indexOf(CLOSE, open + OPEN.length);
    if (close < 0) {
      errors.push(`"${text.slice(open)}" is not closed with "${CLOSE}"`);
      on.text(text.slice(open));
      return errors;
    }
    const inner = text.slice(open + OPEN.length, close).trim();
    const m = /^(vars|secrets)\.(\S+)$/.exec(inner);
    if (m && VALUE_REF_NAME.test(m[2]))
      on.ref({ kind: m[1] as ValueRefKind, name: m[2] });
    else {
      errors.push(
        `"${OPEN} ${inner} ${CLOSE}" is not a reference: write ` +
          `${formatValueRef('vars', 'NAME')} or ${formatValueRef('secrets', 'NAME')}, ` +
          `NAME in capitals, digits and "_"; "$${OPEN}" for the text "${OPEN}"`,
      );
      on.text(text.slice(open, close + CLOSE.length));
    }
    at = close + CLOSE.length;
  }
  on.text(text.slice(at));
  return errors;
}

/** The references of a text, in order, and what is wrong in it */
export function parseValueRefs(text: string): {
  refs: ValueRef[];
  errors: string[];
} {
  const refs: ValueRef[] = [];
  const errors = scan(text, { text: () => undefined, ref: r => refs.push(r) });
  return { refs, errors };
}

/**
 * A text with its references replaced by what `lookup` answers - `$${{`
 * by `${{` - and the references it does not answer, qualified
 */
export function resolveValueText(
  text: string,
  lookup: (kind: ValueRefKind, name: string) => string | undefined,
): { value: string; missing: string[]; errors: string[] } {
  let value = '';
  const missing: string[] = [];
  const errors = scan(text, {
    text: piece => (value += piece),
    ref: ref => {
      const found = lookup(ref.kind, ref.name);
      if (found === undefined) missing.push(qualifiedRef(ref));
      else value += found;
    },
  });
  return { value, missing, errors };
}

type ComponentsTree = Record<string, any> | undefined;

/**
 * Each value tree of a profile - the app's, each component's down the
 * components - with where it is: "values", "components/server/values"
 */
function eachValues(
  profile: Profile,
  fn: (values: Record<string, any>, location: string) => void,
) {
  if (profile.values) fn(profile.values, 'values');
  const walk = (components: ComponentsTree, at: string) => {
    for (const [key, component] of Object.entries(components || {})) {
      if (!component) continue;
      const here = `${at}/${key}`;
      if (component.values) fn(component.values, `${here}/values`);
      walk(component.components, `${here}/components`);
    }
  };
  walk(profile.components, 'components');
}

/** Each string of a value tree, down its objects and arrays: replaced by `fn` */
function mapStrings(
  tree: any,
  location: string,
  fn: (text: string, location: string) => string,
): any {
  if (typeof tree === 'string') return fn(tree, location);
  if (Array.isArray(tree))
    return tree.map((v, i) => mapStrings(v, `${location}/${i}`, fn));
  if (tree && typeof tree === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(tree))
      out[k] = mapStrings(v, `${location}/${k}`, fn);
    return out;
  }
  return tree;
}

/**
 * A profile with the references of its values resolved - the app's and
 * each component's, nothing else of it - by `lookup`; the references it
 * does not answer, qualified ("vars.HBYS_URL"), and the expressions that
 * are not references, each with where it is. The profile given is left as
 * it is.
 */
export function resolveValueRefs<T extends Profile>(
  profile: T,
  lookup: (kind: ValueRefKind, name: string) => string | undefined,
): { profile: T; missing: string[]; errors: string[] } {
  const out = structuredClone(profile);
  const missing = new Set<string>();
  const errors: string[] = [];
  const resolve = (values: Record<string, any>, location: string) =>
    mapStrings(values, location, (text, at) => {
      if (!hasValueRef(text)) return text;
      const r = resolveValueText(text, lookup);
      r.missing.forEach(m => missing.add(m));
      errors.push(...r.errors.map(e => `${at}: ${e}`));
      return r.value;
    });
  if (out.values) out.values = resolve(out.values, 'values');
  const walk = (components: ComponentsTree, at: string) => {
    for (const [key, component] of Object.entries(components || {})) {
      if (!component) continue;
      const here = `${at}/${key}`;
      if (component.values)
        component.values = resolve(component.values, `${here}/values`);
      walk(component.components, `${here}/components`);
    }
  };
  walk(out.components, 'components');
  return { profile: out, missing: [...missing], errors };
}

/** The references a profile's values make, qualified, each once, sorted */
export function profileValueRefs(profile: Profile): string[] {
  const names = new Set<string>();
  eachValues(profile, values =>
    mapStrings(values, '', text => {
      if (hasValueRef(text))
        parseValueRefs(text).refs.forEach(r => names.add(qualifiedRef(r)));
      return text;
    }),
  );
  return [...names].sort();
}
