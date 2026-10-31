import type { Widget } from '../decorators/widget.decorator.js';
import type {
  DataKind,
  WidgetMetadata,
} from '../models/metadata/dashboard-metadata.js';
import { DASHBOARD_LIMITS } from './limits.js';

/**
 * A widget type, as the engine's registry keeps it (engine
 * docs/worker-dashboards.md, section 6): the kinds its data may be, the
 * properties it takes, and how the web UI draws it
 */
export interface WidgetTypeSpec {
  /** `core.stat`, `<plugin>.<name>` */
  name: string;
  version: number;
  title: string;
  description?: string;
  /**
   * builtin: the web UI's own; template: a tree of primitives
   * (`template`); sandbox: a plugin's code in a sandboxed frame (later)
   */
  renderer: 'builtin' | 'template' | 'sandbox';
  /** The kinds its data may be */
  data: DataKind[];
  properties?: Record<string, WidgetPropertySpec>;
  /** A template type's tree */
  template?: Widget.TemplateNode;
}

export interface WidgetPropertySpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'template';
  required?: boolean;
  /** For a string: the values it may be */
  values?: string[];
}

/** A type's id: `core.stat@1` */
export function widgetTypeId(spec: Pick<WidgetTypeSpec, 'name' | 'version'>) {
  return `${spec.name}@${spec.version}`;
}

