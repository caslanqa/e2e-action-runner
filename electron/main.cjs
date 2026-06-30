const { app, BrowserWindow, shell, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let serverPort = null;

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(userFile("settings.json"), "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(userFile("settings.json"), JSON.stringify(settings, null, 2));
  } catch (error) {
    console.warn("Could not save settings:", error.message);
  }
}

// Token is encrypted at rest via the OS keychain (macOS Keychain) when available.
function loadToken() {
  try {
    const buffer = fs.readFileSync(userFile("token.bin"));
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buffer);
    }
    return buffer.toString("utf8");
  } catch {
    return null;
  }
}

function saveToken(token) {
  const file = userFile("token.bin");
  if (!token) {
    try {
      fs.rmSync(file);
    } catch {
      /* nothing to remove */
    }
    return;
  }
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(token)
    : Buffer.from(token, "utf8");
  try {
    fs.writeFileSync(file, data);
  } catch (error) {
    console.warn("Could not save token:", error.message);
  }
}

// Dev convenience: read .env from the project root when running unpackaged, so
// the existing token works without re-entering it. Absent in a packaged app.
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

// Start the Fastify server (ESM) inside the Electron main process so it can read
// the keychain-backed token directly. The window then loads it same-origin.
async function boot() {
  const gh = await import(pathToFileURL(path.join(__dirname, "..", "server", "github.js")).href);
  const { startServer } = await import(pathToFileURL(path.join(__dirname, "..", "server", "app.js")).href);

  const settings = loadSettings();
  const env = readDotEnv();
  const token = loadToken() || process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || null;
  if (token) {
    gh.setToken(token);
  }
  gh.setDefaults({
    owner: settings.owner || process.env.GITHUB_OWNER || env.GITHUB_OWNER || "datanoesiscp",
    repo: settings.repo || process.env.GITHUB_REPO || env.GITHUB_REPO || "cx-platform-e2e-test-automation-framework",
  });

  const server = await startServer({
    port: 0,
    host: "127.0.0.1",
    serveStaticDir: path.join(__dirname, "..", "dist"),
    logger: false,
    onSettingsChange: ({ token, owner, repo }) => {
      saveToken(token);
      saveSettings({ owner, repo });
    },
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
