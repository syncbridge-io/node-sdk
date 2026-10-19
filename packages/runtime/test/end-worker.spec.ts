import { expect } from 'expect';
import { resourcesLeft } from '../src/end-worker.js';

describe('resourcesLeft', () => {
  it("should leave out the process's own stdio and IPC pipes", () => {
    expect(resourcesLeft(['PipeWrap', 'PipeWrap', 'TTYWrap'])).toBeUndefined();
  });

  it('should count what else keeps the process alive, by kind', () => {
    expect(resourcesLeft(['PipeWrap', 'Timeout', 'TCPWrap', 'Timeout'])).toBe(
      'Timeout ×2, TCPWrap ×1',
    );
  });
});
