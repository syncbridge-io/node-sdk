import process from 'node:process';

export const version = '2.9.0';

// Environment variables
export const NODE_ENV =
  process.env.NODE_ENV === 'test'
    ? 'test'
    : (process.env.NODE_ENV || '').startsWith('dev')
      ? 'dev'
      : 'prod';
