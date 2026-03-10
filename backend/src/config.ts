import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(backendDir, "..");

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseCsv = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(process.env.PORT, 8080),
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  jwtTtl: process.env.JWT_TTL ?? "8h",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "ChangeThisImmediately!",
  frontendDistPath:
    process.env.FRONTEND_DIST_PATH ??
    path.resolve(repoDir, "frontend", "dist"),
  dataDir: process.env.DATA_DIR ?? path.resolve(repoDir, "data"),
  dbPath:
    process.env.DB_PATH ??
    path.resolve(process.env.DATA_DIR ?? path.resolve(repoDir, "data"), "equinav.sqlite"),
  assetsDir:
    process.env.ASSETS_DIR ??
    path.resolve(process.env.DATA_DIR ?? path.resolve(repoDir, "data"), "assets"),
  maxJsonPayload: process.env.MAX_JSON_PAYLOAD ?? "25mb",
  corsOrigins: parseCsv(process.env.CORS_ORIGINS, ["http://localhost:5173"]),
};
