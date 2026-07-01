import fs from "node:fs";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import * as connections from "./connections.js";
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

  app.get("/api/config", async () => {
    const state = connections.getState();
    return { ...state, user: state.active?.login ?? null };
  });

  // ---- connection management (multi-account, multi-provider) ----

  app.get("/api/connections", async () => {
    return connections.getState();
  });

  app.post("/api/connections", async (request) => {
    // Everything except provider/label is provider-specific credentials
    // (github: { token }; gitlab/bitbucket will add their own fields).
    const { provider = "github", label, ...credentials } = request.body ?? {};
    return connections.addConnection(provider, credentials, label);
  });

  app.delete("/api/connections/:id", async (request) => {
    return connections.remove(request.params.id);
  });

  app.post("/api/connections/:id/activate", async (request) => {
    return connections.setActive(request.params.id);
  });

  // Repositories available to the active connection (for the repo picker).
  app.get("/api/repos", async () => {
    return connections.active().listRepos();
  });

  // Select which repo the active connection operates on (full descriptor).
  app.post("/api/active-repo", async (request) => {
    return connections.setActiveRepo(request.body ?? null);
  });

  app.get("/api/meta", async () => {
    return connections.active().getRepoMeta();
  });

  app.get("/api/workflows", async () => {
    return connections.active().listWorkflows();
  });

  app.get("/api/branches", async () => {
    return connections.active().listBranches();
  });

  app.get("/api/workflows/:id/inputs", async (request) => {
    return connections.active().getWorkflowInputs(request.params.id, request.query?.ref);
  });

  app.get("/api/workflows/:id/runs", async (request) => {
    return connections.active().listRuns(request.params.id);
  });

  app.post("/api/workflows/:id/dispatch", async (request) => {
    const { ref, inputs } = request.body ?? {};
    if (!ref) {
      const error = new Error("A git ref (branch) is required to run the workflow.");
      error.status = 400;
      throw error;
    }
    return connections.active().dispatch(request.params.id, ref, inputs ?? {});
  });

  app.get("/api/runs/:id", async (request) => {
    return connections.active().getRun(request.params.id);
  });

  app.post("/api/runs/:id/cancel", async (request) => {
    return connections.active().cancelRun(request.params.id);
  });

  app.get("/api/runs/:id/jobs", async (request) => {
    return connections.active().getRunJobs(request.params.id);
  });

  app.get("/api/runs/:id/artifacts", async (request) => {
    return connections.active().listArtifacts(request.params.id);
  });

  app.get("/api/runs/:runId/artifacts/:artifactId/report", async (request) => {
    const { runId, artifactId } = request.params;
    const buffer = await connections.active().downloadArtifact(artifactId);
    const relative = extractReport(buffer, runId, artifactId);
    if (!relative) {
      return { hasReport: false, url: null };
    }
    return { hasReport: true, url: `/reports/${relative}/index.html` };
  });

  app.get("/api/runs/:runId/artifacts/:artifactId/download", async (request, reply) => {
    const { artifactId } = request.params;
    const safeName = String(request.query?.name ?? `artifact-${artifactId}`).replace(/["\\/]/g, "");
    const buffer = await connections.active().downloadArtifact(artifactId);
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