/** A type id's parts, if it is one */
export function parseWidgetType(
  type: string,
): { name: string; version: number } | undefined {
  const m = /^([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)@([1-9]\d{0,3})$/.exec(
    type,
  );
  return m ? { name: m[1], version: Number(m[2]) } : undefined;
}

export const TEMPLATE_PRIMITIVES: readonly Widget.TemplateNode['type'][] = [
  'text',
  'number',
  'badge',
  'light',
  'progress',
  'sparkline',
  'chart',
  'table',
  'stack',
  'grid',
  'divider',
];

const FORMATS = ['number', 'percent', 'bytes', 'duration', 'time', 'text'];
const BINDING = /^(row|prop)\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
/** A template's nodes and depth at most */
const TEMPLATE_NODES = 50;
const TEMPLATE_DEPTH = 6;

/* A value against its bounds: a gauge's, a progress bar's */
const BOUNDED: Record<string, WidgetPropertySpec> = {
  min: { type: 'number' },
  max: { type: 'number', required: true },
  unit: { type: 'string' },
  format: { type: 'string', values: FORMATS },
  decimals: { type: 'number' },
  thresholds: { type: 'object' },
};

/* Categories, a row each: bars', a pie's */
const CATEGORIES: Record<string, WidgetPropertySpec> = {
  unit: { type: 'string' },
  format: { type: 'string', values: FORMATS },
  decimals: { type: 'number' },
};

/** The core types (phase 1) */
export const CORE_WIDGET_TYPES: readonly WidgetTypeSpec[] = [
  {
    name: 'core.stat',
    version: 1,
    title: 'Number',
    description: 'A number or a short text, its unit, colored by thresholds',
    renderer: 'builtin',
    data: ['value'],
    properties: {
      unit: { type: 'string' },
      format: { type: 'string', values: FORMATS },
      decimals: { type: 'number' },
      thresholds: { type: 'object' },
    },
  },
  {
    name: 'core.status',
    version: 1,
    title: 'Status',
    description: 'A status light with its text',
    renderer: 'builtin',
    data: ['value'],
  },
  {
    name: 'core.chart',
    version: 1,
    title: 'Chart',
    description: 'Series over time: lines, areas, bars or stacked areas',
    renderer: 'builtin',
    data: ['series'],
    properties: {
      unit: { type: 'string' },
      min: { type: 'number' },
      max: { type: 'number' },
      style: { type: 'string', values: ['line', 'area', 'bar', 'stacked'] },
    },
  },
  {
    name: 'core.list',
    version: 1,
    title: 'List',
    description: 'Rows under columns',
    renderer: 'builtin',
    data: ['table', 'feed'],
    properties: { columns: { type: 'array', required: true } },
  },
  {
    name: 'core.card',
    version: 1,
    title: 'Cards',
    description: 'A card per row, of the template given in the widget',
    renderer: 'template',
    data: ['table'],
    properties: { template: { type: 'template', required: true } },
  },
  {
    name: 'core.gauge',
    version: 1,
    title: 'Gauge',
    description: 'A dial between its bounds, colored by thresholds',
    renderer: 'builtin',
    data: ['value'],
    properties: BOUNDED,
  },
  {
    name: 'core.progress',
    version: 1,
    title: 'Progress',
    description: 'A bar between its bounds, colored by thresholds',
    renderer: 'builtin',
    data: ['value'],
    properties: BOUNDED,
  },
  {
    name: 'core.bars',
    version: 1,
    title: 'Bars',
    description: 'Categories as bars, largest first: a row each',
    renderer: 'builtin',
    data: ['table'],
    properties: CATEGORIES,
  },
  {
    name: 'core.pie',
    version: 1,
    title: 'Pie',
    description: 'Categories as shares of a whole, a ring or a pie',
    renderer: 'builtin',
    data: ['table'],
    properties: { ...CATEGORIES, donut: { type: 'boolean' } },
  },
];

/** A core type by its id */
export function coreWidgetType(type: string): WidgetTypeSpec | undefined {
  return CORE_WIDGET_TYPES.find(t => widgetTypeId(t) === type);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS: readonly string[] = ['value', 'series', 'table', 'feed'];

/**
 * What is wrong with a widget's definition: its id, its size, its data,
 * and - its type known - its data's kind and its properties against the
 * type. A type not known is no error here: the web UI draws a placeholder
 */
export function widgetIssues(
  widget: WidgetMetadata,
  spec: WidgetTypeSpec | undefined,
): string[] {
  const issues: string[] = [];
  if (!widget.id || !ID.test(widget.id))
    issues.push('an id of letters, digits, _ and - is needed');
  if (!widget.type || !parseWidgetType(widget.type))
    issues.push(`"${widget.type}" is not a type and version (core.stat@1)`);
  const size = widget.size;
  if (size?.width != null && ![1, 2, 3, 4].includes(size.width))
    issues.push('its width is 1 to 4');
  if (size?.height != null && !['s', 'm', 'l'].includes(size.height))
    issues.push('its height is s, m or l');

  const data = widget.data;
  if (!data || !KINDS.includes(data.kind)) {
    issues.push(`its data is one of ${KINDS.join(', ')}`);
    return issues;
  }
  if (data.max != null && !(Number.isInteger(data.max) && data.max > 0))
    issues.push('its max is a whole number above 0');
  if (data.window != null && !(data.window > 0))
    issues.push('its window is above 0 seconds');
  if (data.series) {
    if (data.kind !== 'series') issues.push('only a series has series');
    else if (
      !Array.isArray(data.series) ||
      data.series.some(s => typeof s !== 'string' || !s)
    )
      issues.push('its series are names');
    else if (data.series.length > DASHBOARD_LIMITS.seriesCount)
      issues.push(`at most ${DASHBOARD_LIMITS.seriesCount} series`);
    else if (new Set(data.series).size !== data.series.length)
      issues.push('a series is named twice');
  }
  if (!spec) return issues;

  if (!spec.data.includes(data.kind))
    issues.push(
      `a ${widget.type}'s data is a ${spec.data.join(' or ')}, not a ${data.kind}`,
    );
  if (spec.name === 'core.chart' && !data.series?.length)
    issues.push('a chart names its series');
  const props = widget.properties || {};
  for (const [name, p] of Object.entries(spec.properties || {})) {
    const value = props[name];
    if (value == null) {
      if (p.required) issues.push(`it needs "${name}"`);
      continue;
    }
    const wrong = propertyIssue(value, p);
    if (wrong) issues.push(`"${name}" ${wrong}`);
    else if (p.type === 'template') issues.push(...templateIssues(value));
  }
  return issues;
}

function propertyIssue(value: any, p: WidgetPropertySpec): string | undefined {
  switch (p.type) {
    case 'string':
      if (typeof value !== 'string') return 'is a string';
      if (p.values && !p.values.includes(value))
        return `is one of ${p.values.join(', ')}`;
      return;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? undefined
        : 'is a number';
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'is true or false';
    case 'array':
      return Array.isArray(value) ? undefined : 'is a list';
    case 'object':
    case 'template':
      return value && typeof value === 'object' && !Array.isArray(value)
        ? undefined
        : 'is an object';
  }
}

/**
 * What is wrong with a template: its nodes' types and bindings, their
 * number and depth
 */
export function templateIssues(root: Widget.TemplateNode): string[] {
  const issues: string[] = [];
  let count = 0;
  const walk = (node: any, depth: number, at: string) => {
    if (++count > TEMPLATE_NODES) return;
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      issues.push(`template ${at}: a node is an object`);
      return;
    }
    if (!TEMPLATE_PRIMITIVES.includes(node.type))
      issues.push(`template ${at}: "${node.type}" is not a primitive`);
    if (
      node.value != null &&
      (typeof node.value !== 'string' || !BINDING.test(node.value))
    )
      issues.push(
        `template ${at}: "${node.value}" binds row.<field> or prop.<name>`,
      );
    if (node.format != null && !FORMATS.includes(node.format))
      issues.push(`template ${at}: "${node.format}" is not a format`);
    if (node.children != null) {
      if (!Array.isArray(node.children))
        issues.push(`template ${at}: its children are a list`);
      else if (depth >= TEMPLATE_DEPTH)
        issues.push(`template ${at}: deeper than ${TEMPLATE_DEPTH}`);
      else
        node.children.forEach((child: any, i: number) =>
          walk(child, depth + 1, `${at}.${i}`),
        );
    }
  };
  walk(root, 1, 'root');
  if (count > TEMPLATE_NODES)
    issues.push(`template: more than ${TEMPLATE_NODES} nodes`);
  return issues;
}
