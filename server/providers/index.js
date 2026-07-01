import { createBitbucketAdapter } from "./bitbucket.js";
import { createGitHubAdapter } from "./github.js";
import { createGitLabAdapter } from "./gitlab.js";

// Provider registry. Each entry exposes a display label and a factory that
// builds an adapter bound to a connection's credentials.
export const PROVIDERS = {
  github: { label: "GitHub", create: createGitHubAdapter },
  gitlab: { label: "GitLab", create: createGitLabAdapter },
  bitbucket: { label: "Bitbucket", create: createBitbucketAdapter },
};

export function isSupported(provider) {
  return Boolean(PROVIDERS[provider]);
}

export function createAdapter(provider, credentials) {
  const entry = PROVIDERS[provider];
  if (!entry) {
    const error = new Error(`Provider "${provider}" is not supported yet.`);
    error.status = 400;
    throw error;
  }
  return entry.create(credentials ?? {});
}
