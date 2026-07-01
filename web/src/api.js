// Thin fetch wrapper around the local backend. Every call can carry an
// owner/repo override; empty values fall back to the server's .env defaults.

function qs(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value != null && value !== "");
  const search = new URLSearchParams(entries).toString();
  return search ? `?${search}` : "";
}

async function http(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error || `${res.status} ${res.statusText}`);
  }
  return data;
}

const jsonPost = (url, body) =>
  http(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export const api = {
  config: () => http("/api/config"),

  // Connections (multi-account)
  connections: () => http("/api/connections"),
  addConnection: (body) => jsonPost("/api/connections", body),
  removeConnection: (id) => http(`/api/connections/${id}`, { method: "DELETE" }),
  activateConnection: (id) => jsonPost(`/api/connections/${id}/activate`),
  repos: () => http("/api/repos"),
  setActiveRepo: (body) => jsonPost("/api/active-repo", body),

  meta: (coords) => http(`/api/meta${qs(coords)}`),
  workflows: (coords) => http(`/api/workflows${qs(coords)}`),
  branches: (coords) => http(`/api/branches${qs(coords)}`),
  inputs: (workflowId, ref, coords) => http(`/api/workflows/${workflowId}/inputs${qs({ ...coords, ref })}`),
  workflowRuns: (workflowId, coords) => http(`/api/workflows/${workflowId}/runs${qs(coords)}`),
  dispatch: (workflowId, body, coords) =>
    http(`/api/workflows/${workflowId}/dispatch${qs(coords)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  run: (runId, coords) => http(`/api/runs/${runId}${qs(coords)}`),
  cancelRun: (runId) => jsonPost(`/api/runs/${runId}/cancel`),
  jobs: (runId, coords) => http(`/api/runs/${runId}/jobs${qs(coords)}`),
  artifacts: (runId, coords) => http(`/api/runs/${runId}/artifacts${qs(coords)}`),
  report: (runId, artifactId, coords) =>
    http(`/api/runs/${runId}/artifacts/${artifactId}/report${qs(coords)}`),
};
