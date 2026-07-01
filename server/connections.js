import * as gh from "./github.js";

// A "connection" is a saved account credential for a provider. For now only
// GitHub is implemented; the shape is provider-agnostic so GitLab/Bitbucket
// adapters can be added later. Exactly one connection is "active" at a time —
// switching it just re-points github.js at that connection's token + repo.
//
// Public state never contains tokens. Tokens are persisted by the host
// (encrypted via the OS keychain in the desktop app).

let state = { connections: [], tokens: {}, activeId: null, repos: {} };
let persistCb = null;
let seq = 0;

function applyActive() {
  const id = state.activeId;
  gh.setToken(id ? state.tokens[id] || null : null);
  const repo = (id && state.repos[id]) || {};
  gh.setActiveRepo(repo.owner || "", repo.repo || "");
}

function persist() {
  if (!persistCb) {
    return;
  }
  // Snapshot now, write after the response is queued. The desktop keychain write
  // is synchronous and can briefly block the main process the first time access
  // is granted; deferring it keeps requests from appearing to freeze.
  const snapshot = {
    connections: [...state.connections],
    tokens: { ...state.tokens },
    activeId: state.activeId,
    repos: { ...state.repos },
  };
  setImmediate(() => {
    try {
      persistCb(snapshot);
    } catch (error) {
      console.warn("Could not persist connections:", error.message);
    }
  });
}

/** Load persisted state (no network) and apply the active connection. */
export function init({ connections = [], tokens = {}, activeId = null, repos = {} } = {}, onChange = null) {
  const list = Array.isArray(connections) ? connections : [];
  state = {
    connections: list,
    tokens: tokens && typeof tokens === "object" ? tokens : {},
    activeId: activeId ?? (list[0]?.id ?? null),
    repos: repos && typeof repos === "object" ? repos : {},
  };
  persistCb = onChange;
  for (const connection of list) {
    const n = Number(String(connection.id).replace(/\D/g, ""));
    if (Number.isFinite(n) && n > seq) {
      seq = n;
    }
  }
  applyActive();
}

/** Public state — safe to send to the UI (no tokens). */
export function getState() {
  const active = state.connections.find((c) => c.id === state.activeId) || null;
  const activeRepo = (state.activeId && state.repos[state.activeId]) || { owner: "", repo: "" };
  return {
    connections: state.connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      label: c.label,
      login: c.login,
    })),
    activeId: state.activeId,
    active,
    activeRepo,
    hasActiveToken: Boolean(state.activeId && state.tokens[state.activeId]),
  };
}

/** Add a GitHub connection. Validates the token first (throws 401 if invalid). */
export async function addGitHub(token, label) {
  const clean = String(token || "").trim();
  if (!clean) {
    const error = new Error("A token is required.");
    error.status = 400;
    throw error;
  }
  const login = await gh.getUserFor(clean);
  const id = `conn_${++seq}`;
  state.connections.push({ id, provider: "github", label: (label && label.trim()) || login, login });
  state.tokens[id] = clean;
  state.activeId = id;
  persist();
  applyActive();
  return getState();
}

export function remove(id) {
  state.connections = state.connections.filter((c) => c.id !== id);
  delete state.tokens[id];
  delete state.repos[id];
  if (state.activeId === id) {
    state.activeId = state.connections[0]?.id ?? null;
  }
  persist();
  applyActive();
  return getState();
}

export function setActive(id) {
  if (!state.connections.some((c) => c.id === id)) {
    const error = new Error("Unknown connection.");
    error.status = 404;
    throw error;
  }
  state.activeId = id;
  persist();
  applyActive();
  return getState();
}

export function setActiveRepo(owner, repo) {
  if (!state.activeId) {
    const error = new Error("No active connection — add one first.");
    error.status = 400;
    throw error;
  }
  state.repos[state.activeId] = { owner: owner || "", repo: repo || "" };
  persist();
  applyActive();
  return getState();
}
