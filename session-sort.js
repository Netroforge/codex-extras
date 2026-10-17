"use strict";

function sortSessions(sessions, order) {
  if (order !== "latestResult") return sessions;
  return [...sessions].sort((left, right) => {
    return (right.completedAt ?? 0) - (left.completedAt ?? 0) || right.id.localeCompare(left.id);
  });
}

module.exports = { sortSessions };
