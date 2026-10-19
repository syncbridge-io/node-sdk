const showActiveHandles = require('./support/show-active-handles.cjs');

process.env.TS_NODE_PROJECT = __dirname + '/tsconfig-test.json';
process.env.NODE_ENV = 'test';

/** @type {import('mocha').MochaOptions} */
module.exports = {
  require: ['@swc-node/register/esm-register'],
  extension: ['ts'],
  spec: './**/*.*spec.ts',
  ignore: ['**/node_modules/**'],
  timeout: 30000,
  rootHooks: {
    /* A test leaving a socket or timer open keeps the run from ending:
     * report what is still open, and fail rather than hang */
    afterAll: async () => {
      setTimeout(() => {
        showActiveHandles();
        process.exit(1);
      }, 5000).unref();
    },
  },
};
