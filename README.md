# E2E Action Runner

A small local dashboard to trigger a GitHub Actions **e2e test workflow**, watch
the run live, and read the **Playwright HTML report** — all in your browser, on
your machine.

```
[Browser UI :5173]  ──►  [Local backend :5179]  ──►  GitHub REST API
  form / status / report      holds the PAT,            workflow_dispatch,
                              avoids CORS                runs, jobs, artifacts
```

The GitHub token lives only on the local backend; it is never sent to the browser.

## Features

- Auto-generates the input form from the workflow's `workflow_dispatch.inputs`.
- Triggers the workflow and resolves the new run id reliably (snapshot-diff, no
  workflow changes needed).
- Live run/job/step status with an elapsed timer, polled every 3s.
- Lists run artifacts and renders the Playwright HTML report inline (iframe).
- Owner/repo are overridable from the UI at runtime.

## Setup

1. **Token.** Create a *fine-grained* Personal Access Token scoped to the repo
   `datanoesiscp/cx-platform-e2e-test-automation-framework` with:

   | Permission | Access | Why |
   | --- | --- | --- |
   | Actions | Read and write | Trigger the workflow + read runs/artifacts |
   | Contents | Read-only | Read the workflow YAML to build the form |
   | Metadata | Read-only | Always required |

   Paste it into `.env` (already created, git-ignored):

   ```
   GITHUB_TOKEN=github_pat_xxx
   ```

2. **Install & run:**

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:5173.

## Usage

1. Confirm the owner/repo in the header (defaults from `.env`), press **Connect**.
2. Pick the workflow and branch — the inputs form fills in automatically.
3. Fill inputs, press **▶ Run workflow**.
4. Watch the live status; when it finishes, open the report from **Artifacts**.

## Production-style run

```bash
npm run build      # builds the UI to ./dist
npm start          # backend only; serve ./dist separately or add a static route
```

## Notes / limitations

- Run-id resolution diffs the workflow's run list before/after dispatch. In the
  rare case two `workflow_dispatch` runs start within the same second by the same
  user, it picks the newest.
- The report viewer expects an artifact containing a Playwright HTML report
  (an `index.html`). Other report types render only if they include an
  `index.html` entry point.
- Artifacts expire per the repo's retention policy; expired ones can't be opened.
