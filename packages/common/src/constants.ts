export const version = '2.16.0';

export const CLASS_METADATA = Symbol.for('CLASS_METADATA');
export const CLASS_TYPE = Symbol.for('CLASS_TYPE');
export const VARIABLE_CONTAINER = Symbol.for('VARIABLE_CONTAINER');
export const DASHBOARD_CONTAINER = Symbol.for('DASHBOARD_CONTAINER');
/** An element class' dashboard classes by property: not in its metadata */
export const DASHBOARD_CLASSES = Symbol.for('DASHBOARD_CLASSES');

export const noOp = () => undefined;

export const NODE_ENV =
  process.env.NODE_ENV === 'test'
    ? 'test'
    : (process.env.NODE_ENV || '').startsWith('dev')
      ? 'dev'
      : 'prod';
