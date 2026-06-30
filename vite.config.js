import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React UI runs on :5173 in dev and proxies API + report traffic to the
// local backend on :5179 so the GitHub token never reaches the browser.
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5179",
      "/reports": "http://localhost:5179",
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
