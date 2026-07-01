import YAML from "yaml";

// Bitbucket Cloud adapter. Maps Bitbucket Pipelines onto the common interface:
//   - "workflow" list = custom pipelines (+ a synthetic "Branch pipeline")
//   - inputs          = a custom pipeline's declared `variables`
//   - dispatch        = POST /pipelines/ with a target selector + variables
//   - runs            = pipelines; "jobs" = pipeline steps
//   - artifacts       = repo Downloads (Bitbucket has no per-run artifact zip in
//                       the REST API, so a pipeline must upload its report there)
//
// Auth: Basic (Atlassian email + API token). App passwords are deprecated.
// Repo descriptor: { workspace, slug, fullName, defaultBranch }.
const BASE = "https://api.bitbucket.org/2.0";
const DEFAULT_PIPELINE_ID = "__default__";

function mapState(state) {
  const name = state?.name;
  if (name === "IN_PROGRESS" || name === "BUILDING") {
    return { status: "in_progress", conclusion: null };
  }
  if (name === "COMPLETED") {
    switch (state?.result?.name) {
      case "SUCCESSFUL":
        return { status: "completed", conclusion: "success" };
      case "FAILED":
        return { status: "completed", conclusion: "failure" };
      case "STOPPED":
        return { status: "completed", conclusion: "cancelled" };
      case "ERROR":
        return { status: "completed", conclusion: "failure" };
      default:
        return { status: "completed", conclusion: "success" };
    }
  }
  if (name === "ERROR") {
    return { status: "completed", conclusion: "failure" };
  }
  if (name === "STOPPED") {
    return { status: "completed", conclusion: "cancelled" };
  }
  // PENDING, PAUSED, HALTED, etc.
  return { status: "queued", conclusion: null };
}

