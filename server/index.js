import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as gh from "./github.js";
import { startServer } from "./app.js";

// CLI / browser entry point: configure the token + defaults from a local store
// (or .env), serve the built UI on a single port, and persist Settings changes.
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
    console.warn("Could not persist settings:", error.message);
  }
}

const stored = loadStore();
const token = stored.token || process.env.GITHUB_TOKEN || null;
if (token) {
  gh.setToken(token);
}
gh.setDefaults({
  owner: stored.owner || process.env.GITHUB_OWNER,
  repo: stored.repo || process.env.GITHUB_REPO,
});

const port = Number(process.env.PORT ?? 5179);

try {
  const app = await startServer({
    port,
    host: "127.0.0.1",
    serveStaticDir: distDir,
    logger: true,
    onSettingsChange: ({ token, owner, repo }) => saveStore({ token, owner, repo }),
  });
  const address = app.server.address();
  app.log.info(`E2E Action Runner ready: http://127.0.0.1:${address.port}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
