import { Octokit } from "@octokit/rest";
import YAML from "yaml";

// GitHub Actions adapter. Conforms to the common provider interface used by the
// app: an adapter is bound to one connection's credentials, holds the active
// repository via setRepo(), and exposes repo/workflow/run/artifact operations.
//
// Repo descriptor for GitHub: { owner, repo, fullName }.
export function createGitHubAdapter({ token } = {}) {
  const octokit = new Octokit({ auth: token });
  let repo = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function need() {
    if (!repo || !repo.owner || !repo.repo) {
      const error = new Error("No repository selected.");
      error.status = 400;
      throw error;
    }
    return repo;
  }

  return {
    provider: "github",

    setRepo(descriptor) {
      repo = descriptor && descriptor.owner && descriptor.repo
        ? { owner: descriptor.owner, repo: descriptor.repo, fullName: descriptor.fullName || `${descriptor.owner}/${descriptor.repo}` }
        : null;
    },

    /** Validate the token and return the account identity. */
    async validate() {
      const { data } = await octokit.rest.users.getAuthenticated();
      return { login: data.login };
    },

    /** Repositories the account can access (for the repo picker). */
    async listRepos() {
      const list = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
        per_page: 100,
        sort: "updated",
        affiliation: "owner,collaborator,organization_member",
      });
      return list.map((r) => ({
        id: r.full_name,
        fullName: r.full_name,
        owner: r.owner.login,
        repo: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
      }));
    },

    async getRepoMeta() {
      const { owner, repo: name } = need();
      const { data } = await octokit.rest.repos.get({ owner, repo: name });
      return { defaultBranch: data.default_branch, fullName: data.full_name, htmlUrl: data.html_url };
    },

    async listBranches() {
      const { owner, repo: name } = need();
      const branches = await octokit.paginate(octokit.rest.repos.listBranches, { owner, repo: name, per_page: 100 });
      return branches.map((b) => b.name);
    },

    async listWorkflows() {
      const { owner, repo: name } = need();
      const { data } = await octokit.rest.actions.listRepoWorkflows({ owner, repo: name, per_page: 100 });
      return data.workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
    },

    /** Parse workflow_dispatch inputs from the workflow YAML into form fields. */
    async getWorkflowInputs(workflowId, ref) {
      const { owner, repo: name } = need();
      const { data: workflow } = await octokit.rest.actions.getWorkflow({ owner, repo: name, workflow_id: workflowId });
      const { data: content } = await octokit.rest.repos.getContent({ owner, repo: name, path: workflow.path, ref });
      const yamlText = Buffer.from(content.content, content.encoding).toString("utf8");
      const parsed = YAML.parse(yamlText);
      const on = parsed?.on ?? parsed?.[true];
      const dispatch = on?.workflow_dispatch;
      const inputs = dispatch?.inputs ?? {};
      const fields = Object.entries(inputs).map(([fieldName, def]) => ({
        name: fieldName,
        description: def?.description ?? "",
        required: Boolean(def?.required),
        default: def?.default ?? "",
        type: def?.type ?? "string",
        options: Array.isArray(def?.options) ? def.options : [],
      }));
      return { workflowName: workflow.name, path: workflow.path, hasDispatch: Boolean(dispatch), fields };
    },

    /** Trigger the workflow and resolve the new run id (dispatch returns no id). */
    async dispatch(workflowId, ref, inputs) {
      const { owner, repo: name } = need();
      const me = await this.validate().then((u) => u.login).catch(() => null);
      const { data: before } = await octokit.rest.actions.listWorkflowRuns({
        owner, repo: name, workflow_id: workflowId, event: "workflow_dispatch", per_page: 30,
      });
      const known = new Set(before.workflow_runs.map((run) => run.id));
      await octokit.rest.actions.createWorkflowDispatch({ owner, repo: name, workflow_id: workflowId, ref, inputs });
      for (let attempt = 0; attempt < 24; attempt++) {
        await sleep(1500);
        const { data } = await octokit.rest.actions.listWorkflowRuns({
          owner, repo: name, workflow_id: workflowId, event: "workflow_dispatch", per_page: 30,
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
    },

    async listRuns(workflowId) {
      const { owner, repo: name } = need();
      const { data } = await octokit.rest.actions.listWorkflowRuns({ owner, repo: name, workflow_id: workflowId, per_page: 20 });
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
      }));
    },

    async getRun(runId) {
      const { owner, repo: name } = need();
      const { data } = await octokit.rest.actions.getWorkflowRun({ owner, repo: name, run_id: runId });
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
    },

    async getRunJobs(runId) {
      const { owner, repo: name } = need();
      const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, { owner, repo: name, run_id: runId, per_page: 100 });
      return jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        steps: (job.steps ?? []).map((step) => ({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion })),
      }));
    },

    async listArtifacts(runId) {
      const { owner, repo: name } = need();
      const { data } = await octokit.rest.actions.listWorkflowRunArtifacts({ owner, repo: name, run_id: runId, per_page: 100 });
      return data.artifacts.map((a) => ({ id: a.id, name: a.name, sizeInBytes: a.size_in_bytes, expired: a.expired, createdAt: a.created_at }));
    },

    async downloadArtifact(artifactId) {
      const { owner, repo: name } = need();
      const res = await octokit.rest.actions.downloadArtifact({ owner, repo: name, artifact_id: artifactId, archive_format: "zip" });
      return Buffer.from(res.data);
    },

    async cancelRun(runId) {
      const { owner, repo: name } = need();
      await octokit.rest.actions.cancelWorkflowRun({ owner, repo: name, run_id: runId });
      return { ok: true };
    },
  };
}
