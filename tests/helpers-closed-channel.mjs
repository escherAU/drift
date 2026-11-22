// DRIFT-13: a preload for tests/tools-contrast-matrix.test.js (node --import). It makes the IPC channel to a forked worker behave as it does when the worker has already exited: a send of
// `exit` after the first one, or (mode "always") any send of `exit`, emits the real ERR_IPC_CHANNEL_CLOSED error on the child process on the next tick, which crashes a process that has no
// 'error' listener. The race is real but timing-dependent; this makes it deterministic. (child.send is an own property set per child, so fork itself is wrapped.)
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const mode = process.env.CM_CLOSED_MODE || 'twice';
const realFork = cp.fork;
cp.fork = function fork(...args) {
  const child = realFork.apply(this, args);
  const send = child.send;
  let sentExit = false;
  child.send = function patched(msg, ...rest) {
    if (msg && msg.type === 'exit') {
      const again = sentExit;
      sentExit = true;
      if (again || mode === 'always') {
        const e = new Error('Channel closed');
        e.code = 'ERR_IPC_CHANNEL_CLOSED';
        process.nextTick(() => child.emit('error', e));
        if (again) return false;
      }
    }
    return send.call(child, msg, ...rest);
  };
  return child;
};
syncBuiltinESMExports();
