// Bounded work and exact spawned-process ownership for the isolated lifecycle only.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
/** @param {number} started @param {()=>number} [now] */
export function isolationDeadline(started, now = () => performance.now()) {
  let reason = '';
  /** @type {(value:Error)=>void} */ let rejectAbort = () => {};
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  aborted.catch(() => {});
  const abort = (message = 'Isolated lifecycle interrupted') => {
    if (!reason) {
      reason = message;
      rejectAbort(new Error(reason));
    }
  };
  const check = () => {
    if (now() - started >= 160 * 60000) abort('Isolated lifecycle work deadline expired');
    assert.equal(reason, '', reason);
  };
  /** @param {number} ms */
  const remaining = (ms) => {
    check();
    return Math.max(1, Math.min(ms, 160 * 60000 - (now() - started)));
  };
  const cleanupRemaining = () => Math.max(0, 175 * 60000 - (now() - started));
  const timer = setTimeout(
    () => abort('Isolated lifecycle work deadline expired'),
    Math.max(1, 160 * 60000 - (now() - started)),
  );
  timer.unref();
  return { check, remaining, cleanupRemaining, abort, aborted, clear: () => clearTimeout(timer) };
}
/** @typedef {import('node:child_process').ChildProcess} Child */
/** @param {(pid:number,signal:NodeJS.Signals)=>void} [signal] */
export function isolatedProcesses(signal = (pid, value) => process.kill(pid, value)) {
  /** @type {Map<Child,{pid:number,closed:boolean,done:Promise<void>}>} */ const children =
    new Map();
  let stopping = false;
  const check = () => assert.equal(stopping, false, 'Isolated process owner is stopping');
  /** @param {Child} child */
  const register = (child) => {
    check();
    assert.ok(child.pid === undefined || child.pid > 1);
    const state = { pid: child.pid ?? 0, closed: false, done: Promise.resolve() };
    state.done = new Promise((resolve) => {
      child.once('close', () => {
        state.closed = true;
        resolve();
      });
      child.once('error', () => {
        /* close follows even when spawn fails */
      });
    });
    children.set(child, state);
  };
  /** @param {Child} child @param {NodeJS.Signals} value */
  const send = (child, value) => {
    const owned = children.get(child);
    assert.ok(owned, 'Process was not spawned by this run');
    if (owned.closed || owned.pid === 0) return;
    try {
      signal(-owned.pid, value);
    } catch {
      /* close observation still required */
    }
  };
  /** @param {number} budgetMs */
  const stop = async (budgetMs) => {
    stopping = true;
    const end = performance.now() + budgetMs;
    for (const child of children.keys()) send(child, 'SIGTERM');
    const completed = Promise.all([...children.values()].map((state) => state.done));
    await boundedJoin(completed, Math.min(3000, Math.max(0, end - performance.now())));
    for (const child of children.keys()) send(child, 'SIGKILL');
    await boundedJoin(completed, Math.min(3000, Math.max(0, end - performance.now())));
    return {
      incomplete: [...children.values()].some((state) => !state.closed),
      owned: children.size,
    };
  };
  return { check, register, send, stop };
}

/** @typedef {{profile:import('./native-isolation-profile.mjs').IsolationProfile,env:NodeJS.ProcessEnv,ids:string[],docker:(args:string[])=>string,check:()=>void,remaining:(ms:number)=>number,wait:(test:()=>Promise<boolean>,ms:number,terminal?:()=>boolean)=>Promise<void>,register:(child:Child)=>void,kill:(child:Child)=>void,beforeHost:()=>Promise<void>}} IsolatedHostContext */

/** Avoid leaving a timer after owned processes have closed.
 * @param {Promise<unknown>} completed @param {number} ms */
async function boundedJoin(completed, ms) {
  const controller = new AbortController();
  try {
    await Promise.race([
      completed,
      delay(ms, undefined, { signal: controller.signal }).catch(() => {}),
    ]);
  } finally {
    controller.abort();
  }
}
