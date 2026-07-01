import { Octokit } from "@octokit/rest";
import YAML from "yaml";

// Default target repo. Every exported function accepts explicit owner/repo so
// the UI can point at a different repo at runtime; these are the fallbacks and
// can be updated at runtime via setDefaults (e.g. from the Settings screen).
export const config = {
  owner: process.env.GITHUB_OWNER ?? "",
  repo: process.env.GITHUB_REPO ?? "",
};

// The Octokit client is created lazily from a token that may arrive at runtime
// (from .env, or from the desktop app's encrypted Settings store).
let octokit = null;
let currentToken = null;
let cachedUser = null;

/** (Re)configure the GitHub token. Pass a falsy value to clear it. */
export function setToken(token) {
  currentToken = token || null;
  octokit = currentToken ? new Octokit({ auth: currentToken }) : null;
  cachedUser = null;
}

/** Whether a token is currently configured. */
export function hasToken() {
  return Boolean(currentToken);
}

/** The current token (used by the persistence layer; never sent to the UI). */
export function getToken() {
  return currentToken;
}

/** Update the default owner/repo. */
/** Set the active repository definitively (empty clears it). */
export function setActiveRepo(owner = "", repo = "") {
  config.owner = owner || "";
  config.repo = repo || "";
}

/** Validate a token by resolving its login, using a throwaway client. */
export async function getUserFor(token) {
  const probe = new Octokit({ auth: token });
  const { data } = await probe.rest.users.getAuthenticated();
  return data.login;
}

// Return the configured client or throw a friendly 401 if no token is set yet.
function client() {
  if (!octokit) {
    const error = new Error("No active GitHub connection — add one first.");
    error.status = 401;
    throw error;
  }
  return octokit;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Login of the token owner, used to attribute newly dispatched runs. Cached. */
export async function getAuthUser() {
  if (cachedUser) {
    return cachedUser;
  }
  const { data } = await client().rest.users.getAuthenticated();
  cachedUser = data.login;
  return cachedUser;
}

/** Default branch + display metadata for a repo. */
export async function getRepoMeta(owner = config.owner, repo = config.repo) {
  const { data } = await client().rest.repos.get({ owner, repo });
  return { defaultBranch: data.default_branch, fullName: data.full_name, htmlUrl: data.html_url };
}

/** Repositories the authenticated user can access (for the repo picker). */
export async function listRepos() {
  const repos = await client().paginate(client().rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: "updated",
    affiliation: "owner,collaborator,organization_member",
  });
  return repos.map((r) => ({
    fullName: r.full_name,
    owner: r.owner.login,
    repo: r.name,
    private: r.private,
    defaultBranch: r.default_branch,
  }));
}

/** Active and inactive workflows defined in the repo. */
export async function listWorkflows(owner = config.owner, repo = config.repo) {
  const { data } = await client().rest.actions.listRepoWorkflows({ owner, repo, per_page: 100 });
  return data.workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
}

/** Branch names, so the user can choose which ref to dispatch against. */
export async function listBranches(owner = config.owner, repo = config.repo) {
  const branches = await client().paginate(client().rest.repos.listBranches, { owner, repo, per_page: 100 });
  return branches.map((b) => b.name);
}

/**
 * Read the workflow YAML and extract its workflow_dispatch inputs so the UI can
 * render a form automatically. Returns one descriptor per input.
 */
export async function getWorkflowInputs(workflowId, ref, owner = config.owner, repo = config.repo) {
  const { data: workflow } = await client().rest.actions.getWorkflow({ owner, repo, workflow_id: workflowId });
  const { data: content } = await client().rest.repos.getContent({ owner, repo, path: workflow.path, ref });
  const yamlText = Buffer.from(content.content, content.encoding).toString("utf8");
  const parsed = YAML.parse(yamlText);

  // YAML 1.1 parsers coerce the bare key `on` to boolean true. The `yaml`
  // package uses 1.2 (so `on` stays a string), but guard both just in case.
  const on = parsed?.on ?? parsed?.[true];
  const dispatch = on?.workflow_dispatch;
  const inputs = dispatch?.inputs ?? {};

  const fields = Object.entries(inputs).map(([name, def]) => ({
    name,
    description: def?.description ?? "",
    required: Boolean(def?.required),
    default: def?.default ?? "",
    type: def?.type ?? "string",
    options: Array.isArray(def?.options) ? def.options : [],
  }));

  return {
    workflowName: workflow.name,
    path: workflow.path,
    hasDispatch: Boolean(dispatch),
    fields,
  };
}

