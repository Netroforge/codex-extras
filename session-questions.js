"use strict";

const REPLY_START = "<send_user_message_question_reply>";
const REPLY_END = "</send_user_message_question_reply>";

function itemQuestionIds(item) {
  const asked = [];
  const answered = [];
  const replies = [];
  if (item?.type === "agentMessage" && typeof item.id === "string" && Array.isArray(item.questions)) {
    for (let index = 0; index < item.questions.length; index++) {
      asked.push(JSON.stringify(["request_user_input_async", item.id, index]));
    }
  }
  if (item?.type === "userMessage" || item?.type === "steeringUserMessage") {
    const content = item.type === "userMessage" ? item.content : item.input;
    if (!Array.isArray(content)) return { asked, answered, replies };
    const text = content.filter((part) => part?.type === "text")
      .map((part) => part.text ?? "").join("\n").trim();
    if (!text.startsWith(REPLY_START) || !text.endsWith(REPLY_END)) return { asked, answered, replies };
    try {
      const parsed = JSON.parse(text.slice(REPLY_START.length, -REPLY_END.length));
      for (const reply of Array.isArray(parsed) ? parsed : [parsed]) {
        if (typeof reply?.questionItemId !== "string") continue;
        let id;
        try { id = JSON.parse(reply.questionItemId); } catch { continue; }
        if (Array.isArray(id) && id.length === 3 && id[0] === "request_user_input_async" &&
            typeof id[1] === "string" && Number.isInteger(id[2]) && id[2] >= 0) {
          answered.push(JSON.stringify(id));
          replies.push({ id: JSON.stringify(id), index: id[2], title: reply.question });
        }
      }
    } catch {
      // Unsupported or malformed reply markup cannot resolve a question.
    }
  }
  return { asked, answered, replies };
}

function orderedTurns(state) {
  const history = state?.turnHistory?.history;
  const entities = history?.entitiesByKey;
  if (entities && Object.keys(entities).length) {
    const entries = (history.islands ?? []).flatMap((island) => island.entries ?? []);
    if (entries.length) {
      // Hydrated entity insertion order is not conversation order.
      return { turns: entries.map((entry) => entities[entry.value]).filter(Boolean), ordered: true };
    }
    const turns = Object.values(entities);
    const ordered = turns.every((turn) => Number.isFinite(turn?.turnStartedAtMs));
    if (ordered) turns.sort((left, right) => left.turnStartedAtMs - right.turnStartedAtMs);
    return { turns, ordered };
  }
  return { turns: Array.isArray(state?.turns) ? state.turns : [], ordered: true };
}

function isNewUserPrompt(item) {
  if (item?.type !== "userMessage" || !Array.isArray(item.content)) return false;
  const text = item.content.filter((part) => part?.type === "text")
    .map((part) => part.text ?? "").join("\n").trim();
  // Even an unsupported/malformed structured reply is not a new task.
  return text.length > 0 && !text.startsWith(REPLY_START);
}

function pendingQuestionIds(state) {
  const asked = new Set();
  const answered = new Set();
  const knownIds = new Set();
  const legacy = new Map();
  const replies = [];
  let position = 0;
  const { turns, ordered } = orderedTurns(state);
  for (const turn of turns) {
    if (!Array.isArray(turn?.items)) continue;
    for (const item of turn.items) {
      position++;
      if (ordered && isNewUserPrompt(item)) {
        asked.clear();
        legacy.clear();
      }
      const ids = itemQuestionIds(item);
      for (const id of ids.asked) knownIds.add(id);
      if (turn.status !== "interrupted" && turn.status !== "failed") {
        for (const id of ids.asked) asked.add(id);
        if (/^item-\d+$/.test(item.id ?? "")) {
          for (let index = 0; index < ids.asked.length; index++) {
            legacy.set(ids.asked[index], { title: item.questions[index]?.title, index, position });
          }
        }
      }
      for (const id of ids.answered) answered.add(id);
      for (const reply of ids.replies) replies.push({ ...reply, position });
    }
  }
  for (const id of answered) asked.delete(id);
  if (ordered) {
    for (const reply of replies) {
      if (knownIds.has(reply.id) || typeof reply.title !== "string" || !reply.title) continue;
      const candidates = [...legacy].filter(([id, question]) => asked.has(id) &&
        question.position < reply.position && question.index === reply.index && question.title === reply.title);
      // Legacy rehydration can replace a call ID with item-N. Use only a unique,
      // exact question-title/index match; never fuzzy-match or inspect answers.
      if (candidates.length === 1) asked.delete(candidates[0][0]);
    }
  }
  return asked;
}

// Refresh a question projection from a snapshot when its source changes.
// Ignore ordinary assistant text deltas; never retain conversation bodies.
function questionPatchMayChange(patch, segments) {
  if (!segments.length) return true;
  if (segments[0] !== "turnHistory" && segments[0] !== "turns") return false;
  if (segments.includes("questions")) return true;
  if ((segments.at(-1) === "status" && !segments.includes("items")) || segments.includes("islands")) return true;
  if (segments[0] === "turns" && segments.length <= 2) return true;
  if (segments[0] === "turnHistory" && segments.length <= 4 &&
      !["generation", "isComplete", "islands"].includes(segments.at(-1))) return true;
  const itemIndex = segments.indexOf("items");
  if (itemIndex < 0) return false;
  if (segments.length === itemIndex + 1) return true;
  if (segments.length === itemIndex + 2) {
    if (patch.op === "remove") return true;
    const ids = itemQuestionIds(patch.value);
    return ids.asked.length > 0 || ids.answered.length > 0 || isNewUserPrompt(patch.value);
  }
  return ["input", "content", "type", "id"].includes(segments[itemIndex + 2]);
}

module.exports = { itemQuestionIds, pendingQuestionIds, questionPatchMayChange };
