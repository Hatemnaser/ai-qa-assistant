import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

import {
  buildWebSecurityHeaders,
  buildNginxSecurityHeaders,
  resolveWebSecurityHeaderConfig,
} from "./build/securityHeaders.ts";

const webRootDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const buildEnv = loadEnv(
    mode,
    webRootDirectory,
    ["VITE_API_BASE_URL", "VITE_R2_ENDPOINT", "VITE_BROWSER_VIEWER_ORIGIN"]
  );
  const securityHeaderConfig = command === "build"
    ? resolveWebSecurityHeaderConfig(buildEnv)
    : null;

  return {
    envDir: webRootDirectory,
    plugins: [
      vue(),
      securityHeaderConfig && {
        name: "oddpath-web-security-headers",
        generateBundle() {
          this.emitFile({
            fileName: "_headers",
            source: buildWebSecurityHeaders(securityHeaderConfig),
            type: "asset",
          });
          this.emitFile({
            fileName: "security-headers.conf",
            source: buildNginxSecurityHeaders(securityHeaderConfig),
            type: "asset",
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:5000",
      },
    },
  };
});
