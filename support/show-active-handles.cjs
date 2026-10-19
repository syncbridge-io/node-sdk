const process = require('node:process');
const { Server, Socket } = require('node:net');

function showActiveHandles() {
  // @ts-ignore: _getActiveHandles is private
  const handles = process._getActiveHandles();
  const lines = handles
    .map(h => {
      let s = '';
      if (h.constructor && h.constructor.name) {
        if (
          h instanceof Socket &&
          (h.closed || h.remoteAddress === undefined)
        ) {
          return;
        }
        if (h instanceof Server && !h.listening) return;
        s = `- Type: ${h.constructor.name}`;
      } else {
        s += '- Unknown Handle ' + h;
      }
      if (h.server) s += '  (Server)';
      if (h.remoteAddress) s += `  Remote: ${h.remoteAddress}:${h.remotePort}`;
      // if it is a Timer (setTimeout/setInterval)
      if (h._idleTimeout) s += `  Timer Duration: ${h._idleTimeout}`;
      return s;
    })
    .filter(s => !!s);
  if (lines.length) console.warn('Active Handles:' + lines.join('\n  '));
}

module.exports = showActiveHandles;
