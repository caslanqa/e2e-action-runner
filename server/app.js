import fs from "node:fs";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import * as gh from "./github.js";
import { extractReport, reportsRoot } from "./report.js";

/**
 * Build the Fastify app with all API routes. Optionally serves the built UI from
 * `serveStaticDir` (single-port mode), and calls `onSettingsChange` so the host
 * (CLI or Electron) can persist token/owner/repo changes.
 */
export async function createApp({ serveStaticDir = null, onSettingsChange = null, logger = true } = {}) {
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
    return { owner: gh.config.owner, repo: gh.config.repo, user, hasToken: gh.hasToken() };
  });

  // Settings: report status (never the token) and accept updates.
  app.get("/api/settings", async () => {
    const user = await gh.getAuthUser().catch(() => null);
    return {
      hasToken: gh.hasToken(),
      tokenValid: Boolean(user),
      user,
      owner: gh.config.owner,
      repo: gh.config.repo,
    };
  });

  // Persist token/owner/repo off the request path. The Electron keychain write
  // (safeStorage.encryptString) is synchronous and can briefly block the main
  // process the first time access is granted; running it after the response is
  // queued stops the Settings save from appearing to freeze.
  function persistLater(snapshot) {
    if (!onSettingsChange) {
      return;
    }
    setImmediate(() => {
      try {
        onSettingsChange(snapshot);
      } catch (error) {
        app.log.error(error);
      }
    });
  }

  app.post("/api/settings", async (request) => {
    const { token, owner, repo } = request.body ?? {};
    if (typeof token === "string" && token.trim().length > 0) {
      gh.setToken(token.trim());
    }
    gh.setDefaults({ owner, repo });

    // Validate the token by resolving the authenticated user.
    const user = await gh.getAuthUser().catch(() => null);
    const result = {
      hasToken: gh.hasToken(),
      tokenValid: Boolean(user),
      user,
      owner: gh.config.owner,
      repo: gh.config.repo,
    };

    persistLater({ token: gh.getToken(), owner: gh.config.owner, repo: gh.config.repo });

    return result;
  });

  app.delete("/api/settings/token", async () => {
    gh.setToken(null);
    persistLater({ token: null, owner: gh.config.owner, repo: gh.config.repo });
    return { hasToken: false };
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
export async function startServer({
  port = 5179,
  host = "127.0.0.1",
  serveStaticDir = null,
  onSettingsChange = null,
  logger = true,
} = {}) {
  const app = await createApp({ serveStaticDir, onSettingsChange, logger });
  await app.listen({ port, host });
  return app;
}
