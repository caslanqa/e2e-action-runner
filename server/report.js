import AdmZip from "adm-zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Extracted reports live in a temp dir that Fastify serves statically under
// /reports/. Each run+artifact gets its own folder so multiple reports coexist.
export const reportsRoot = path.join(os.tmpdir(), "e2e-action-runner-reports");
fs.mkdirSync(reportsRoot, { recursive: true });

/**
 * Extract an artifact zip and return the URL-safe relative path (from
 * reportsRoot) to the directory that contains index.html. Playwright zips
 * sometimes nest the report under a subfolder, so we search for index.html.
 * Returns null when the artifact has no index.html (e.g. raw `allure-results`,
 * which is data, not a generated HTML report).
 */
export function extractReport(buffer, runId, artifactId) {
  const dir = path.join(reportsRoot, String(runId), String(artifactId));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const zip = new AdmZip(buffer);
  zip.extractAllTo(dir, /* overwrite */ true);

  const indexDir = findIndexHtmlDir(dir);
  if (!indexDir) {
    return null;
  }
  const relative = path.relative(reportsRoot, indexDir);
  return relative.split(path.sep).join("/");
}

/** Depth-first search for the first directory containing an index.html file. */
function findIndexHtmlDir(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "index.html")) {
      return current;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }
  return null;
}
