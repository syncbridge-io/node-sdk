export const version = '2.6.0';

export const CLASS_METADATA = Symbol.for('CLASS_METADATA');
export const CLASS_TYPE = Symbol.for('CLASS_TYPE');
export const VARIABLE_CONTAINER = Symbol.for('VARIABLE_CONTAINER');

export const noOp = () => undefined;

export const NODE_ENV =
  process.env.NODE_ENV === 'test'
    ? 'test'
    : (process.env.NODE_ENV || '').startsWith('dev')
      ? 'dev'
      : 'prod';
