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

export const api = {
  config: () => http("/api/config"),
  settings: () => http("/api/settings"),
  saveSettings: (body) =>
    http("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  clearToken: () => http("/api/settings/token", { method: "DELETE" }),
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
  jobs: (runId, coords) => http(`/api/runs/${runId}/jobs${qs(coords)}`),
  artifacts: (runId, coords) => http(`/api/runs/${runId}/artifacts${qs(coords)}`),
  report: (runId, artifactId, coords) =>
    http(`/api/runs/${runId}/artifacts/${artifactId}/report${qs(coords)}`),
};