export function createBitbucketAdapter({ email, token } = {}) {
  const authHeader = "Basic " + Buffer.from(`${email ?? ""}:${token ?? ""}`).toString("base64");
  let repo = null;

  function need() {
    if (!repo || !repo.workspace || !repo.slug) {
      const error = new Error("No repository selected.");
      error.status = 400;
      throw error;
    }
    return repo;
  }

  function resultsUrl(buildNumber) {
    const { workspace, slug } = need();
    return `https://bitbucket.org/${workspace}/${slug}/pipelines/results/${buildNumber}`;
  }

  async function bb(path, { method = "GET", body } = {}) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = `Bitbucket request failed (${res.status})`;
      try {
        const data = await res.json();
        message = data?.error?.message ?? message;
      } catch {
        /* keep default */
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

  // Follow Bitbucket's `next` pagination and collect all values (capped).
  async function bbAll(path) {
    let url = path.startsWith("http") ? path : `${BASE}${path}`;
    const out = [];
    for (let page = 0; url && page < 20; page++) {
      const res = await fetch(url, { headers: { Authorization: authHeader, Accept: "application/json" } });
      if (!res.ok) {
        let message = `Bitbucket request failed (${res.status})`;
        try {
          const data = await res.json();
          message = data?.error?.message ?? message;
        } catch {
          /* keep default */
        }
        const error = new Error(message);
        error.status = res.status;
        throw error;
      }
      const data = await res.json();
      out.push(...(data.values ?? []));
      url = data.next || null;
    }
    return out;
  }

  async function bbText(path) {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: authHeader } });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const error = new Error(`Bitbucket request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return res.text();
  }

  async function readPipelinesConfig(ref) {
    const { workspace, slug } = need();
    const text = await bbText(
      `/repositories/${workspace}/${slug}/src/${encodeURIComponent(ref)}/bitbucket-pipelines.yml`
    );
    if (!text) {
      return null;
    }
    try {
      return YAML.parse(text);
    } catch {
      return null;
    }
  }

  // A custom pipeline is a list; the entry with `variables` declares its inputs.
  function inputsFromCustom(config, name) {
    const steps = config?.pipelines?.custom?.[name];
    if (!Array.isArray(steps)) {
      return [];
    }
    const varsEntry = steps.find((entry) => entry && Array.isArray(entry.variables));
    if (!varsEntry) {
      return [];
    }
    return varsEntry.variables.map((v) => ({
      name: v.name,
      description: v.description ?? "",
      required: v.default === undefined,
      default: v.default ?? "",
      type: "string", // Bitbucket pipeline variables are strings
      options: Array.isArray(v["allowed-values"]) ? v["allowed-values"] : [],
    }));
  }

  return {
    provider: "bitbucket",

    setRepo(descriptor) {
      if (descriptor && descriptor.workspace && descriptor.slug) {
        repo = { workspace: descriptor.workspace, slug: descriptor.slug, fullName: descriptor.fullName, defaultBranch: descriptor.defaultBranch };
      } else if (descriptor && descriptor.fullName && descriptor.fullName.includes("/")) {
        const [workspace, slug] = descriptor.fullName.split("/");
        repo = { workspace, slug, fullName: descriptor.fullName, defaultBranch: descriptor.defaultBranch };
      } else {
        repo = null;
      }
    },

    async validate() {
      // Prefer /user for a friendly name, but it needs the read:user:bitbucket
      // scope. If that scope wasn't granted, fall back to a repository-scope
      // check so the connection still works with just repo + pipeline scopes.
      try {
        const user = await bb("/user");
        return { login: user.display_name || user.nickname || user.username || email || "bitbucket" };
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          await bb("/repositories?role=member&pagelen=1");
          return { login: email || "bitbucket" };
        }
        throw err;
      }
    },

    async listRepos() {
      // Enumerate the user's workspaces, then repos in each — matches what the
      // user sees in Bitbucket. (role=member misses repos granted via groups.)
      const workspaces = await bbAll("/workspaces?pagelen=100");
      const repos = [];
      for (const ws of workspaces) {
        const wsRepos = await bbAll(`/repositories/${ws.slug}?pagelen=100&sort=-updated_on`);
        for (const r of wsRepos) {
          repos.push({
            id: r.full_name,
            fullName: r.full_name,
            workspace: r.workspace?.slug ?? ws.slug,
            slug: r.slug,
            private: r.is_private,
            defaultBranch: r.mainbranch?.name,
          });
        }
      }
      return repos;
    },

    async getRepoMeta() {
      const { workspace, slug } = need();
      const r = await bb(`/repositories/${workspace}/${slug}`);
      return { defaultBranch: r.mainbranch?.name, fullName: r.full_name, htmlUrl: r.links?.html?.href };
    },

    async listBranches() {
      const { workspace, slug } = need();
      const data = await bb(`/repositories/${workspace}/${slug}/refs/branches?pagelen=100&sort=name`);
      return (data.values ?? []).map((b) => b.name);
    },

    async listWorkflows() {
      const config = await readPipelinesConfig(need().defaultBranch || "main");
      const customNames = config?.pipelines?.custom ? Object.keys(config.pipelines.custom) : [];
      return [
        { id: DEFAULT_PIPELINE_ID, name: "Branch pipeline (default)", path: "bitbucket-pipelines.yml" },
        ...customNames.map((name) => ({ id: name, name: `custom: ${name}`, path: "bitbucket-pipelines.yml" })),
      ];
    },

    async getWorkflowInputs(workflowId, ref) {
      if (workflowId === DEFAULT_PIPELINE_ID) {
        return { workflowName: "Branch pipeline", path: "bitbucket-pipelines.yml", hasDispatch: true, fields: [] };
      }
      const config = await readPipelinesConfig(ref || need().defaultBranch || "main");
      return {
        workflowName: workflowId,
        path: "bitbucket-pipelines.yml",
        hasDispatch: true,
        fields: inputsFromCustom(config, workflowId),
      };
    },

    async dispatch(workflowId, ref, inputs) {
      const { workspace, slug } = need();
      const target = { type: "pipeline_ref_target", ref_type: "branch", ref_name: ref };
      if (workflowId && workflowId !== DEFAULT_PIPELINE_ID) {
        target.selector = { type: "custom", pattern: workflowId };
      }
      const variables = Object.entries(inputs ?? {})
        .filter(([, value]) => value !== "" && value != null)
        .map(([key, value]) => ({ key, value: String(value) }));
      const body = variables.length > 0 ? { target, variables } : { target };
      const pipeline = await bb(`/repositories/${workspace}/${slug}/pipelines/`, { method: "POST", body });
      return { runId: pipeline.uuid, htmlUrl: resultsUrl(pipeline.build_number) };
    },

    async listRuns() {
      const { workspace, slug } = need();
      const data = await bb(`/repositories/${workspace}/${slug}/pipelines/?sort=-created_on&pagelen=20`);
      return (data.values ?? []).map((p) => ({
        id: p.uuid,
        runNumber: p.build_number,
        ...mapState(p.state),
        event: p.trigger?.name,
        headBranch: p.target?.ref_name,
        htmlUrl: resultsUrl(p.build_number),
        createdAt: p.created_on,
        updatedAt: p.completed_on ?? p.created_on,
        runStartedAt: p.created_on,
      }));
    },

    async getRun(runId) {
      const { workspace, slug } = need();
      const p = await bb(`/repositories/${workspace}/${slug}/pipelines/${encodeURIComponent(runId)}`);
      return {
        id: p.uuid,
        runNumber: p.build_number,
        ...mapState(p.state),
        headBranch: p.target?.ref_name,
        htmlUrl: resultsUrl(p.build_number),
        createdAt: p.created_on,
        updatedAt: p.completed_on ?? p.created_on,
        runStartedAt: p.created_on,
      };
    },

    async getRunJobs(runId) {
      const { workspace, slug } = need();
      const data = await bb(`/repositories/${workspace}/${slug}/pipelines/${encodeURIComponent(runId)}/steps/`);
      return (data.values ?? []).map((s) => ({
        id: s.uuid,
        name: s.name || "step",
        ...mapState(s.state),
        startedAt: s.started_on,
        completedAt: s.completed_on,
        steps: [],
      }));
    },

    // Bitbucket has no per-run artifact zip in the REST API, so we surface the
    // repo's Downloads (where a pipeline can upload its report).
    async listArtifacts() {
      const { workspace, slug } = need();
      const data = await bb(`/repositories/${workspace}/${slug}/downloads?pagelen=100`);
      return (data.values ?? []).map((d) => ({
        id: d.name,
        name: d.name,
        sizeInBytes: d.size,
        expired: false,
        createdAt: d.created_on,
      }));
    },

    async downloadArtifact(name) {
      const { workspace, slug } = need();
      const res = await fetch(`${BASE}/repositories/${workspace}/${slug}/downloads/${encodeURIComponent(name)}`, {
        headers: { Authorization: authHeader },
      });
      if (!res.ok) {
        const error = new Error(`Bitbucket download failed (${res.status})`);
        error.status = res.status;
        throw error;
      }
      return Buffer.from(await res.arrayBuffer());
    },

    async cancelRun(runId) {
      const { workspace, slug } = need();
      await bb(`/repositories/${workspace}/${slug}/pipelines/${encodeURIComponent(runId)}/stopPipeline`, { method: "POST" });
      return { ok: true };
    },
  };
}
