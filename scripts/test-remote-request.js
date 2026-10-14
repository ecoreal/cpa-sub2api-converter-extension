#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { requestWithTimeout } = require("../remote-request.js");

class FakeAbortController {
  constructor() {
    this.signal = {
      aborted: false,
      listeners: [],
      addEventListener: (type, listener) => {
        if (type === "abort") this.signal.listeners.push(listener);
      }
    };
  }

  abort() {
    this.signal.aborted = true;
    this.signal.listeners.forEach((listener) => listener());
  }
}

(async function () {
  let timeoutId = 0;
  let clearCount = 0;
  let fetchSawSignal = false;

  const pendingBody = requestWithTimeout(
    "https://example.test/slow",
    {},
    (_response, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("body aborted")));
    }),
    5,
    {
      AbortController: FakeAbortController,
      fetch: async (_url, options) => {
        fetchSawSignal = options.signal instanceof Object;
        return { headers: {}, body: {} };
      },
      setTimeout: (callback, _delay) => {
        timeoutId = setTimeout(callback, 0);
        return timeoutId;
      },
      clearTimeout: (id) => {
        clearCount += 1;
        clearTimeout(id);
      }
    }
  );

  await assert.rejects(pendingBody, /body aborted/);
  assert.equal(fetchSawSignal, true);
  assert.equal(clearCount, 1);

  let bodyFinished = false;
  let clearedBeforeBodyFinished = false;
  await requestWithTimeout(
    "https://example.test/ok",
    {},
    async () => {
      await Promise.resolve();
      clearedBeforeBodyFinished = clearCount > 1;
      bodyFinished = true;
      return { ok: true };
    },
    1000,
    {
      AbortController: FakeAbortController,
      fetch: async () => ({}),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (id) => {
        assert.equal(bodyFinished, true);
        clearTimeout(id);
      }
    }
  );

  assert.equal(clearedBeforeBodyFinished, false);
  console.log("remote request timeout regression test passed");
})();
