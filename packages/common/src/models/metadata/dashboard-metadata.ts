import { ApiField, ArrayType, ComplexType } from '@opra/common';

/**
 * What a widget's data is, as the engine keeps it: a value, points in
 * time, rows by key, or the newest rows. Every widget type keeps its data
 * in one of these, so a new type changes nothing of how data moves
 */
export type DataKind = 'value' | 'series' | 'table' | 'feed';

/**
 * The dashboards of an element: property name -> definition
 */
@ComplexType({
  description: 'The dashboards of an element, each a tab of its own',
  additionalFields: () => DashboardMetadata,
})
export class DashboardMetadataRecord {
  [key: string]: DashboardMetadata;
}

/**
 * A widget's data: its kind and its bounds
 */
@ComplexType({ description: "A widget's data: its kind and its bounds" })
export class WidgetDataMetadata {
  constructor(init?: Partial<WidgetDataMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    description: 'What the data is: value, series, table or feed',
    required: true,
  })
  declare kind: DataKind;

  @ApiField({
    description:
      'At most this many points (series) or rows (table, feed) are kept: the oldest go',
  })
  declare max?: number;

  @ApiField({ description: "A series' window, in seconds: older points go" })
  declare window?: number;

  @ApiField({
    type: ArrayType(String),
    description: "A series widget's series, by name: a chart's lines",
  })
  declare series?: string[];
}

/**
 * Where a widget is drawn on the grid: how wide, how tall
 */
@ComplexType({ description: "A widget's size on the dashboard's grid" })
export class WidgetSize {
  constructor(init?: Partial<WidgetSize>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({ description: 'Columns, 1 to 4' })
  declare width?: number;

  @ApiField({ description: 'Height: s, m or l' })
  declare height?: 's' | 'm' | 'l';
}

/**
 * A widget of a dashboard, defined with `@Widget`: of a registered type,
 * holding its own data
 */
@ComplexType({ description: 'A widget of a dashboard' })
export class WidgetMetadata {
  constructor(init?: Partial<WidgetMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    description: 'Name of the widget within its dashboard: its property',
    required: true,
  })
  declare id: string;

  @ApiField({
    description: 'Its type and the type\'s version: "core.stat@1"',
    required: true,
  })
  declare type: string;

  @ApiField({ label: 'Title' })
  declare title?: string;

  @ApiField({ label: 'Description' })
  declare description?: string;

  @ApiField({ description: "The section it goes into: one of its dashboard's" })
  declare section?: string;

  @ApiField({ description: 'Its size on the grid' })
  declare size?: WidgetSize;

  @ApiField({ type: 'any', description: 'What its type takes' })
  declare properties?: Record<string, any>;

  @ApiField({ description: 'Its data: kind and bounds', required: true })
  declare data: WidgetDataMetadata;
}

/**
 * A section of a dashboard: its widgets together, under a title
 */
@ComplexType({ description: 'A section of a dashboard' })
export class DashboardSectionMetadata {
  constructor(init?: Partial<DashboardSectionMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    description: 'Name of the section within its dashboard',
    required: true,
  })
  declare id: string;

  @ApiField({ label: 'Title' })
  declare title?: string;

  @ApiField({ label: 'Description' })
  declare description?: string;

  @ApiField({
    description: 'Whether widgets defined as the worker runs may go here',
  })
  declare dynamic?: boolean;
}

/**
 * A dashboard of an element, defined with `@UseDashboard` on a property
 * whose class (a DashboardBase) defines its sections and widgets: a tab of
 * its own in the worker's page
 */
@ComplexType({ description: 'A dashboard of an element: a tab of its own' })
export class DashboardMetadata {
  constructor(init?: Partial<DashboardMetadata>) {
    if (init) Object.assign(this, init);
  }

  @ApiField({
    description: 'Name of the dashboard within its element',
    required: true,
  })
  declare name: string;

  @ApiField({ description: 'The property the dashboard is assigned to' })
  declare propertyKey?: string;

  @ApiField({ label: 'Title' })
  declare title?: string;

  @ApiField({ label: 'Description' })
  declare description?: string;

  @ApiField({ description: "Its place among its element's dashboards" })
  declare order?: number;

  @ApiField({ type: ArrayType(DashboardSectionMetadata) })
  declare sections?: DashboardSectionMetadata[];

  @ApiField({ type: ArrayType(WidgetMetadata) })
  declare widgets?: WidgetMetadata[];
}
