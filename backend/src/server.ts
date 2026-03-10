import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "./config.js";
import { requireAuth, requireRole, signAuthToken } from "./auth.js";
import {
  activateMapVersion,
  getActiveMapDetails,
  getGraphForActiveMap,
  getRoomInActiveMap,
  getUserByUsername,
  importMapVersion,
  initializeDatabase,
  listMapVersions,
  searchRoomsInActiveMap,
} from "./db.js";
import { findShortestPath } from "./routing.js";
import { loginRequestSchema, mapImportSchema, routeRequestSchema } from "./types.js";

initializeDatabase();

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: config.nodeEnv === "production" ? false : config.corsOrigins,
  }),
);
app.use(express.json({ limit: "8mb" }));
app.use(morgan("dev"));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/admin/login", (request: Request, response: Response) => {
  const parsed = loginRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid login payload." });
    return;
  }

  const user = getUserByUsername(parsed.data.username);
  if (!user || !bcrypt.compareSync(parsed.data.password, user.password_hash)) {
    response.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const token = signAuthToken({
    id: user.id,
    username: user.username,
    role: user.role,
  });

  response.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

app.get("/api/admin/maps", requireAuth, requireRole("admin", "editor"), (_request, response) => {
  response.json({
    items: listMapVersions(),
  });
});

app.post("/api/admin/maps/import", requireAuth, requireRole("admin", "editor"), (request, response) => {
  const parsed = mapImportSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid map import payload.",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const mapVersionId = importMapVersion(parsed.data);
    response.status(201).json({
      mapVersionId,
      message: "Map imported successfully. Activate it when ready.",
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Map import failed.",
    });
  }
});

app.post(
  "/api/admin/maps/:mapVersionId/activate",
  requireAuth,
  requireRole("admin", "editor"),
  (request, response) => {
    const mapVersionId = Number(request.params.mapVersionId);
    if (!Number.isInteger(mapVersionId) || mapVersionId <= 0) {
      response.status(400).json({ error: "Invalid map version id." });
      return;
    }

    try {
      activateMapVersion(mapVersionId);
      response.json({ message: "Map version activated." });
    } catch (error) {
      response.status(404).json({
        error: error instanceof Error ? error.message : "Map activation failed.",
      });
    }
  },
);

app.get("/api/kiosk/active-map", (_request, response) => {
  response.json(getActiveMapDetails());
});

app.get("/api/kiosk/search", (request, response) => {
  const querySchema = z.object({
    q: z.string().trim().min(1),
  });
  const parsed = querySchema.safeParse(request.query);

  if (!parsed.success) {
    response.status(400).json({
      error: "Missing query parameter q.",
    });
    return;
  }

  const results = searchRoomsInActiveMap(parsed.data.q);
  response.json({ items: results });
});

app.post("/api/kiosk/route", (request, response) => {
  const parsed = routeRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid route payload.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const graphData = getGraphForActiveMap();
  if (!graphData) {
    response.status(404).json({
      error: "No active map available.",
    });
    return;
  }

  const targetRoom = getRoomInActiveMap(parsed.data.targetRoomId);
  if (!targetRoom) {
    response.status(404).json({
      error: "Target room not found in active map.",
    });
    return;
  }

  const route = findShortestPath(
    graphData.nodes,
    graphData.edges,
    graphData.startNodeId,
    targetRoom.nodeId,
    parsed.data.accessibilityOnly ?? false,
  );

  if (!route) {
    response.status(404).json({
      error: "No route found for this destination.",
    });
    return;
  }

  const nodesById = new Map(graphData.nodes.map((node) => [node.id, node]));
  const pathNodes = route.nodeIds
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);

  const floorMap = new Map<number, { id: number; label: string; imageUrl: string | null; width: number; height: number }>();
  for (const node of pathNodes) {
    if (!floorMap.has(node.floorId)) {
      floorMap.set(node.floorId, {
        id: node.floorId,
        label: node.floorLabel,
        imageUrl: node.floorImageUrl,
        width: node.floorWidth,
        height: node.floorHeight,
      });
    }
  }

  response.json({
    targetRoom,
    totalDistance: Number(route.distance.toFixed(2)),
    path: pathNodes,
    floors: [...floorMap.values()],
  });
});

const frontendIndexFile = path.resolve(config.frontendDistPath, "index.html");
if (fs.existsSync(frontendIndexFile)) {
  app.use(express.static(config.frontendDistPath));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(frontendIndexFile);
  });
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`EquiNav server running on http://localhost:${config.port}`);
});
