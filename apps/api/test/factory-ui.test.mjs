import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

it('blocks the prompt and displays the server cooldown, then unlocks after expiry', async () => {
  let now = 100000;
  const prompt = { id: 'prompt', disabled: false };
  const button = { id: 'compile-btn', disabled: false };
  let message;
  const timers = [];
  const document = {
    hidden: false,
    createElement: () => (message = { setAttribute() {} }),
    querySelector: () => ({ prepend() {} }),
    querySelectorAll: () => [prompt, button],
    addEventListener() {},
  };
  const window = { factoryAgentReady: true, addEventListener() {} };
  const Clock = { now: () => now };
  runInNewContext(readFileSync(new URL('../../../game/agent-wars/factory-cooldown.js', import.meta.url), 'utf8'), {
    document, window, Date: Clock, WeakMap, Math, Number, String,
    localStorage: { getItem: () => 'token' },
    fetch: async () => ({ ok: true, json: async () => ({ retryAfterSeconds: 300 }) }),
    setInterval: (fn) => timers.push(fn),
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prompt.disabled, true);
  assert.equal(button.disabled, true);
  assert.match(message.textContent, /5:00/);
  now += 300000;
  timers[0]();
  assert.equal(prompt.disabled, false);
  assert.equal(button.disabled, false);
  assert.match(message.textContent, /ready/);
});
