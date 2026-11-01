import { serve } from "bun";
import path from "node:path";
import index from "./index.html";
import { createApiRoutes } from "./server/api";
import { loadConfig, resolveStartupConfigPath } from "./server/config";

const configPath = resolveStartupConfigPath();
const initialConfig = await loadConfig(configPath);
const port = Number(
  process.env.PORT || initialConfig.port || (initialConfig.role === "B" ? 3001 : 3000),
);

const server = serve({
  port,
  maxRequestBodySize: 1024 * 1024 * 512,
  routes: {
    ...createApiRoutes({ configPath }),
    "/*": index,
  },
  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

const relConfig = path.relative(process.cwd(), configPath);
console.log(
  `🔐 CipherDuct [${initialConfig.role}サイト: ${initialConfig.site_name}] running at ${server.url} (config: ${relConfig})`,
);
