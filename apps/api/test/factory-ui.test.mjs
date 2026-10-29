import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SRC = readFileSync(new URL('../../../game/agent-wars/factory-cooldown.js', import.meta.url), 'utf8');

function harness({ fetchImpl, now0 = 100000 }) {
  let now = now0;
  const prompt = { id: 'prompt', disabled: false };
  const button = { id: 'compile-btn', disabled: false };
  const els = [prompt, button];
  let message;
  const timers = [];
  const document = {
    hidden: false,
    createElement: () => (message = { setAttribute() {} }),
    querySelector: () => ({ prepend() {} }),
    querySelectorAll: () => els,
    addEventListener() {},
  };
  const window = { factoryAgentReady: true, addEventListener() {} };
  runInNewContext(SRC, {
    document, window, Date: { now: () => now }, WeakMap, Math, Number, String,
    localStorage: { getItem: () => 'token' },
    fetch: fetchImpl,
    setInterval: (fn) => timers.push(fn),
  });
  const tick = async () => { await new Promise((resolve) => setImmediate(resolve)); };
  return {
    prompt, button, timers, window,
    message: () => message,
    setNow: (t) => { now = t; },
    tick,
  };
}

it('blocks the prompt and displays the server cooldown, then unlocks after expiry', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ retryAfterSeconds: 300 }) }) });
  await h.tick();
  assert.equal(h.prompt.disabled, true);
  assert.equal(h.button.disabled, true);
  assert.match(h.message().textContent, /5:00/);
  assert.equal(h.window.factoryCooldown.status().mode, 'cooling');
  assert.equal(h.window.factoryCooldown.status().seconds, 300);
  h.setNow(100000 + 300000);
  h.timers[0]();
  assert.equal(h.prompt.disabled, false);
  assert.equal(h.button.disabled, false);
  assert.match(h.message().textContent, /ready/);
});

it('prefers server timestamps over the client clock', async () => {
  const h = harness({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nextAllowedAt: 500000, now: 200000, retryAfterSeconds: 300 }) }),
  });
  await h.tick();
  assert.equal(h.window.factoryCooldown.status().mode, 'cooling');
  assert.equal(h.window.factoryCooldown.status().seconds, 300);
});

it('stays open when status is unreachable and says so', async () => {
  const h = harness({ fetchImpl: async () => { throw new Error('down'); } });
  await h.tick();
  assert.equal(h.prompt.disabled, false);
  assert.equal(h.button.disabled, false);
  assert.match(h.message().textContent, /unreachable/);
  assert.equal(h.window.factoryCooldown.status().mode, 'offline');
});

it('stays open on server errors and says so', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await h.tick();
  assert.equal(h.prompt.disabled, false);
  assert.equal(h.button.disabled, false);
  assert.match(h.message().textContent, /unreachable/);
});

it('asks for sign-in on 401 without locking the controls', async () => {
  const h = harness({ fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await h.tick();
  assert.equal(h.prompt.disabled, false);
  assert.equal(h.button.disabled, false);
  assert.match(h.message().textContent, /Sign in/);
  assert.equal(h.window.factoryCooldown.status().mode, 'signed-out');
});

