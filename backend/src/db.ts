import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { config } from "./config.js";
import type { GraphEdge, GraphNode, MapImportPayload } from "./types.js";

type DbUser = {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "editor" | "viewer";
};

type ActiveMap = {
  id: number;
  name: string;
  description: string | null;
  start_node_id: number | null;
};

const GLOBAL_START_NODE_KEY = "global_start_node_external_id";

export const ensureDataDirectory = (): void => {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
};

ensureDataDirectory();
const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const createSchema = (): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
      start_node_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS floors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_version_id INTEGER NOT NULL,
      building TEXT NOT NULL,
      floor_level INTEGER NOT NULL,
      label TEXT NOT NULL,
      image_url TEXT,
      width REAL NOT NULL DEFAULT 1000,
      height REAL NOT NULL DEFAULT 700,
      created_at TEXT NOT NULL,
      UNIQUE(map_version_id, building, floor_level),
      FOREIGN KEY(map_version_id) REFERENCES map_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_version_id INTEGER NOT NULL,
      floor_id INTEGER NOT NULL,
      external_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      label TEXT,
      x REAL NOT NULL,
      y REAL NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(map_version_id, external_id),
      FOREIGN KEY(map_version_id) REFERENCES map_versions(id) ON DELETE CASCADE,
      FOREIGN KEY(floor_id) REFERENCES floors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_version_id INTEGER NOT NULL,
      floor_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      module_name TEXT,
      node_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(map_version_id, code),
      FOREIGN KEY(map_version_id) REFERENCES map_versions(id) ON DELETE CASCADE,
      FOREIGN KEY(floor_id) REFERENCES floors(id) ON DELETE CASCADE,
      FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_version_id INTEGER NOT NULL,
      from_node_id INTEGER NOT NULL,
      to_node_id INTEGER NOT NULL,
      distance REAL NOT NULL,
      accessible INTEGER NOT NULL DEFAULT 1 CHECK (accessible IN (0,1)),
      created_at TEXT NOT NULL,
      FOREIGN KEY(map_version_id) REFERENCES map_versions(id) ON DELETE CASCADE,
      FOREIGN KEY(from_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY(to_node_id) REFERENCES nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_map_versions_active ON map_versions(is_active);
    CREATE INDEX IF NOT EXISTS idx_rooms_search ON rooms(code, name, module_name);
    CREATE INDEX IF NOT EXISTS idx_edges_map ON edges(map_version_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_map ON nodes(map_version_id);
  `);
};

const seedAdminUser = (): void => {
  const existingUser = db
    .prepare<unknown[], DbUser>("SELECT id, username, password_hash, role FROM users WHERE username = ?")
    .get(config.adminUsername);

  if (existingUser) {
    return;
  }

  const passwordHash = bcrypt.hashSync(config.adminPassword, 12);
  db.prepare(
    "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
  ).run(config.adminUsername, passwordHash, new Date().toISOString());
};

export const initializeDatabase = (): void => {
  createSchema();
  seedAdminUser();
};

export const getUserByUsername = (username: string): DbUser | undefined =>
  db
    .prepare<unknown[], DbUser>(
      "SELECT id, username, password_hash, role FROM users WHERE username = ?",
    )
    .get(username);

export const getGlobalStartNodeExternalId = (): string | null => {
  const setting = db
    .prepare<
      { key: string },
      {
        setting_value: string;
      }
    >("SELECT setting_value FROM app_settings WHERE setting_key = @key")
    .get({ key: GLOBAL_START_NODE_KEY });

  return setting?.setting_value ?? null;
};

type FloorInfo = {
  building: string;
  floorLevel: number;
  label: string;
  imageUrl: string | null;
  width: number;
  height: number;
};

const floorKey = (building: string, floorLevel: number): string => `${building}::${floorLevel}`;

export const importMapVersion = (payload: MapImportPayload): number => {
  const insertMapVersion = db.prepare(
    "INSERT INTO map_versions(name, description, is_active, created_at) VALUES (?, ?, 0, ?)",
  );
  const insertFloor = db.prepare(
    `INSERT INTO floors(map_version_id, building, floor_level, label, image_url, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertNode = db.prepare(
    `INSERT INTO nodes(map_version_id, floor_id, external_id, node_type, label, x, y, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRoom = db.prepare(
    `INSERT INTO rooms(map_version_id, floor_id, code, name, module_name, node_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO edges(map_version_id, from_node_id, to_node_id, distance, accessible, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updateStartNode = db.prepare("UPDATE map_versions SET start_node_id = ? WHERE id = ?");
  const getSetting = db.prepare<
    { key: string },
    {
      setting_value: string;
    }
  >("SELECT setting_value FROM app_settings WHERE setting_key = @key");
  const insertSetting = db.prepare(
    `INSERT INTO app_settings(setting_key, setting_value, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );

  const transaction = db.transaction((mapPayload: MapImportPayload): number => {
    const now = new Date().toISOString();
    const mapVersionResult = insertMapVersion.run(
      mapPayload.name,
      mapPayload.description ?? null,
      now,
    );
    const mapVersionId = Number(mapVersionResult.lastInsertRowid);

    const floorRecords = new Map<string, FloorInfo>();
    for (const floor of mapPayload.floors) {
      floorRecords.set(floorKey(floor.building, floor.floorLevel), {
        building: floor.building,
        floorLevel: floor.floorLevel,
        label: floor.label,
        imageUrl: floor.imageUrl ?? null,
        width: floor.width ?? 1000,
        height: floor.height ?? 700,
      });
    }

    for (const node of mapPayload.nodes) {
      const key = floorKey(node.building, node.floorLevel);
      if (!floorRecords.has(key)) {
        floorRecords.set(key, {
          building: node.building,
          floorLevel: node.floorLevel,
          label: `${node.building} - Ebene ${node.floorLevel}`,
          imageUrl: null,
          width: 1000,
          height: 700,
        });
      }
    }

    for (const room of mapPayload.rooms) {
      const key = floorKey(room.building, room.floorLevel);
      if (!floorRecords.has(key)) {
        floorRecords.set(key, {
          building: room.building,
          floorLevel: room.floorLevel,
          label: `${room.building} - Ebene ${room.floorLevel}`,
          imageUrl: null,
          width: 1000,
          height: 700,
        });
      }
    }

    const floorIdByKey = new Map<string, number>();
    for (const floor of floorRecords.values()) {
      const result = insertFloor.run(
        mapVersionId,
        floor.building,
        floor.floorLevel,
        floor.label,
        floor.imageUrl,
        floor.width,
        floor.height,
        now,
      );
      floorIdByKey.set(
        floorKey(floor.building, floor.floorLevel),
        Number(result.lastInsertRowid),
      );
    }

    const nodeIdByExternalId = new Map<string, number>();
    const nodeMeta = new Map<string, { x: number; y: number }>();

    for (const node of mapPayload.nodes) {
      const floorId = floorIdByKey.get(floorKey(node.building, node.floorLevel));
      if (!floorId) {
        throw new Error(`Node references unknown floor (${node.building} / ${node.floorLevel}).`);
      }

      const result = insertNode.run(
        mapVersionId,
        floorId,
        node.id,
        node.type,
        node.label ?? null,
        node.x,
        node.y,
        now,
      );
      const nodeId = Number(result.lastInsertRowid);
      nodeIdByExternalId.set(node.id, nodeId);
      nodeMeta.set(node.id, { x: node.x, y: node.y });
    }

    for (const room of mapPayload.rooms) {
      const floorId = floorIdByKey.get(floorKey(room.building, room.floorLevel));
      if (!floorId) {
        throw new Error(`Room references unknown floor (${room.building} / ${room.floorLevel}).`);
      }

      const nodeId = nodeIdByExternalId.get(room.nodeId);
      if (!nodeId) {
        throw new Error(`Room ${room.code} references unknown node (${room.nodeId}).`);
      }

      insertRoom.run(
        mapVersionId,
        floorId,
        room.code,
        room.name,
        room.moduleName ?? null,
        nodeId,
        now,
      );
    }

    for (const edge of mapPayload.edges) {
      const fromNodeId = nodeIdByExternalId.get(edge.from);
      const toNodeId = nodeIdByExternalId.get(edge.to);
      if (!fromNodeId || !toNodeId) {
        throw new Error(`Edge references unknown node(s): ${edge.from} -> ${edge.to}.`);
      }

      let distance = edge.distance;
      if (!distance) {
        const fromMeta = nodeMeta.get(edge.from);
        const toMeta = nodeMeta.get(edge.to);
        if (!fromMeta || !toMeta) {
          throw new Error(`Edge distance could not be computed for ${edge.from} -> ${edge.to}.`);
        }
        const dx = toMeta.x - fromMeta.x;
        const dy = toMeta.y - fromMeta.y;
        distance = Math.sqrt(dx * dx + dy * dy);
      }

      insertEdge.run(
        mapVersionId,
        fromNodeId,
        toNodeId,
        distance,
        edge.accessible === false ? 0 : 1,
        now,
      );
    }

    const globalStartSetting = getSetting.get({ key: GLOBAL_START_NODE_KEY });
    const effectiveStartNodeExternalId = globalStartSetting?.setting_value ?? mapPayload.startNodeId;

    const startNodeId = nodeIdByExternalId.get(effectiveStartNodeExternalId);
    if (!startNodeId) {
      if (globalStartSetting) {
        throw new Error(
          "Der globale Kiosk-Startpunkt fehlt in dieser Karte. Bitte markiere denselben Startbereich wie in der ersten Kartenversion.",
        );
      }
      throw new Error("startNodeId does not exist in nodes.");
    }

    if (!globalStartSetting) {
      insertSetting.run(GLOBAL_START_NODE_KEY, effectiveStartNodeExternalId, now, now);
    }
    updateStartNode.run(startNodeId, mapVersionId);

    return mapVersionId;
  });

  return transaction(payload);
};

export const activateMapVersion = (mapVersionId: number): void => {
  const transaction = db.transaction((id: number) => {
    const exists = db
      .prepare<{ id: number }, { id: number }>("SELECT id FROM map_versions WHERE id = :id")
      .get({ id });
    if (!exists) {
      throw new Error("Map version not found.");
    }

    db.prepare("UPDATE map_versions SET is_active = 0").run();
    db.prepare("UPDATE map_versions SET is_active = 1 WHERE id = ?").run(id);
  });

  transaction(mapVersionId);
};

export const deleteMapVersion = (mapVersionId: number): void => {
  const transaction = db.transaction((id: number) => {
    const existingMap = db
      .prepare<
        { id: number },
        {
          id: number;
          is_active: number;
        }
      >("SELECT id, is_active FROM map_versions WHERE id = @id")
      .get({ id });

    if (!existingMap) {
      throw new Error("Map version not found.");
    }

    db.prepare("DELETE FROM map_versions WHERE id = ?").run(id);
  });

  transaction(mapVersionId);
};

export const getMapVersionImportPayload = (
  mapVersionId: number,
): (MapImportPayload & { mapVersionId: number; isActive: boolean }) | undefined => {
  const mapVersion = db
    .prepare<
      { id: number },
      {
        id: number;
        name: string;
        description: string | null;
        is_active: number;
        start_node_id: number | null;
      }
    >("SELECT id, name, description, is_active, start_node_id FROM map_versions WHERE id = @id")
    .get({ id: mapVersionId });

  if (!mapVersion || !mapVersion.start_node_id) {
    return undefined;
  }

  const startNode = db
    .prepare<
      { nodeId: number },
      {
        external_id: string;
      }
    >("SELECT external_id FROM nodes WHERE id = @nodeId")
    .get({ nodeId: mapVersion.start_node_id });
  if (!startNode) {
    return undefined;
  }

  const floors = db
    .prepare<
      { mapVersionId: number },
      {
        building: string;
        floor_level: number;
        label: string;
        image_url: string | null;
        width: number;
        height: number;
      }
    >(
      `SELECT building, floor_level, label, image_url, width, height
       FROM floors
       WHERE map_version_id = @mapVersionId
       ORDER BY building ASC, floor_level ASC`,
    )
    .all({ mapVersionId })
    .map((floor) => ({
      building: floor.building,
      floorLevel: floor.floor_level,
      label: floor.label,
      imageUrl: floor.image_url ?? undefined,
      width: floor.width,
      height: floor.height,
    }));

  const nodes = db
    .prepare<
      { mapVersionId: number },
      {
        external_id: string;
        node_type: "hallway" | "entrance" | "stairs" | "elevator" | "room" | "poi";
        label: string | null;
        x: number;
        y: number;
        building: string;
        floor_level: number;
      }
    >(
      `
      SELECT
        n.external_id,
        n.node_type,
        n.label,
        n.x,
        n.y,
        f.building,
        f.floor_level
      FROM nodes n
      INNER JOIN floors f ON f.id = n.floor_id
      WHERE n.map_version_id = @mapVersionId
    `,
    )
    .all({ mapVersionId })
    .map((node) => ({
      id: node.external_id,
      type: node.node_type,
      label: node.label ?? undefined,
      x: node.x,
      y: node.y,
      building: node.building,
      floorLevel: node.floor_level,
    }));

  const rooms = db
    .prepare<
      { mapVersionId: number },
      {
        code: string;
        name: string;
        module_name: string | null;
        building: string;
        floor_level: number;
        node_external_id: string;
      }
    >(
      `
      SELECT
        r.code,
        r.name,
        r.module_name,
        f.building,
        f.floor_level,
        n.external_id AS node_external_id
      FROM rooms r
      INNER JOIN floors f ON f.id = r.floor_id
      INNER JOIN nodes n ON n.id = r.node_id
      WHERE r.map_version_id = @mapVersionId
      ORDER BY r.code ASC
    `,
    )
    .all({ mapVersionId })
    .map((room) => ({
      code: room.code,
      name: room.name,
      moduleName: room.module_name ?? undefined,
      building: room.building,
      floorLevel: room.floor_level,
      nodeId: room.node_external_id,
    }));

  const edges = db
    .prepare<
      { mapVersionId: number },
      {
        from_external_id: string;
        to_external_id: string;
        distance: number;
        accessible: number;
      }
    >(
      `
      SELECT
        fn.external_id AS from_external_id,
        tn.external_id AS to_external_id,
        e.distance,
        e.accessible
      FROM edges e
      INNER JOIN nodes fn ON fn.id = e.from_node_id
      INNER JOIN nodes tn ON tn.id = e.to_node_id
      WHERE e.map_version_id = @mapVersionId
    `,
    )
    .all({ mapVersionId })
    .map((edge) => ({
      from: edge.from_external_id,
      to: edge.to_external_id,
      distance: edge.distance,
      accessible: edge.accessible === 1,
    }));

  return {
    mapVersionId: mapVersion.id,
    isActive: mapVersion.is_active === 1,
    name: mapVersion.name,
    description: mapVersion.description ?? undefined,
    startNodeId: startNode.external_id,
    floors,
    nodes,
    rooms,
    edges,
  };
};

export const listMapVersions = (): Array<{
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  isActive: boolean;
  roomCount: number;
  nodeCount: number;
}> =>
  db
    .prepare<
      unknown[],
      {
        id: number;
        name: string;
        description: string | null;
        created_at: string;
        is_active: number;
        room_count: number;
        node_count: number;
      }
    >(
      `
      SELECT
        m.id,
        m.name,
        m.description,
        m.created_at,
        m.is_active,
        (SELECT COUNT(*) FROM rooms r WHERE r.map_version_id = m.id) AS room_count,
        (SELECT COUNT(*) FROM nodes n WHERE n.map_version_id = m.id) AS node_count
      FROM map_versions m
      ORDER BY m.created_at DESC
    `,
    )
    .all()
    .map((row: {
      id: number;
      name: string;
      description: string | null;
      created_at: string;
      is_active: number;
      room_count: number;
      node_count: number;
    }) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      isActive: row.is_active === 1,
      roomCount: row.room_count,
      nodeCount: row.node_count,
    }));

export const getActiveMap = (): ActiveMap | undefined =>
  db
    .prepare<unknown[], ActiveMap>(
      "SELECT id, name, description, start_node_id FROM map_versions WHERE is_active = 1 LIMIT 1",
    )
    .get();

export const searchRoomsInActiveMap = (
  query: string,
): Array<{
  id: number;
  code: string;
  name: string;
  moduleName: string | null;
  building: string;
  floorLevel: number;
  floorLabel: string;
}> => {
  const activeMap = getActiveMap();
  if (!activeMap) {
    return [];
  }

  const search = `%${query.trim()}%`;
  return db
    .prepare<
      { mapVersionId: number; search: string },
      {
        id: number;
        code: string;
        name: string;
        module_name: string | null;
        building: string;
        floor_level: number;
        label: string;
      }
    >(
      `
      SELECT
        r.id,
        r.code,
        r.name,
        r.module_name,
        f.building,
        f.floor_level,
        f.label
      FROM rooms r
      INNER JOIN floors f ON f.id = r.floor_id
      WHERE r.map_version_id = @mapVersionId
      AND (
        r.code LIKE @search
        OR r.name LIKE @search
        OR IFNULL(r.module_name, '') LIKE @search
      )
      ORDER BY r.code ASC
      LIMIT 30
    `,
    )
    .all({ mapVersionId: activeMap.id, search })
    .map((row: {
      id: number;
      code: string;
      name: string;
      module_name: string | null;
      building: string;
      floor_level: number;
      label: string;
    }) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      moduleName: row.module_name,
      building: row.building,
      floorLevel: row.floor_level,
      floorLabel: row.label,
    }));
};

export const getRoomInActiveMap = (
  roomId: number,
): { id: number; code: string; name: string; moduleName: string | null; nodeId: number } | undefined => {
  const activeMap = getActiveMap();
  if (!activeMap) {
    return undefined;
  }

  const row = db
    .prepare<
      { roomId: number; mapVersionId: number },
      { id: number; code: string; name: string; module_name: string | null; node_id: number }
    >(
      `
      SELECT id, code, name, module_name, node_id
      FROM rooms
      WHERE id = @roomId AND map_version_id = @mapVersionId
    `,
    )
    .get({ roomId, mapVersionId: activeMap.id });

  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    moduleName: row.module_name,
    nodeId: row.node_id,
  };
};

export const getGraphForActiveMap = (): {
  mapVersionId: number;
  startNodeId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
} | undefined => {
  const activeMap = getActiveMap();
  if (!activeMap || !activeMap.start_node_id) {
    return undefined;
  }

  const nodes = db
    .prepare<
      { mapVersionId: number },
      {
        id: number;
        label: string | null;
        node_type: string;
        x: number;
        y: number;
        building: string;
        floor_level: number;
        floor_id: number;
        floor_label: string;
        image_url: string | null;
        width: number;
        height: number;
      }
    >(
      `
      SELECT
        n.id,
        n.label,
        n.node_type,
        n.x,
        n.y,
        f.building,
        f.floor_level,
        f.id AS floor_id,
        f.label AS floor_label,
        f.image_url,
        f.width,
        f.height
      FROM nodes n
      INNER JOIN floors f ON f.id = n.floor_id
      WHERE n.map_version_id = @mapVersionId
    `,
    )
    .all({ mapVersionId: activeMap.id })
    .map((row: {
      id: number;
      label: string | null;
      node_type: string;
      x: number;
      y: number;
      building: string;
      floor_level: number;
      floor_id: number;
      floor_label: string;
      image_url: string | null;
      width: number;
      height: number;
    }) => ({
      id: row.id,
      label: row.label,
      type: row.node_type,
      x: row.x,
      y: row.y,
      building: row.building,
      floorLevel: row.floor_level,
      floorId: row.floor_id,
      floorLabel: row.floor_label,
      floorImageUrl: row.image_url,
      floorWidth: row.width,
      floorHeight: row.height,
    }));

  const edges = db
    .prepare<
      { mapVersionId: number },
      { from_node_id: number; to_node_id: number; distance: number; accessible: number }
    >(
      `
      SELECT from_node_id, to_node_id, distance, accessible
      FROM edges
      WHERE map_version_id = @mapVersionId
    `,
    )
    .all({ mapVersionId: activeMap.id })
    .map((row: {
      from_node_id: number;
      to_node_id: number;
      distance: number;
      accessible: number;
    }) => ({
      fromNodeId: row.from_node_id,
      toNodeId: row.to_node_id,
      distance: row.distance,
      accessible: row.accessible === 1,
    }));

  return {
    mapVersionId: activeMap.id,
    startNodeId: activeMap.start_node_id,
    nodes,
    edges,
  };
};

export const getActiveMapDetails = (): {
  id: number;
  name: string;
  description: string | null;
  hasData: boolean;
} => {
  const activeMap = getActiveMap();
  if (!activeMap) {
    return {
      id: 0,
      name: "Keine aktive Karte",
      description: null,
      hasData: false,
    };
  }

  return {
    id: activeMap.id,
    name: activeMap.name,
    description: activeMap.description,
    hasData: true,
  };
};
