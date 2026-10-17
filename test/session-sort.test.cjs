"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { sortSessions } = require("../session-sort");

test("latest results stay ordered by delivery time regardless of status, read state, or focus", () => {
  const input = [
    { id: "old", completedAt: 100, status: "working", activityAt: Date.now() },
    { id: "new", completedAt: 300, status: "reviewed" },
    { id: "middle", completedAt: 200, status: "question" },
    { id: "unconfirmed", updatedAt: "2099-01-01T00:00:00Z" },
  ];
  assert.deepEqual(sortSessions(input, "latestResult").map(({ id }) => id), ["new", "middle", "old", "unconfirmed"]);
  assert.equal(input[0].id, "old", "sorting must not mutate the source list");
  assert.equal(sortSessions(input, "recent"), input);
});

test("missing or equal result timestamps have a stable identity order", () => {
  const input = [{ id: "A" }, { id: "B" }];
  assert.deepEqual(sortSessions(input, "latestResult").map(({ id }) => id), ["B", "A"]);
  input[0].title = "A changed title";
  input[0].updatedAt = "2099-01-01T00:00:00Z";
  assert.deepEqual(sortSessions(input, "latestResult").map(({ id }) => id), ["B", "A"]);
});
