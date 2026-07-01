import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as connections from "./connections.js";
import { startServer } from "./app.js";

// CLI / browser entry point: load saved connections from a local store (or seed
// one from .env), serve the built UI on a single port, and persist changes.
const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, "..");
const storePath = path.join(rootDir, ".e2e-runner-store.json");
const distDir = path.join(rootDir, "dist");

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return {};
  }
}

function saveStore(data) {
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn("Could not persist connections:", error.message);
  }
}

// Older stores kept a { id: "token" } map; connections now use { id: { token } }.
function normalizeCreds(raw) {
  const out = {};
  for (const [id, value] of Object.entries(raw || {})) {
    out[id] = typeof value === "string" ? { token: value } : value;
  }
  return out;
}

const stored = loadStore();
let conns = Array.isArray(stored.connections) ? stored.connections : [];
let creds = normalizeCreds(stored.creds ?? stored.tokens ?? {});
let activeId = stored.activeId ?? null;
let repos = stored.repos ?? {};

// One-time migration: seed a connection from GITHUB_TOKEN in .env if none saved.
if (conns.length === 0 && process.env.GITHUB_TOKEN) {
  const id = "conn_env";
  conns = [{ id, provider: "github", label: "default", login: "" }];
  creds = { [id]: { token: process.env.GITHUB_TOKEN } };
  activeId = id;
  if (process.env.GITHUB_OWNER && process.env.GITHUB_REPO) {
    const fullName = `${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`;
    repos = { [id]: { owner: process.env.GITHUB_OWNER, repo: process.env.GITHUB_REPO, fullName } };
  }
}

connections.init({ connections: conns, creds, activeId, repos }, saveStore);

const port = Number(process.env.PORT ?? 5179);

try {
  const app = await startServer({ port, host: "127.0.0.1", serveStaticDir: distDir, logger: true });
  const address = app.server.address();
  app.log.info(`E2E Action Runner ready: http://127.0.0.1:${address.port}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
