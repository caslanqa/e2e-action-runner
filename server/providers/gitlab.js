import YAML from "yaml";

// GitLab CI adapter (gitlab.com). Maps GitLab's pipeline model onto the common
// provider interface:
//   - "workflow" list = a single synthetic "Pipeline" (GitLab has one CI config)
//   - inputs          = spec:inputs declared in .gitlab-ci.yml (header document)
//   - dispatch        = POST /projects/:id/pipeline (returns the pipeline; no polling)
//   - runs            = pipelines; jobs have no sub-steps; artifacts are per-job
//
// Repo descriptor: { id (project id), fullName (path_with_namespace), defaultBranch }.
const BASE = "https://gitlab.com/api/v4";
const PIPELINE_WORKFLOW_ID = "pipeline";

// Normalize GitLab statuses to the GitHub-style { status, conclusion } the UI uses.
function mapStatus(glStatus) {
  switch (glStatus) {
    case "success":
      return { status: "completed", conclusion: "success" };
    case "failed":
      return { status: "completed", conclusion: "failure" };
    case "canceled":
    case "canceling":
      return { status: "completed", conclusion: "cancelled" };
    case "skipped":
      return { status: "completed", conclusion: "skipped" };
    case "running":
      return { status: "in_progress", conclusion: null };
    default:
      // created, waiting_for_resource, preparing, pending, manual, scheduled
      return { status: "queued", conclusion: null };
  }
}

