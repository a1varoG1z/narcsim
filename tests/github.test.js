import { test } from "node:test";
import assert from "node:assert/strict";
import { saveGameToGist, loadGameFromGist } from "../js/utils/github.js";

const DUMMY_TOKEN = "dummy-test-token-not-a-real-credential";

function withMockFetch(handler, fn) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return fn().finally(() => {
    global.fetch = originalFetch;
  });
}

test("saveGameToGist POSTs a new secret gist when no gistId is given, and returns the new id", async () => {
  const calls = [];
  await withMockFetch(
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ id: "new-gist-123" }),
      };
    },
    async () => {
      const gistId = await saveGameToGist(DUMMY_TOKEN, null, { eraName: "Test Era", turn: 3 });
      assert.equal(gistId, "new-gist-123");
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/gists");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${DUMMY_TOKEN}`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.public, false);
  assert.ok(body.files["narcosim-partida.json"].content.includes("Test Era"));
});

test("saveGameToGist PATCHes an existing gist when a gistId is given", async () => {
  const calls = [];
  await withMockFetch(
    async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ id: "existing-gist-456" }) };
    },
    async () => {
      const gistId = await saveGameToGist(DUMMY_TOKEN, "existing-gist-456", { eraName: "Test Era" });
      assert.equal(gistId, "existing-gist-456");
    }
  );
  assert.equal(calls[0].url, "https://api.github.com/gists/existing-gist-456");
  assert.equal(calls[0].options.method, "PATCH");
});

test("saveGameToGist surfaces the GitHub error message on a failed request", async () => {
  await withMockFetch(
    async () => ({ ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) }),
    async () => {
      await assert.rejects(
        () => saveGameToGist(DUMMY_TOKEN, null, { eraName: "Test Era" }),
        /401.*Bad credentials/
      );
    }
  );
});

test("loadGameFromGist parses the gist's narcosim-partida.json file back into a game object", async () => {
  const fakeGame = { eraName: "Test Era", turn: 7, cartels: { x: {} } };
  await withMockFetch(
    async () => ({
      ok: true,
      json: async () => ({
        files: { "narcosim-partida.json": { content: JSON.stringify(fakeGame), truncated: false } },
      }),
    }),
    async () => {
      const loaded = await loadGameFromGist(DUMMY_TOKEN, "some-gist-id");
      assert.deepEqual(loaded, fakeGame);
    }
  );
});

test("loadGameFromGist refuses a gist that doesn't contain the expected file", async () => {
  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ files: { "other-file.txt": { content: "not a save" } } }) }),
    async () => {
      await assert.rejects(() => loadGameFromGist(DUMMY_TOKEN, "some-gist-id"), /no contiene/);
    }
  );
});

test("loadGameFromGist follows raw_url with an Authorization header when the gist content is truncated", async () => {
  const fakeGame = { eraName: "Big Save", turn: 42 };
  const calls = [];
  await withMockFetch(
    async (url, options) => {
      calls.push({ url, options });
      if (url === "https://api.github.com/gists/big-gist") {
        return {
          ok: true,
          json: async () => ({
            files: { "narcosim-partida.json": { truncated: true, raw_url: "https://gist.githubusercontent.com/raw/big-gist" } },
          }),
        };
      }
      return { ok: true, text: async () => JSON.stringify(fakeGame) };
    },
    async () => {
      const loaded = await loadGameFromGist(DUMMY_TOKEN, "big-gist");
      assert.deepEqual(loaded, fakeGame);
    }
  );
  assert.equal(calls[1].url, "https://gist.githubusercontent.com/raw/big-gist");
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${DUMMY_TOKEN}`);
});
