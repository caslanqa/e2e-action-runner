import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

// ---- formatting helpers -----------------------------------------------------

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) {
    return "—";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Map a status/conclusion pair to a symbol + label. Symbol AND text both convey
// state so meaning never relies on color alone.
function statusInfo(status, conclusion) {
  if (status !== "completed") {
    if (status === "in_progress") {
      return { symbol: "●", label: "Running", tone: "running" };
    }
    if (status === "queued" || status === "waiting" || status === "requested" || status === "pending") {
      return { symbol: "◷", label: "Queued", tone: "queued" };
    }
    return { symbol: "◌", label: status ?? "Unknown", tone: "queued" };
  }
  switch (conclusion) {
    case "success":
      return { symbol: "✓", label: "Passed", tone: "success" };
    case "failure":
      return { symbol: "✗", label: "Failed", tone: "failure" };
    case "cancelled":
      return { symbol: "⊘", label: "Cancelled", tone: "neutral" };
    case "skipped":
      return { symbol: "↷", label: "Skipped", tone: "neutral" };
    case "timed_out":
      return { symbol: "⏱", label: "Timed out", tone: "failure" };
    default:
      return { symbol: "•", label: conclusion ?? "Completed", tone: "neutral" };
  }
}

function StatusBadge({ status, conclusion }) {
  const info = statusInfo(status, conclusion);
  return (
    <span className={`badge badge-${info.tone}`}>
      <span aria-hidden="true" className="badge-symbol">{info.symbol}</span>
      {info.label}
    </span>
  );
}

// ---- dynamic input field ----------------------------------------------------

function InputField({ field, value, onChange }) {
  const id = `wf-input-${field.name}`;
  const describedBy = field.description ? `${id}-desc` : undefined;

  let control;
  if (field.type === "boolean") {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  } else if (field.options.length > 0 || field.type === "choice") {
    control = (
      <select
        id={id}
        value={value ?? ""}
        required={field.required}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={id}
        type={field.type === "number" ? "number" : "text"}
        value={value ?? ""}
        required={field.required}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className={`field ${field.type === "boolean" ? "field-inline" : ""}`}>
      <label htmlFor={id}>
        {field.name}
        {field.required ? <span className="required" aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {field.description ? (
        <p id={describedBy} className="field-hint">{field.description}</p>
      ) : null}
    </div>
  );
}

// ---- left navigation (hover/focus to expand) -------------------------------

const GITHUB = "https://github.com";

function Sidebar({ view, onView, user, hasToken, repoFullName }) {
  const repoUrl = repoFullName ? `${GITHUB}/${repoFullName}` : GITHUB;
  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="side-brand" aria-hidden="true">E2E</div>

      <ul className="side-nav">
        <li>
          <button
            type="button"
            className={`side-item ${view === "dashboard" ? "active" : ""}`}
            aria-current={view === "dashboard" ? "page" : undefined}
            onClick={() => onView("dashboard")}
          >
            <span className="side-icon" aria-hidden="true">🧪</span>
            <span className="side-label">Dashboard</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={`side-item ${view === "settings" ? "active" : ""}`}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => onView("settings")}
          >
            <span className="side-icon" aria-hidden="true">⚙</span>
            <span className="side-label">Settings</span>
            {!hasToken ? <span className="side-dot" aria-hidden="true" /> : null}
          </button>
        </li>
      </ul>

      <div className="side-sep" aria-hidden="true" />

      <ul className="side-nav">
        <li>
          <a className="side-item" href={`${GITHUB}/settings/personal-access-tokens/new`} target="_blank" rel="noreferrer">
            <span className="side-icon" aria-hidden="true">➕</span>
            <span className="side-label">New fine-grained PAT ↗</span>
          </a>
        </li>
        <li>
          <a className="side-item" href={`${GITHUB}/settings/personal-access-tokens`} target="_blank" rel="noreferrer">
            <span className="side-icon" aria-hidden="true">🔑</span>
            <span className="side-label">Manage PATs ↗</span>
          </a>
        </li>
        <li>
          <a className="side-item" href={repoUrl} target="_blank" rel="noreferrer">
            <span className="side-icon" aria-hidden="true">📁</span>
            <span className="side-label">Repository ↗</span>
          </a>
        </li>
        <li>
          <a className="side-item" href={`${repoUrl}/actions`} target="_blank" rel="noreferrer">
            <span className="side-icon" aria-hidden="true">⚡</span>
            <span className="side-label">Actions ↗</span>
          </a>
        </li>
      </ul>

      <div className="side-foot">
        <span className={`side-status ${hasToken && user ? "ok" : "warn"}`} aria-hidden="true">●</span>
        <span className="side-label side-user">{user ? user : "No token"}</span>
      </div>
    </nav>
  );
}

// ---- settings view ----------------------------------------------------------

function SettingsView({ coords, status, busy, error, onSave, onClear }) {
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState(coords.owner);
  const [repo, setRepo] = useState(coords.repo);

  useEffect(() => {
    setOwner(coords.owner);
    setRepo(coords.repo);
  }, [coords.owner, coords.repo]);

  function submit(event) {
    event.preventDefault();
    onSave({ token, owner, repo });
    setToken("");
  }

  const statusClass = status.hasToken && status.user ? "ok" : "warn";

  return (
    <section className="card settings-view" aria-labelledby="settings-h">
      <h2 id="settings-h">Settings</h2>

      <div className={`token-status ${statusClass}`} role="status">
        {status.hasToken ? (
          status.user ? (
            <>Token active — authenticated as <strong>{status.user}</strong></>
          ) : (
            <>Token is set but GitHub rejected it (invalid or expired). Paste a fresh one below.</>
          )
        ) : (
          <>No token configured. Generate a fine-grained PAT and paste it below.</>
        )}
      </div>

      <p className="field-hint">
        Fine-grained PATs expire (often 30 days). When yours expires, create a new one on GitHub and paste it
        here — your owner/repo settings stay. The token is stored encrypted in your macOS Keychain.
      </p>

      <div className="settings-links">
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
          Create new fine-grained PAT ↗
        </a>
        <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
          Manage existing PATs ↗
        </a>
      </div>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="set-token">GitHub token (PAT)</label>
          <input
            id="set-token"
            type="password"
            autoComplete="off"
            value={token}
            placeholder={status.hasToken ? "•••••••• saved — leave blank to keep" : "github_pat_… or ghp_…"}
            onChange={(event) => setToken(event.target.value)}
          />
          <p className="field-hint">
            Required on this repo: Actions (Read &amp; write), Contents (Read), Metadata (Read).
          </p>
        </div>

        <div className="field">
          <label htmlFor="set-owner">Owner</label>
          <input id="set-owner" value={owner} onChange={(event) => setOwner(event.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="set-repo">Repo</label>
          <input id="set-repo" value={repo} onChange={(event) => setRepo(event.target.value)} />
        </div>

        <div className="settings-actions">
          <button type="submit" className="run-button" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
          {status.hasToken ? (
            <button type="button" className="ghost" onClick={onClear} disabled={busy}>
              Clear token
            </button>
          ) : null}
        </div>

        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

// ---- main app ---------------------------------------------------------------

export default function App() {
  const [coords, setCoords] = useState({ owner: "", repo: "" });
  const [user, setUser] = useState(null);
  const [connected, setConnected] = useState(false);

  const [workflows, setWorkflows] = useState([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [branches, setBranches] = useState([]);
  const [ref, setRef] = useState("");

  const [inputsSchema, setInputsSchema] = useState(null);
  const [formValues, setFormValues] = useState({});

  const [dispatching, setDispatching] = useState(false);
  const [run, setRun] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [reportUrl, setReportUrl] = useState(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportNote, setReportNote] = useState(null);
  const [recentRuns, setRecentRuns] = useState([]);

  const [view, setView] = useState("dashboard");
  const [hasToken, setHasToken] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState(null);

  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Load the server's default coords + token identity on mount, then connect.
  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        setCoords({ owner: cfg.owner ?? "", repo: cfg.repo ?? "" });
        setUser(cfg.user);
        setHasToken(Boolean(cfg.hasToken));
        if (!cfg.hasToken) {
          setView("settings");
        } else if (cfg.owner && cfg.repo) {
          loadRepo({ owner: cfg.owner, repo: cfg.repo });
        }
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRepo(target) {
    setError(null);
    try {
      const [wfList, branchList, meta] = await Promise.all([
        api.workflows(target),
        api.branches(target),
        api.meta(target),
      ]);
      setWorkflows(wfList);
      setBranches(branchList);
      setRef((current) => current || meta.defaultBranch || branchList[0] || "");
      setConnected(true);
    } catch (err) {
      setConnected(false);
      setError(err.message);
    }
  }

  // Fetch the workflow's recent runs for the picker (non-fatal on error).
  function loadRecentRuns(workflowId = selectedWorkflowId) {
    if (!workflowId) {
      setRecentRuns([]);
      return;
    }
    api
      .workflowRuns(workflowId, coords)
      .then(setRecentRuns)
      .catch(() => {});
  }

  // Load a past (or fresh) run into the detail view; its jobs + artifacts are
  // pulled by the polling/completion effects keyed on run id + status.
  function selectRun(selected) {
    setError(null);
    setJobs([]);
    setArtifacts([]);
    setReportUrl(null);
    setReportNote(null);
    setSelectedArtifactId(null);
    setNow(Date.now());
    setRun(selected);
  }

  // Save token/owner/repo from the Settings view, then reconnect on success.
  async function onSaveSettings({ token, owner, repo }) {
    const repoChanged = owner !== coords.owner || repo !== coords.repo;
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const res = await api.saveSettings({ token, owner, repo });
      setHasToken(res.hasToken);
      setUser(res.user);
      setCoords({ owner: res.owner, repo: res.repo });
      if (res.hasToken && res.tokenValid) {
        // A different repo invalidates the old workflow/branch/run selections.
        if (repoChanged) {
          setSelectedWorkflowId("");
          setRef("");
          setRun(null);
          setJobs([]);
          setArtifacts([]);
          setRecentRuns([]);
          setReportUrl(null);
          setReportNote(null);
        }
        await loadRepo({ owner: res.owner, repo: res.repo });
        setView("dashboard");
      } else if (res.hasToken && !res.tokenValid) {
        setSettingsError("Token saved, but GitHub rejected it (invalid or expired). Check the scopes and paste a fresh one.");
      } else {
        setSettingsError("No token set — paste a fine-grained PAT.");
      }
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function onClearToken() {
    setSettingsError(null);
    try {
      await api.clearToken();
      setHasToken(false);
      setUser(null);
      setConnected(false);
    } catch (err) {
      setSettingsError(err.message);
    }
  }

  // Load the workflow_dispatch input schema whenever the workflow or ref changes.
  useEffect(() => {
    if (!selectedWorkflowId || !ref) {
      setInputsSchema(null);
      return;
    }
    let cancelled = false;
    api
      .inputs(selectedWorkflowId, ref, coords)
      .then((schema) => {
        if (!cancelled) {
          setInputsSchema(schema);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setInputsSchema(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId, ref]);

  // Reset form values to the workflow's declared defaults when the schema loads.
  useEffect(() => {
    if (!inputsSchema) {
      setFormValues({});
      return;
    }
    const initial = {};
    for (const field of inputsSchema.fields) {
      initial[field.name] = field.type === "boolean" ? String(field.default) === "true" : field.default ?? "";
    }
    setFormValues(initial);
  }, [inputsSchema]);

  // Refresh the recent-runs picker whenever the selected workflow changes.
  useEffect(() => {
    loadRecentRuns(selectedWorkflowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId, connected]);

  // Poll the active run + its jobs until it completes. Artifacts are handled by
  // the separate effect below so the completion update can't be lost to this
  // effect's cleanup when the status flips to "completed".
  useEffect(() => {
    if (!run?.id || run.status === "completed") {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const [latestRun, latestJobs] = await Promise.all([api.run(run.id, coords), api.jobs(run.id, coords)]);
        if (cancelled) {
          return;
        }
        setRun(latestRun);
        setJobs(latestJobs);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      }
    };
    tick();
    const intervalId = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);

  // Once the run completes, fetch the final jobs + artifacts exactly once. This
  // effect's deps are stable after completion (polling has stopped), so its
  // cancelled flag never flips spuriously — the artifacts always land.
  useEffect(() => {
    if (run?.status !== "completed" || !run?.id) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [latestJobs, arts] = await Promise.all([api.jobs(run.id, coords), api.artifacts(run.id, coords)]);
        if (cancelled) {
          return;
        }
        setJobs(latestJobs);
        setArtifacts(arts);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      }
    })();
    // Refresh the picker so the just-finished run shows its final conclusion.
    loadRecentRuns(selectedWorkflowId);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);

  // Tick a clock once a second while a run is active, for the elapsed timer.
  useEffect(() => {
    if (!run?.id || run.status === "completed") {
      return;
    }
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [run?.id, run?.status]);

  const elapsed = useMemo(() => {
    if (!run?.runStartedAt && !run?.createdAt) {
      return null;
    }
    const start = new Date(run.runStartedAt ?? run.createdAt).getTime();
    const end = run.status === "completed" && run.updatedAt ? new Date(run.updatedAt).getTime() : now;
    return end - start;
  }, [run, now]);

  const selectedWorkflow = workflows.find((w) => String(w.id) === String(selectedWorkflowId));

  function setField(name, value) {
    setFormValues((current) => ({ ...current, [name]: value }));
  }

  async function onRun() {
    if (!inputsSchema) {
      return;
    }
    setError(null);
    const missing = inputsSchema.fields.filter(
      (field) => field.required && (formValues[field.name] === "" || formValues[field.name] == null)
    );
    if (missing.length > 0) {
      setError(`Please fill required input(s): ${missing.map((m) => m.name).join(", ")}`);
      return;
    }

    const inputs = {};
    for (const field of inputsSchema.fields) {
      const value = formValues[field.name];
      inputs[field.name] = field.type === "boolean" ? String(Boolean(value)) : String(value ?? "");
    }

    setDispatching(true);
    setRun(null);
    setJobs([]);
    setArtifacts([]);
    setReportUrl(null);
    setReportNote(null);
    setSelectedArtifactId(null);
    try {
      const { runId, htmlUrl } = await api.dispatch(selectedWorkflowId, { ref, inputs }, coords);
      setRun({ id: runId, htmlUrl, status: "queued", conclusion: null, createdAt: new Date().toISOString() });
      loadRecentRuns(selectedWorkflowId);
    } catch (err) {
      setError(err.message);
    } finally {
      setDispatching(false);
    }
  }

  function downloadHref(artifactId, name) {
    const params = new URLSearchParams({ name });
    if (coords.owner) {
      params.set("owner", coords.owner);
    }
    if (coords.repo) {
      params.set("repo", coords.repo);
    }
    return `/api/runs/${run.id}/artifacts/${artifactId}/download?${params.toString()}`;
  }

  async function onViewReport(artifactId) {
    // Set the selected artifact before awaiting so the button reflects the
    // "Downloading…" state for the whole download, not just after it resolves.
    setSelectedArtifactId(artifactId);
    setLoadingReport(true);
    setError(null);
    setReportNote(null);
    try {
      const { url, hasReport } = await api.report(run.id, artifactId, coords);
      if (hasReport && url) {
        setReportUrl(url);
      } else {
        setReportUrl(null);
        setReportNote("This artifact has no viewable HTML report (no index.html) — e.g. allure-results is raw data. Use Download to get the files.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingReport(false);
    }
  }

  const isActive = run && run.status !== "completed";

  // allure-results is raw data (no viewable report), so we hide it from the list.
  const visibleArtifacts = artifacts.filter((artifact) => artifact.name !== "allure-results");

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <Sidebar
        view={view}
        onView={setView}
        user={user}
        hasToken={hasToken}
        repoFullName={coords.owner && coords.repo ? `${coords.owner}/${coords.repo}` : ""}
      />
      <div className="app-body">
        {view === "settings" ? (
          <main id="main" tabIndex={-1} className="settings-main">
            <SettingsView
              coords={coords}
              status={{ hasToken, user, owner: coords.owner, repo: coords.repo }}
              busy={savingSettings}
              error={settingsError}
              onSave={onSaveSettings}
              onClear={onClearToken}
            />
          </main>
        ) : (
          <>
            <header className="app-header">
              <div className="brand">
                <h1>E2E Action Runner</h1>
                <p className="subtitle">
                  {coords.owner && coords.repo ? `${coords.owner}/${coords.repo}` : "Configure a repo in Settings"}
                </p>
              </div>
              <p className="token-user">
                {user ? (
                  <>Authenticated as <strong>{user}</strong></>
                ) : (
                  <>
                    No token —{" "}
                    <button type="button" className="linklike" onClick={() => setView("settings")}>
                      open Settings
                    </button>
                  </>
                )}
              </p>
            </header>

            <main id="main" tabIndex={-1} className="layout">
        <section className="card config-card" aria-labelledby="config-heading">
          <h2 id="config-heading">Run configuration</h2>

          <div className="field">
            <label htmlFor="workflow">Workflow</label>
            <select
              id="workflow"
              value={selectedWorkflowId}
              disabled={!connected}
              onChange={(event) => setSelectedWorkflowId(event.target.value)}
            >
              <option value="">{connected ? "Select a workflow…" : "Connect to a repo first"}</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} ({workflow.path.replace(".github/workflows/", "")})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="ref">Branch / ref</label>
            <select id="ref" value={ref} disabled={!connected} onChange={(event) => setRef(event.target.value)}>
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </div>

          {selectedWorkflowId && inputsSchema && !inputsSchema.hasDispatch ? (
            <p className="notice" role="status">
              This workflow has no <code>workflow_dispatch</code> trigger, so it can&apos;t be run manually.
            </p>
          ) : null}

          {inputsSchema && inputsSchema.hasDispatch ? (
            <fieldset className="inputs">
              <legend>Workflow inputs</legend>
              {inputsSchema.fields.length === 0 ? (
                <p className="field-hint">This workflow takes no inputs.</p>
              ) : (
                inputsSchema.fields.map((field) => (
                  <InputField
                    key={field.name}
                    field={field}
                    value={formValues[field.name]}
                    onChange={(value) => setField(field.name, value)}
                  />
                ))
              )}
            </fieldset>
          ) : null}

          <button
            type="button"
            className="run-button"
            onClick={onRun}
            disabled={!selectedWorkflowId || !ref || dispatching || isActive || !inputsSchema?.hasDispatch}
          >
            {dispatching ? "Dispatching…" : isActive ? "Run in progress…" : "▶ Run workflow"}
          </button>

          {error ? (
            <p className="error" role="alert">{error}</p>
          ) : null}
        </section>

        <section className="card status-card" aria-labelledby="status-heading">
          <div className="status-head">
            <h2 id="status-heading">Run status</h2>
            <button
              type="button"
              className="ghost"
              onClick={() => loadRecentRuns(selectedWorkflowId)}
              disabled={!selectedWorkflowId}
            >
              ↻ Refresh
            </button>
          </div>

          {recentRuns.length > 0 ? (
            <div className="recent">
              <h3 className="recent-title">Recent runs</h3>
              <ul className="recent-runs" aria-label="Recent runs">
                {recentRuns.map((item) => {
                  const active = String(run?.id) === String(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`recent-run ${active ? "selected" : ""}`}
                        aria-current={active ? "true" : undefined}
                        onClick={() => selectRun(item)}
                      >
                        <StatusBadge status={item.status} conclusion={item.conclusion} />
                        <span className="rr-num">#{item.runNumber}</span>
                        <span className="rr-branch">{item.headBranch}</span>
                        <span className="rr-time">{new Date(item.createdAt).toLocaleString()}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {!run ? (
            <p className="empty">Pick a run above, or configure inputs and press <strong>Run workflow</strong>.</p>
          ) : (
            <>
              <div className="run-summary" role="status" aria-live="polite">
                <StatusBadge status={run.status} conclusion={run.conclusion} />
                <span className="run-meta">
                  {run.runNumber ? `#${run.runNumber}` : "Run"} · {formatDuration(elapsed)}
                  {run.headBranch ? ` · ${run.headBranch}` : ""}
                </span>
                {run.htmlUrl ? (
                  <a className="gh-link" href={run.htmlUrl} target="_blank" rel="noreferrer">
                    Open on GitHub ↗
                  </a>
                ) : null}
              </div>

              <ol className="jobs">
                {jobs.map((job) => (
                  <li key={job.id} className="job">
                    <div className="job-head">
                      <StatusBadge status={job.status} conclusion={job.conclusion} />
                      <span className="job-name">{job.name}</span>
                    </div>
                    {job.steps.length > 0 ? (
                      <ul className="steps">
                        {job.steps.map((step) => (
                          <li key={step.number} className="step">
                            <span aria-hidden="true" className={`step-dot step-${statusInfo(step.status, step.conclusion).tone}`} />
                            <span>{step.name}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>

              {run.status === "completed" ? (
                <div className="artifacts">
                  <h3>Artifacts</h3>
                  {visibleArtifacts.length === 0 ? (
                    <p className="field-hint">No artifacts on this run.</p>
                  ) : (
                    <ul>
                      {visibleArtifacts.map((artifact) => (
                        <li key={artifact.id} className="artifact">
                          <span className="artifact-name">{artifact.name}</span>
                          <span className="artifact-size">{formatBytes(artifact.sizeInBytes)}</span>
                          <span className="artifact-actions">
                            {artifact.expired ? null : (
                              <a className="artifact-dl" href={downloadHref(artifact.id, artifact.name)}>
                                Download
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => onViewReport(artifact.id)}
                              disabled={artifact.expired || loadingReport}
                              aria-pressed={selectedArtifactId === artifact.id}
                              aria-busy={loadingReport && selectedArtifactId === artifact.id}
                            >
                              {artifact.expired ? (
                                "Expired"
                              ) : loadingReport && selectedArtifactId === artifact.id ? (
                                <span className="btn-loading">
                                  <span className="spinner" aria-hidden="true" />
                                  Downloading…
                                </span>
                              ) : (
                                "View report"
                              )}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {reportNote ? <p className="notice" role="status">{reportNote}</p> : null}
                </div>
              ) : null}
            </>
          )}
        </section>

        {reportUrl ? (
          <section className="card report-card" aria-labelledby="report-heading">
            <div className="report-head">
              <h2 id="report-heading">Test report</h2>
              <a href={reportUrl} target="_blank" rel="noreferrer">Open report in new tab ↗</a>
            </div>
            <iframe className="report-frame" src={reportUrl} title="Playwright test report" />
          </section>
        ) : null}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
