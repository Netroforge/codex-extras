"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { itemQuestionIds, pendingQuestionIds, questionPatchMayChange } = require("../session-questions");

const id = (call, index) => JSON.stringify(["request_user_input_async", call, index]);
const ask = (call, count) => ({
  type: "agentMessage", id: call,
  questions: Array.from({ length: count }, () => ({ title: "Synthetic question" })),
});
const reply = (ids, type = "steeringUserMessage") => ({
  type,
  [type === "userMessage" ? "content" : "input"]: [{ type: "text", text:
    '<send_user_message_question_reply>\n' + JSON.stringify(ids.map((questionItemId) => ({
      questionItemId, question: "Synthetic question", answer: "Synthetic answer",
    }))) + '\n</send_user_message_question_reply>',
  }],
});

test("tracks each async question independently and clears only exact matching replies", () => {
  const state = { turns: [{ items: [ask("call-one", 2), ask("call-two", 1), reply([id("call-one", 0)])] }] };
  assert.deepEqual([...pendingQuestionIds(state)].sort(), [id("call-one", 1), id("call-two", 0)].sort());
  state.turns[0].items.push(reply([id("call-one", 1), id("call-two", 0)], "userMessage"));
  assert.equal(pendingQuestionIds(state).size, 0);
});

test("reconstructs canonical history regardless of entity order and duplicate items", () => {
  const question = ask("call-one", 1);
  const state = {
    turns: [{ items: [question] }],
    turnHistory: { history: { entitiesByKey: {
      later: { items: [reply([id("call-one", 0)])] },
      earlier: { items: [question] },
    } } },
  };
  assert.equal(pendingQuestionIds(state).size, 0);
});

test("assistant-quoted markup and replies for other IDs cannot resolve questions", () => {
  const markup = reply([id("call-one", 0)]).input;
  assert.deepEqual(itemQuestionIds({ type: "agentMessage", content: markup }).answered, []);
  const state = { turns: [{ items: [
    { type: "userMessage", content: [{ type: "text", text: "I answered elsewhere" }] },
    ask("call-one", 1),
    { type: "userInputResponse", questions: [{ id: "blocking-question" }], completed: true },
    reply([id("different-call", 0)]), reply([id("call-one", 5)]),
  ] }] };
  assert.deepEqual([...pendingQuestionIds(state)], [id("call-one", 0)]);
  assert.deepEqual(itemQuestionIds({ type: "userMessage", content: [{ type: "text", text:
    "<send_user_message_question_reply>not JSON</send_user_message_question_reply>",
  }] }).answered, []);
});

test("legacy rehydrated question IDs match a unique exact question title and index", () => {
  assert.equal(pendingQuestionIds({ turns: [{ items: [
    ask("item-3", 1), reply([id("original-call", 0)], "userMessage"),
  ] }] }).size, 0);
  assert.equal(pendingQuestionIds({ turns: [{ items: [
    ask("stable-call", 1), reply([id("different-call", 0)], "userMessage"),
  ] }] }).size, 1, "stable IDs must never use title fallback");
  assert.equal(pendingQuestionIds({ turns: [{ items: [
    ask("item-3", 1), ask("item-4", 1), reply([id("original-call", 0)], "userMessage"),
  ] }] }).size, 2, "ambiguous titles must not guess which question was answered");
});

test("a new user prompt supersedes earlier questions even inside a migrated single turn", () => {
  const items = [ask("item-3", 1), { type: "userMessage", content: [{ type: "text", text: "New instructions" }] }];
  assert.equal(pendingQuestionIds({ turns: [{ items }] }).size, 0);
  items.push(ask("new-call", 1));
  assert.deepEqual([...pendingQuestionIds({ turns: [{ items }] })], [id("new-call", 0)]);
});

test("question and reply patches request reconciliation, text streaming does not", () => {
  const prefix = ["turnHistory", "history", "entitiesByKey", "turn-one", "items"];
  assert.equal(questionPatchMayChange({ op: "add", value: ask("call-one", 1) }, [...prefix, 3]), true);
  assert.equal(questionPatchMayChange({ op: "add", value: reply([id("call-one", 0)]) }, [...prefix, 4]), true);
  assert.equal(questionPatchMayChange({ op: "replace" }, [...prefix, 3, "questions"]), true);
  assert.equal(questionPatchMayChange({ op: "remove" }, [...prefix, 3]), true);
  assert.equal(questionPatchMayChange({ op: "replace" }, [...prefix, 3, "text"]), false);
  assert.equal(questionPatchMayChange({ op: "replace" }, ["threadRuntimeStatus"]), false);
  assert.equal(questionPatchMayChange({ op: "add", value: { type: "toolCall", id: "tool" } }, [...prefix, 3]), false);
  assert.equal(questionPatchMayChange({ op: "add", value: {
    type: "userMessage", content: [{ type: "text", text: "New task" }],
  } }, [...prefix, 4]), true);
});

test("a newer ordinary user turn supersedes old async questions in canonical history order", () => {
  const prompt = { type: "userMessage", content: [{ type: "text", text: "Continue with the next task" }] };
  const state = { turnHistory: { history: {
    // Entity insertion order differs from conversation order, as in a hydrated UI.
    entitiesByKey: {
      new: { items: [prompt] },
      old: { items: [ask("old-call", 1)] },
    },
    islands: [{ entries: [{ value: "old" }, { value: "new" }] }],
  } } };
  assert.equal(pendingQuestionIds(state).size, 0);
  state.turnHistory.history.entitiesByKey.new.items.push(ask("new-call", 1));
  assert.deepEqual([...pendingQuestionIds(state)], [id("new-call", 0)]);
});

test("an async reply in a newer turn does not supersede other pending questions", () => {
  const state = { turns: [
    { items: [ask("call-one", 2)] },
    { items: [reply([id("call-one", 0)], "userMessage")] },
  ] };
  assert.deepEqual([...pendingQuestionIds(state)], [id("call-one", 1)]);
});

test("interrupted and failed turns do not keep abandoned questions active", () => {
  for (const status of ["interrupted", "failed"]) {
    assert.equal(pendingQuestionIds({ turns: [{ status, items: [ask("old-call", 1)] }] }).size, 0);
  }
  assert.equal(pendingQuestionIds({ turns: [{ status: "completed", items: [ask("current-call", 1)] }] }).size, 1);
});
