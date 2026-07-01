const { app, BrowserWindow, shell, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let serverPort = null;

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

// Connection metadata (non-secret) is plaintext JSON; tokens are stored in a
// separate keychain-encrypted blob.
function loadConnections() {
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(userFile("connections.json"), "utf8"));
  } catch {
    meta = {};
  }
  let tokens = {};
  try {
    const buffer = fs.readFileSync(userFile("tokens.enc"));
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString("utf8");
    tokens = JSON.parse(json);
  } catch {
    tokens = {};
  }
  return {
    connections: Array.isArray(meta.connections) ? meta.connections : [],
    activeId: meta.activeId ?? null,
    repos: meta.repos ?? {},
    tokens,
  };
}

function saveConnections({ connections, activeId, repos, tokens }) {
  try {
    fs.writeFileSync(userFile("connections.json"), JSON.stringify({ connections, activeId, repos }, null, 2));
  } catch (error) {
    console.warn("Could not save connections:", error.message);
  }
  try {
    const json = JSON.stringify(tokens ?? {});
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
    fs.writeFileSync(userFile("tokens.enc"), data);
  } catch (error) {
    console.warn("Could not save tokens:", error.message);
  }
}

// Legacy single-token file from earlier versions, for one-time migration.
function loadLegacyToken() {
  try {
    const buffer = fs.readFileSync(userFile("token.bin"));
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString("utf8");
  } catch {
    return null;
  }
}

// Dev convenience: read .env from the project root when running unpackaged, so
// an existing token works without re-entering it. Absent in a packaged app.
function readDotEnv() {
  try {
    const text = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) {
        out[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Start the Fastify server (ESM) inside the Electron main process so it can hold
// the keychain-backed tokens directly. The window then loads it same-origin.
async function boot() {
  const connections = await import(pathToFileURL(path.join(__dirname, "..", "server", "connections.js")).href);
  const { startServer } = await import(pathToFileURL(path.join(__dirname, "..", "server", "app.js")).href);

  const loaded = loadConnections();

  // One-time migration: seed a connection from a legacy token.bin or .env token.
  if (loaded.connections.length === 0) {
    const env = readDotEnv();
    const legacy = loadLegacyToken() || process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || null;
    if (legacy) {
      const id = "conn_1";
      loaded.connections = [{ id, provider: "github", label: "default", login: "" }];
      loaded.tokens = { [id]: legacy };
      loaded.activeId = id;
      const owner = env.GITHUB_OWNER || process.env.GITHUB_OWNER;
      const repo = env.GITHUB_REPO || process.env.GITHUB_REPO;
      if (owner && repo) {
        loaded.repos = { [id]: { owner, repo } };
      }
    }
  }

  connections.init(loaded, saveConnections);

  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    serveStaticDir: path.join(__dirname, "..", "dist"),
    logger: false,
  });
  serverPort = server.server.address().port;
  console.log(`[main] embedded server listening on http://127.0.0.1:${serverPort}`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    title: "E2E Action Runner",
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });

  if (serverPort) {
    win.loadURL(`http://127.0.0.1:${serverPort}/`);
  } else {
    win.loadURL(
      "data:text/html," +
        encodeURIComponent("<h2 style='font-family:sans-serif;padding:2rem'>Server failed to start. Check the logs.</h2>")
    );
  }

  // Open target=_blank links (e.g. "Open on GitHub") in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    await boot();
  } catch (error) {
    console.error("Failed to start the embedded server:", error);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Fully quit when the window is closed on every platform (including macOS,
// where apps normally stay resident in the Dock).
app.on("window-all-closed", () => {
  app.quit();
});
