# E2E Action Runner

A small desktop app to trigger a CI **end‑to‑end test pipeline**, watch it run **live**, and
read the **test report** — across **GitHub Actions**, **GitLab CI**, and **Bitbucket
Pipelines**, without opening each provider's web UI.

Runs on **macOS** and **Windows** (Linux too). Your credentials stay on your machine,
stored **encrypted in the OS keychain** — they're only ever sent to the provider you connect.

**What you can do**

- Connect **one or more accounts** across GitHub / GitLab / Bitbucket, and switch between them.
- Pick a repository, a workflow/pipeline, and a branch; the inputs form is generated automatically.
- Trigger a run with one click; watch status, jobs, and steps update live.
- **Stop** a running run, browse **recent runs**, and reopen any past run.
- View the **Playwright HTML report** inline, or download any artifact.

---

# For end users

## 1. Install

Download the installer for your OS from the **[Releases](../../releases/latest)** page
(the repo is public — no login needed):

- **macOS (Apple Silicon):** `E2E.Action.Runner-<version>-arm64.dmg` → open it, drag the app to **Applications**.
- **Windows:** `E2E.Action.Runner.Setup.<version>.exe` → run it. If SmartScreen warns, click **More info → Run anyway**.

### ⚠️ macOS: "app is damaged and can't be opened" / "unidentified developer"

The app is **not code‑signed yet**, so macOS quarantines it and may refuse to open it (often
with a misleading "damaged" message). This is expected — fix it **once** by clearing the
quarantine flag in **Terminal**:

```bash
xattr -cr "/Applications/E2E Action Runner.app"
```

Then open the app normally. (If you installed it somewhere else, point the command at that
path.) You only need to do this once per install.

> macOS builds are currently **Apple Silicon (arm64)** only. On an Intel Mac, ask the
> maintainer for an Intel/universal build.

## 2. Connect an account

1. Open the left sidebar (hover it) → **Connections**.
2. **Add a connection** → choose the **provider** (GitHub / GitLab / Bitbucket).
3. Fill in the credentials for that provider (see the per‑provider guides below) → **Add connection**.
4. On the **Dashboard**, the **Account** dropdown lets you switch between connected accounts;
   the **Repository** dropdown lists that account's repos.

Credentials are stored **encrypted** (macOS Keychain / Windows DPAPI) and never leave your
machine except to call the provider. On the first save, macOS may ask to use the Keychain →
choose **Always Allow**. You can add several accounts (even across providers) and switch
anytime — no need to reconnect.

## 3. Provider setup guides

Each provider needs a token/credential with the right scopes. Create it, then paste it into
**Connections → Add a connection**.

### 🐙 GitHub

1. Create a **fine‑grained PAT**: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. **Repository access:** the repo(s) you'll run workflows in.
3. **Permissions:**

   | Permission | Access | Why |
   | --- | --- | --- |
   | Actions | **Read and write** | Trigger workflows + read runs/artifacts |
   | Contents | **Read‑only** | Read the workflow YAML to build the inputs form |
   | Metadata | **Read‑only** | Always required |

4. In the app: provider **GitHub**, paste the token.
5. In the app, a "workflow" = a `.github/workflows/*.yml` with a `workflow_dispatch` trigger;
   its `inputs` become the form.

### 🦊 GitLab (gitlab.com)