export function createGitLabAdapter({ token } = {}) {
  let repo = null;

  function need() {
    if (!repo || !repo.id) {
      const error = new Error("No project selected.");
      error.status = 400;
      throw error;
    }
    return repo;
  }

  async function request(path, { method = "GET", body } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "PRIVATE-TOKEN": token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = `GitLab request failed (${res.status})`;
      try {
        const data = await res.json();
        const detail = data?.message ?? data?.error;
        if (detail) {
          message = typeof detail === "string" ? detail : JSON.stringify(detail);
        }
      } catch {
        /* keep default message */
      }
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) {
      return null;
    }
    return res.json();
  }

  async function requestText(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { "PRIVATE-TOKEN": token } });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const error = new Error(`GitLab request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return res.text();
  }

  async function requestBinary(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { "PRIVATE-TOKEN": token } });
    if (!res.ok) {
      const error = new Error(`GitLab artifact download failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return Buffer.from(await res.arrayBuffer());
  }

  // Read spec:inputs from the header document of .gitlab-ci.yml (before `---`).
  async function readInputs(ref) {
    const text = await requestText(
      `/projects/${need().id}/repository/files/${encodeURIComponent(".gitlab-ci.yml")}/raw?ref=${encodeURIComponent(ref)}`
    );
    if (!text) {
      return [];
    }
    let spec;
    try {
      const docs = YAML.parseAllDocuments(text);
      spec = docs[0]?.toJSON();
    } catch {
      return [];
    }
    const inputs = spec?.spec?.inputs;
    if (!inputs || typeof inputs !== "object") {
      return [];
    }
    return Object.entries(inputs).map(([name, def]) => {
      const d = def ?? {};
      const type = d.type === "boolean" || d.type === "number" || d.type === "array" ? d.type : "string";
      return {
        name,
        description: d.description ?? "",
        required: d.default === undefined,
        default: d.default ?? "",
        type,
        options: Array.isArray(d.options) ? d.options : [],
      };
    });
  }

  function coerce(field, value) {
    if (field.type === "boolean") {
      return value === true || value === "true";
    }
    if (field.type === "number") {
      return value === "" || value == null ? undefined : Number(value);
    }
    if (field.type === "array") {
      return String(value ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return String(value ?? "");
  }

  return {
    provider: "gitlab",

    setRepo(descriptor) {
      repo = descriptor && descriptor.id
        ? { id: descriptor.id, fullName: descriptor.fullName, defaultBranch: descriptor.defaultBranch }
        : null;
    },

    async validate() {
      const user = await request("/user");
      return { login: user.username };
    },

    async listRepos() {
      const projects = await request(
        "/projects?membership=true&per_page=100&order_by=last_activity_at&sort=desc&simple=true"
      );
      return projects.map((p) => ({
        id: p.id,
        fullName: p.path_with_namespace,
        private: p.visibility !== "public",
        defaultBranch: p.default_branch,
        webUrl: p.web_url,
      }));
    },

    async getRepoMeta() {
      const project = await request(`/projects/${need().id}`);
      return { defaultBranch: project.default_branch, fullName: project.path_with_namespace, htmlUrl: project.web_url };
    },

    async listBranches() {
      const branches = await request(`/projects/${need().id}/repository/branches?per_page=100`);
      return branches.map((b) => b.name);
    },

    async listWorkflows() {
      // GitLab has a single CI config, surfaced as one runnable "Pipeline".
      return [{ id: PIPELINE_WORKFLOW_ID, name: "Pipeline (.gitlab-ci.yml)", path: ".gitlab-ci.yml" }];
    },

    async getWorkflowInputs(_workflowId, ref) {
      const fields = await readInputs(ref);
      // A GitLab pipeline can always be triggered on a ref, so it's always runnable.
      return { workflowName: "Pipeline", path: ".gitlab-ci.yml", hasDispatch: true, fields };
    },

    async dispatch(_workflowId, ref, inputs) {
      const fields = await readInputs(ref);
      const byName = new Map(fields.map((f) => [f.name, f]));
      const payload = {};
      for (const [name, value] of Object.entries(inputs ?? {})) {
        const field = byName.get(name) ?? { type: "string" };
        const coerced = coerce(field, value);
        if (coerced !== undefined) {
          payload[name] = coerced;
        }
      }
      const body = Object.keys(payload).length > 0 ? { ref, inputs: payload } : { ref };
      const pipeline = await request(`/projects/${need().id}/pipeline`, { method: "POST", body });
      return { runId: pipeline.id, htmlUrl: pipeline.web_url };
    },

    async listRuns() {
      const pipelines = await request(`/projects/${need().id}/pipelines?per_page=20&order_by=id&sort=desc`);
      return pipelines.map((p) => ({
        id: p.id,
        runNumber: p.iid ?? p.id,
        ...mapStatus(p.status),
        event: p.source,
        headBranch: p.ref,
        htmlUrl: p.web_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        runStartedAt: p.created_at,
      }));
    },

    async getRun(runId) {
      const p = await request(`/projects/${need().id}/pipelines/${runId}`);
      return {
        id: p.id,
        runNumber: p.iid ?? p.id,
        ...mapStatus(p.status),
        headBranch: p.ref,
        htmlUrl: p.web_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        runStartedAt: p.started_at ?? p.created_at,
      };
    },

    async getRunJobs(runId) {
      const jobs = await request(`/projects/${need().id}/pipelines/${runId}/jobs?per_page=100`);
      return jobs.map((j) => ({
        id: j.id,
        name: `${j.stage} · ${j.name}`,
        ...mapStatus(j.status),
        startedAt: j.started_at,
        completedAt: j.finished_at,
        steps: [],
      }));
    },

    async listArtifacts(runId) {
      const jobs = await request(`/projects/${need().id}/pipelines/${runId}/jobs?per_page=100`);
      const now = Date.now();
      return jobs
        .filter((j) => j.artifacts_file && j.artifacts_file.size)
        .map((j) => ({
          id: j.id,
          name: j.name,
          sizeInBytes: j.artifacts_file.size,
          expired: Boolean(j.artifacts_expire_at && new Date(j.artifacts_expire_at).getTime() < now),
          createdAt: j.finished_at,
        }));
    },

    async downloadArtifact(jobId) {
      return requestBinary(`/projects/${need().id}/jobs/${jobId}/artifacts`);
    },

    async cancelRun(runId) {
      await request(`/projects/${need().id}/pipelines/${runId}/cancel`, { method: "POST" });
      return { ok: true };
    },
  };
}
