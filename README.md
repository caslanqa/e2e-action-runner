# E2E Action Runner

A small desktop app to trigger a GitHub Actions **end‑to‑end test workflow**, watch it
run **live**, and read the **Playwright HTML report** — without opening the GitHub UI.

Runs on **macOS** and **Windows** (Linux too). Your GitHub token stays on your machine,
stored encrypted in the OS keychain — it is only ever sent to GitHub.

**What you can do**

- Pick a workflow + branch; its inputs form is generated automatically.
- Trigger a run with one click and watch status, jobs, and steps update live.
- Browse recent runs and reopen any past run.
- View the Playwright HTML report inline, or download any artifact.

---

## For end users

### 1. Install

Download the installer for your OS from the project's **Releases** page:

| OS | File | First‑launch note (unsigned build, one time only) |
| --- | --- | --- |
| macOS | `E2E Action Runner-<version>.dmg` | Open the .dmg, drag the app to **Applications**. If macOS blocks it ("unidentified developer"), **right‑click the app → Open → Open**. |
| Windows | `E2E Action Runner Setup <version>.exe` | Run it. If SmartScreen warns, click **More info → Run anyway**. |

> Building/publishing the installers is the maintainer's job — see *For maintainers* below.

### 2. Add your GitHub token (one‑time)

The app acts on GitHub for you using a **fine‑grained Personal Access Token (PAT)**.

1. Open the left menu (hover the sidebar) → **Settings**.
2. Click **Create new fine‑grained PAT ↗** — this opens GitHub in your browser.
3. Create a token with:
   - **Repository access:** the e2e test repository.
   - **Permissions:** Actions → **Read and write**, Contents → **Read‑only**, Metadata → **Read‑only**.
   - **Expiration:** your choice (e.g. 30 days).
4. Copy the token, paste it into **Settings → GitHub token**, adjust **Owner/Repo** if needed, and click **Save settings**.

When the token is valid you're taken straight to the Dashboard. The token is stored
**encrypted** on your machine (macOS Keychain / Windows DPAPI) and never leaves it except
to call GitHub. On the very first save, macOS may ask to use the Keychain → choose
**Always Allow**.

### 3. Run a workflow

1. **Dashboard** → choose **Workflow** and **Branch**.
2. Fill the inputs (pre‑filled with the workflow's defaults).
3. Click **▶ Run workflow**.
4. Watch live status: pass/fail badge, each job and step, and an elapsed timer.
5. When it finishes, open the report under **Artifacts → View report**, or **Download** the raw files.

You can also click any entry under **Recent runs** to reopen a past run and its report — no
need to re‑run.

### 4. Renew your token when it expires

Fine‑grained PATs expire (often after 30 days). When yours does:

1. Left menu → **Settings** → **Create new fine‑grained PAT ↗** (or **Manage PATs ↗** to see existing ones).
2. Generate a fresh token (same permissions), paste it, **Save**. Your Owner/Repo are kept.

### Pointing at a different repository

The Owner/Repo in **Settings** can be changed at any time — the app is not locked to one
repo. Saving a new repo reloads its workflows and branches.

### Troubleshooting

| Symptom | What to do |
| --- | --- |
| "No token" or 401 errors | Settings → paste a valid PAT → Save. |
| "Token rejected (invalid or expired)" | The PAT expired or has wrong scopes — create a new one (Actions R/W · Contents R · Metadata R). |
| Workflows don't load right after the first save | Bring the window to front and approve the one‑time macOS Keychain prompt. |
| "This artifact has no viewable HTML report" | That artifact is raw data (e.g. allure‑results), not an HTML report — use **Download**. |
| Can't download installers from Releases | The repo is private — sign in to GitHub with an account that has access. |
| Report opens fully light/dark | The Playwright report follows your system color scheme. |

---

## For maintainers / developers

### How it works

- **Electron** desktop shell. A small **Fastify** server runs *inside* the Electron main
  process; it holds the token and calls the GitHub REST API (via Octokit). The window loads
  the UI from that server on `127.0.0.1` — same origin, so no CORS and the token never
  reaches the renderer.
- **React + Vite** UI.
- Token is stored with Electron `safeStorage` (Keychain/DPAPI); owner/repo live in the app's
  `userData` dir. In browser/dev mode, `.env` or a local `.e2e-runner-store.json` is used instead.
- The new run is identified by snapshotting the workflow's run list before/after dispatch
  (the dispatch API returns no run id), so no workflow changes are needed.

### Run in development

```bash
npm install

# Browser, two processes (Vite UI + API), hot reload:
npm run dev          # http://localhost:5173

# Desktop app (builds the UI, then launches Electron):
npm run app
```

For dev you can drop a token into `.env` (copy `.env.example`) so you don't re‑enter it each time.

### Build installers locally

```bash
npm run dist:mac     # .dmg + .zip   — must run on macOS
npm run dist:win     # .exe installer — must run on Windows
```

Output is written to `release/`. `.dmg` builds only on macOS and `.exe` only on Windows, so
use CI to produce both.

### Publish a release (recommended)

`.github/workflows/build-desktop.yml` builds macOS + Windows on their native runners and
attaches the installers to a GitHub Release.

```bash
# 1) bump "version" in package.json (e.g. 0.1.0 -> 0.1.1)
# 2) tag and push
git tag v0.1.1
git push origin main --tags
```

The workflow creates a **draft** release named after the tag with both installers attached.
Review it under **Releases**, then click **Publish release** — colleagues download from there.

- **Manual build:** Actions → *Build desktop app* → *Run workflow* builds and uploads the
  installers as run artifacts without creating a release (handy for testing).
- **Token:** the workflow uses the built‑in `GITHUB_TOKEN` (`permissions: contents: write`) —
  no extra secret needed. If your org restricts this, enable write access for Actions.
- **Code signing** is not set up, so installers are unsigned (see the Gatekeeper / SmartScreen
  notes above). For friction‑free company‑wide installs, add an Apple Developer ID + a Windows
  signing certificate later.

### Required PAT permissions (on the target repo)

| Permission | Access | Why |
| --- | --- | --- |
| Actions | Read and write | Trigger the workflow + read runs/artifacts |
| Contents | Read‑only | Read the workflow YAML to build the input form |
| Metadata | Read‑only | Always required |

### Project structure

```
server/    Fastify API — github.js (Octokit), app.js (routes + static), report.js (artifact unzip)
electron/  Electron main + preload (CommonJS)
web/       React + Vite UI
.github/   build-desktop.yml release workflow
```

### npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev: Vite UI (5173) + API (5179) with hot reload |
| `npm start` | Single‑port server that also serves the built UI |
| `npm run app` | Build the UI and launch the desktop app |
| `npm run app:dev` | Launch the desktop app using the existing build |
| `npm run build` | Build the UI to `dist/` |
| `npm run dist:mac` / `dist:win` / `dist:all` | Package installers |
