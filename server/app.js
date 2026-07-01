import fs from "node:fs";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import * as connections from "./connections.js";
import * as gh from "./github.js";
import { extractReport, reportsRoot } from "./report.js";

/**
 * Build the Fastify app with all API routes. Optionally serves the built UI from
 * `serveStaticDir` (single-port mode). Connection state + persistence are set up
 * by the host via connections.init() before the server starts.
 */
export async function createApp({ serveStaticDir = null, logger = true } = {}) {
  const app = Fastify({ logger });

  await app.register(cors, { origin: true });

  // Extracted Playwright reports (always served, even API-only).
  await app.register(fastifyStatic, {
    root: reportsRoot,
    prefix: "/reports/",
    decorateReply: false,
  });

  // Built UI (single-port mode). Skipped in dev where Vite serves the UI, or if
  // the build output does not exist yet.
  const hasStatic = serveStaticDir && fs.existsSync(serveStaticDir);
  if (hasStatic) {
    await app.register(fastifyStatic, { root: serveStaticDir, prefix: "/" });
    // SPA fallback: serve index.html for any non-API, non-report GET.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api") && !request.url.startsWith("/reports")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found", status: 404 });
    });
  }

  // Resolve owner/repo from the query string, falling back to the defaults.
  function coords(request) {
    return {
      owner: request.query?.owner || gh.config.owner,
      repo: request.query?.repo || gh.config.repo,
    };
  }

  app.get("/api/config", async () => {
    const user = await gh.getAuthUser().catch(() => null);
    return { ...connections.getState(), user };
  });

  // ---- connection management (multi-account) ----

  app.get("/api/connections", async () => {
    return connections.getState();
  });

  app.post("/api/connections", async (request) => {
    const { provider = "github", token, label } = request.body ?? {};
    if (provider !== "github") {
      const error = new Error(`Provider "${provider}" is not supported yet.`);
      error.status = 400;
      throw error;
    }
    return connections.addGitHub(token, label);
  });

  app.delete("/api/connections/:id", async (request) => {
    return connections.remove(request.params.id);
  });

  app.post("/api/connections/:id/activate", async (request) => {
    return connections.setActive(request.params.id);
  });

  // Repositories available to the active connection (for the repo picker).
  app.get("/api/repos", async () => {
    return gh.listRepos();
  });

  // Select which repo the active connection operates on.
  app.post("/api/active-repo", async (request) => {
    const { owner, repo } = request.body ?? {};
    return connections.setActiveRepo(owner, repo);
  });

  app.get("/api/meta", async (request) => {
    const { owner, repo } = coords(request);
    return gh.getRepoMeta(owner, repo);
  });

  app.get("/api/workflows", async (request) => {
    const { owner, repo } = coords(request);
    return gh.listWorkflows(owner, repo);
  });

  app.get("/api/branches", async (request) => {
    const { owner, repo } = coords(request);
    return gh.listBranches(owner, repo);
  });

  app.get("/api/workflows/:id/inputs", async (request) => {
    const { owner, repo } = coords(request);
    const ref = request.query?.ref;
    return gh.getWorkflowInputs(request.params.id, ref, owner, repo);
  });

  app.get("/api/workflows/:id/runs", async (request) => {
    const { owner, repo } = coords(request);
    return gh.listWorkflowRuns(request.params.id, owner, repo);
  });

  app.post("/api/workflows/:id/dispatch", async (request) => {
    const { owner, repo } = coords(request);
    const { ref, inputs } = request.body ?? {};
    if (!ref) {
      const error = new Error("A git ref (branch) is required to dispatch the workflow.");
      error.status = 400;
      throw error;
    }
    return gh.dispatchAndResolve(request.params.id, ref, inputs ?? {}, owner, repo);
  });

  app.get("/api/runs/:id", async (request) => {
    const { owner, repo } = coords(request);
    return gh.getRun(request.params.id, owner, repo);
  });

  app.get("/api/runs/:id/jobs", async (request) => {
    const { owner, repo } = coords(request);
    return gh.getRunJobs(request.params.id, owner, repo);
  });

  app.get("/api/runs/:id/artifacts", async (request) => {
    const { owner, repo } = coords(request);
    return gh.listRunArtifacts(request.params.id, owner, repo);
  });

  app.get("/api/runs/:runId/artifacts/:artifactId/report", async (request) => {
    const { owner, repo } = coords(request);
    const { runId, artifactId } = request.params;
    const buffer = await gh.downloadArtifactZip(artifactId, owner, repo);
    const relative = extractReport(buffer, runId, artifactId);
    if (!relative) {
      return { hasReport: false, url: null };
    }
    return { hasReport: true, url: `/reports/${relative}/index.html` };
  });

  app.get("/api/runs/:runId/artifacts/:artifactId/download", async (request, reply) => {
    const { owner, repo } = coords(request);
    const { artifactId } = request.params;
    const safeName = String(request.query?.name ?? `artifact-${artifactId}`).replace(/["\\/]/g, "");
    const buffer = await gh.downloadArtifactZip(artifactId, owner, repo);
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${safeName}.zip"`);
    return reply.send(buffer);
  });

  // Turn Octokit / validation errors into JSON the UI can display.
  app.setErrorHandler((error, request, reply) => {
    app.log.error(error);
    const status = error.status ?? error.statusCode ?? 500;
    reply.code(status).send({ error: error.message ?? "Internal server error", status });
  });

  return app;
}

/** Build, start listening, and return the Fastify instance. */
export async function startServer({ port = 5179, host = "127.0.0.1", serveStaticDir = null, logger = true } = {}) {
  const app = await createApp({ serveStaticDir, logger });
  await app.listen({ port, host });
  return app;
}
