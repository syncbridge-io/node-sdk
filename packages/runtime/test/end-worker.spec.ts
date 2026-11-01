import { expect } from 'expect';
import { resourcesLeft } from '../src/end-worker.js';

describe('resourcesLeft', () => {
  it("should leave out the process's own stdio and IPC pipes", () => {
    expect(resourcesLeft(['PipeWrap', 'PipeWrap', 'TTYWrap'])).toBeUndefined();
  });

  it('should leave out a write to them still on its way: a busy host reads it late', () => {
    expect(
      resourcesLeft(['PipeWrap', 'SimpleWriteWrap', 'WriteWrap']),
    ).toBeUndefined();
    /* A socket's write in flight: the socket tells it */
    expect(resourcesLeft(['TCPWrap', 'WriteWrap'])).toBe('TCPWrap ×1');
  });

  it('should count what else keeps the process alive, by kind', () => {
    expect(resourcesLeft(['PipeWrap', 'Timeout', 'TCPWrap', 'Timeout'])).toBe(
      'Timeout ×2, TCPWrap ×1',
    );
  });
});