/**
 * Trigger the workflow, then resolve the new run id. The dispatch endpoint
 * returns 204 with no body, so we snapshot the existing run ids first and poll
 * until a run id appears that did not exist before — unambiguous identification
 * without relying on timestamps or modifying the target workflow.
 */
export async function dispatchAndResolve(workflowId, ref, inputs, owner = config.owner, repo = config.repo) {
  const me = await getAuthUser().catch(() => null);

  const { data: before } = await client().rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: workflowId,
    event: "workflow_dispatch",
    per_page: 30,
  });
  const known = new Set(before.workflow_runs.map((run) => run.id));

  await client().rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: workflowId, ref, inputs });

  for (let attempt = 0; attempt < 24; attempt++) {
    await sleep(1500);
    const { data } = await client().rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowId,
      event: "workflow_dispatch",
      per_page: 30,
    });
    const fresh = data.workflow_runs
      .filter((run) => !known.has(run.id))
      .filter((run) => !me || run.actor?.login === me)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (fresh.length > 0) {
      return { runId: fresh[0].id, htmlUrl: fresh[0].html_url };
    }
  }

  throw new Error("Workflow was dispatched but the new run could not be resolved within ~36s. Check the Actions tab.");
}

/** Recent runs for a workflow, for the "past runs" picker. */
export async function listWorkflowRuns(workflowId, owner = config.owner, repo = config.repo) {
  const { data } = await client().rest.actions.listWorkflowRuns({ owner, repo, workflow_id: workflowId, per_page: 20 });
  return data.workflow_runs.map((r) => ({
    id: r.id,
    runNumber: r.run_number,
    status: r.status,
    conclusion: r.conclusion,
    event: r.event,
    headBranch: r.head_branch,
    displayTitle: r.display_title,
    htmlUrl: r.html_url,
    createdAt: r.created_at,
    runStartedAt: r.run_started_at,
    updatedAt: r.updated_at,
    actor: r.actor?.login,
  }));
}

/** Current status/conclusion for a run. */
export async function getRun(runId, owner = config.owner, repo = config.repo) {
  const { data } = await client().rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
  return {
    id: data.id,
    name: data.name,
    displayTitle: data.display_title,
    status: data.status,
    conclusion: data.conclusion,
    runNumber: data.run_number,
    event: data.event,
    headBranch: data.head_branch,
    htmlUrl: data.html_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    runStartedAt: data.run_started_at,
  };
}

/** Jobs (and their steps) for a run, for the live status panel. */
export async function getRunJobs(runId, owner = config.owner, repo = config.repo) {
  const jobs = await client().paginate(client().rest.actions.listJobsForWorkflowRun, {
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  });
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    steps: (job.steps ?? []).map((step) => ({
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
    })),
  }));
}

/** Artifacts produced by a run (e.g. the Playwright HTML report). */
export async function listRunArtifacts(runId, owner = config.owner, repo = config.repo) {
  const { data } = await client().rest.actions.listWorkflowRunArtifacts({ owner, repo, run_id: runId, per_page: 100 });
  return data.artifacts.map((a) => ({
    id: a.id,
    name: a.name,
    sizeInBytes: a.size_in_bytes,
    expired: a.expired,
    createdAt: a.created_at,
  }));
}

/** Download an artifact as a zip Buffer (Octokit follows the signed redirect). */
export async function downloadArtifactZip(artifactId, owner = config.owner, repo = config.repo) {
  const res = await client().rest.actions.downloadArtifact({
    owner,
    repo,
    artifact_id: artifactId,
    archive_format: "zip",
  });
  return Buffer.from(res.data);
}