1. Create a **Personal Access Token**: [gitlab.com/-/user_settings/personal_access_tokens](https://gitlab.com/-/user_settings/personal_access_tokens)
2. **Scope:** `api` (needed to trigger pipelines).
3. In the app: provider **GitLab**, paste the token.
4. Notes: GitLab has one CI config, shown as a single **"Pipeline (.gitlab-ci.yml)"** workflow.
   Inputs come from [`spec:inputs`](https://docs.gitlab.com/ci/inputs/) in your `.gitlab-ci.yml`
   (if declared); otherwise you just trigger on a branch. Runs = pipelines; artifacts are per job.

### 🪣 Bitbucket Cloud

1. Create an **API token *with scopes***: [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   → **"Create API token with scopes"** (not the plain one) → app **Bitbucket**.
2. **Scopes:** 

  * `read:repository:bitbucket`
  * `read:pipeline:bitbucket`
  * `read:workspace:bitbucket`
  * `write:pipeline:bitbucket`
  * `read:user:bitbucket`
  * `read:project:bitbucket`
  * `read:account:bitbucket`
  
3. In the app: provider **Bitbucket**, then enter **three** fields:
   - **Atlassian email** (the account the token belongs to)
   - **API token**
   - **Workspace ID** — the name in your Bitbucket URL: `bitbucket.org/`**`<workspace>`**`/<repo>`
4. Notes:
   - **One connection = one workspace.** Atlassian removed cross‑workspace listing, so you set
     the workspace per connection. For repos in another workspace, add another Bitbucket connection.
   - A "workflow" = a **custom pipeline** from `bitbucket-pipelines.yml` (plus a "Branch pipeline")
     and its `variables` become the inputs form.
   - **Reports:** Bitbucket has no per‑run artifact download API, so the **Artifacts** list shows
     the repo's **Downloads**. For "View report" to work, your pipeline must upload the report
     there (e.g. via the `bitbucket-upload-file` pipe).

## 4. Run a pipeline

1. **Dashboard** → pick **Account** → **Repository** → **Workflow** → **Branch**.
2. Fill any inputs (pre‑filled with defaults).
3. Click **▶ Run workflow**.
4. Watch live status: pass/fail badge, jobs, steps, and an elapsed timer. Use **⊘ Stop run** to cancel.
5. When it finishes, open the report under **Artifacts → View report**, or **Download** any artifact.

Click any entry under **Recent runs** to reopen a past run + its report without re‑running.

## 5. Renew a token when it expires

Tokens expire (GitHub fine‑grained PATs often after 30 days). When one does, the app shows an
auth error. Just create a fresh token (same scopes) and add/replace the connection under
**Connections**.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| macOS won't open the app ("damaged" / "unidentified developer") | Run `xattr -cr "/Applications/E2E Action Runner.app"` once — see the macOS section above. |
| "credentials lack one or more required privilege scopes" (Bitbucket) | Recreate the API token **with scopes** and include `read:repository:bitbucket`, `read:pipeline:bitbucket`, `write:pipeline:bitbucket`. |
| Bitbucket repos don't load / "Could not load repositories" | Make sure the connection's **Workspace ID** matches `bitbucket.org/<workspace>` and the token has `read:repository:bitbucket`. |
| "No connection" / 401 / token rejected | The token is missing, invalid, or expired — add a valid one under **Connections**. |
| Repos don't load right after adding a connection | Bring the window to front and approve the one‑time macOS Keychain prompt. |
| "This artifact has no viewable HTML report" | That artifact isn't an HTML report (e.g. raw results / a non‑report download) — use **Download**. |
| App won't open on an Intel Mac | The macOS build is Apple Silicon only — request an Intel/universal build. |

---

# For maintainers / developers

## How it works

- **Electron** desktop shell. A small **Fastify** server runs *inside* the Electron main
  process; it holds the credentials and calls each provider's REST API. The window loads the
  UI from that server on `127.0.0.1` — same origin, so no CORS and credentials never reach the renderer.
- **Provider abstraction:** each provider is an adapter (`server/providers/{github,gitlab,bitbucket}.js`)
  implementing one interface (validate / listRepos / listWorkflows / getWorkflowInputs /
  dispatch / listRuns / getRun / getRunJobs / listArtifacts / downloadArtifact / cancelRun).
  `connections.js` keeps the multi‑account state and points routes at the **active** adapter + repo.
- **React + Vite** UI.
- Credentials are stored with Electron `safeStorage` (Keychain/DPAPI) in the app's `userData`
  dir (`connections.json` + encrypted `tokens.enc`). In browser/dev mode, `.env` or a local
  `.e2e-runner-store.json` is used instead.
- New‑run resolution differs per provider: GitHub's dispatch returns no id, so we snapshot the
  run list before/after; GitLab and Bitbucket return the created pipeline directly.

## Run in development

```bash
npm install

# Browser, two processes (Vite UI + API), hot reload:
npm run dev          # http://localhost:5173

# Desktop app (builds the UI, then launches Electron):
npm run app
```

For dev you can drop a GitHub token into `.env` (copy `.env.example`) so it's pre‑connected.

## Build installers locally

```bash
npm run dist:mac     # .dmg + .zip   — must run on macOS
npm run dist:win     # .exe installer — must run on Windows
```

Output goes to `release/`. `.dmg` builds only on macOS and `.exe` only on Windows — use CI for both.

## Publishing a release

Releases are produced by the **Electron Production & Release Pipeline**
(`.github/workflows/publish.yml`): GitHub → **Actions** → run it, choose the SemVer bump,
platform (`both`), and publish strategy (`draft` recommended). It bumps `package.json`, tags,
builds macOS + Windows on native runners, and attaches the installers to a single GitHub Release.

- **One copy of each asset — by design:** electron-builder runs `--publish never`; the release
  is created only by the `finalize-release` step (softprops). `build.yml` is a build‑only helper.
- **Code signing** isn't set up → unsigned installers (hence the macOS/SmartScreen prompts).
  Add an Apple Developer ID + a Windows signing cert for friction‑free installs.
- **Intel Macs:** the mac job builds arm64; add `--x64`/`--universal` to also ship Intel.

## Project structure

```
server/
  app.js          Fastify routes (provider-agnostic) + serves the built UI + reports
  connections.js  multi-account state, active connection, keychain persistence hook
  providers/      github.js · gitlab.js · bitbucket.js (one adapter each) + index.js (registry)
  report.js       unzip an artifact and serve its index.html for the report iframe
electron/         Electron main + preload (CommonJS); runs the server, opens the window
web/              React + Vite UI (single App.jsx: Sidebar, Connections, Dashboard)
.github/workflows/
  publish.yml     Release pipeline (bump → build mac+win → single GitHub Release)
  build.yml       Build-only (run artifacts, never publishes)
```

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev: Vite UI (5173) + API (5179) with hot reload |
| `npm start` | Single‑port server that also serves the built UI |
| `npm run app` | Build the UI and launch the desktop app |
| `npm run app:dev` | Launch the desktop app using the existing build |
| `npm run build` | Build the UI to `dist/` |
| `npm run dist:mac` / `dist:win` / `dist:all` | Package installers locally |
