import { createAdapter, isSupported } from "./providers/index.js";

// A "connection" is a saved account for a provider (github now; gitlab/bitbucket
// later). Exactly one connection is active at a time; the active connection's
// adapter + selected repository serve every request.
//
// Public state never contains credentials. Credentials are persisted by the
// host (encrypted via the OS keychain in the desktop app).

let state = { connections: [], creds: {}, activeId: null, repos: {} };
let persistCb = null;
let seq = 0;
const adapters = new Map();

function adapterFor(id) {
  if (!id) {
    return null;
  }
  if (!adapters.has(id)) {
    const connection = state.connections.find((c) => c.id === id);
    if (!connection) {
      return null;
    }
    adapters.set(id, createAdapter(connection.provider, state.creds[id] || {}));
  }
  const adapter = adapters.get(id);
  adapter.setRepo(state.repos[id] || null);
  return adapter;
}

/** The active connection's adapter (repo already applied), or throw. */
export function active() {
  const adapter = adapterFor(state.activeId);
  if (!adapter) {
    const error = new Error("No active connection — add one first.");
    error.status = 400;
    throw error;
  }
  return adapter;
}

function persist() {
  if (!persistCb) {
    return;
  }
  const snapshot = {
    connections: [...state.connections],
    creds: { ...state.creds },
    activeId: state.activeId,
    repos: { ...state.repos },
  };
  // Defer so a synchronous keychain write can't stall the response (freeze).
  setImmediate(() => {
    try {
      persistCb(snapshot);
    } catch (error) {
      console.warn("Could not persist connections:", error.message);
    }
  });
}

/** Load persisted state (no network). Adapters are created lazily on demand. */
export function init({ connections = [], creds = {}, activeId = null, repos = {} } = {}, onChange = null) {
  const list = Array.isArray(connections) ? connections : [];
  state = {
    connections: list,
    creds: creds && typeof creds === "object" ? creds : {},
    activeId: activeId ?? (list[0]?.id ?? null),
    repos: repos && typeof repos === "object" ? repos : {},
  };
  persistCb = onChange;
  adapters.clear();
  for (const connection of list) {
    const n = Number(String(connection.id).replace(/\D/g, ""));
    if (Number.isFinite(n) && n > seq) {
      seq = n;
    }
  }
}

/** Public state — safe to send to the UI (no credentials). */
export function getState() {
  const activeConn = state.connections.find((c) => c.id === state.activeId) || null;
  const activeRepo = (state.activeId && state.repos[state.activeId]) || { owner: "", repo: "" };
  return {
    connections: state.connections.map((c) => ({ id: c.id, provider: c.provider, label: c.label, login: c.login })),
    activeId: state.activeId,
    active: activeConn,
    activeRepo,
    hasActiveToken: Boolean(state.activeId && state.creds[state.activeId]),
  };
}

/** Add a connection. Validates the credentials first (throws if invalid). */
export async function addConnection(provider, credentials, label) {
  if (!isSupported(provider)) {
    const error = new Error(`Provider "${provider}" is not supported yet.`);
    error.status = 400;
    throw error;
  }
  const adapter = createAdapter(provider, credentials);
  const { login } = await adapter.validate();
  const id = `conn_${++seq}`;
  state.connections.push({ id, provider, label: (label && label.trim()) || login, login });
  state.creds[id] = credentials;
  adapters.set(id, adapter);
  state.activeId = id;
  persist();
  return getState();
}

export function remove(id) {
  state.connections = state.connections.filter((c) => c.id !== id);
  delete state.creds[id];
  delete state.repos[id];
  adapters.delete(id);
  if (state.activeId === id) {
    state.activeId = state.connections[0]?.id ?? null;
  }
  persist();
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
  return getState();
}

export function setActiveRepo(descriptor) {
  if (!state.activeId) {
    const error = new Error("No active connection — add one first.");
    error.status = 400;
    throw error;
  }
  state.repos[state.activeId] = descriptor || null;
  persist();
  return getState();
}
