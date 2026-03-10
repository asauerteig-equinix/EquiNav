import { z } from "zod";

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const mapFloorSchema = z.object({
  building: z.string().trim().min(1),
  floorLevel: z.number().int(),
  label: z.string().trim().min(1),
  imageUrl: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.startsWith("/") || /^https?:\/\//i.test(value), {
      message: "imageUrl must be absolute (http/https) or root-relative (/assets/...)",
    })
    .optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export const mapNodeSchema = z.object({
  id: z.string().trim().min(1),
  building: z.string().trim().min(1),
  floorLevel: z.number().int(),
  x: z.number(),
  y: z.number(),
  type: z.enum(["hallway", "entrance", "stairs", "elevator", "room", "poi"]),
  label: z.string().trim().optional(),
});

export const mapRoomSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  moduleName: z.string().trim().optional(),
  building: z.string().trim().min(1),
  floorLevel: z.number().int(),
  nodeId: z.string().trim().min(1),
});

export const mapEdgeSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  distance: z.number().positive().optional(),
  accessible: z.boolean().optional(),
});

export const mapImportSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  startNodeId: z.string().trim().min(1),
  floors: z.array(mapFloorSchema).default([]),
  nodes: z.array(mapNodeSchema).min(1),
  rooms: z.array(mapRoomSchema).min(1),
  edges: z.array(mapEdgeSchema).min(1),
});

export const routeRequestSchema = z.object({
  targetRoomId: z.number().int().positive(),
  accessibilityOnly: z.boolean().optional(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type MapImportPayload = z.infer<typeof mapImportSchema>;
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export type AuthUser = {
  id: number;
  username: string;
  role: "admin" | "editor" | "viewer";
};

export type GraphNode = {
  id: number;
  label: string | null;
  type: string;
  x: number;
  y: number;
  building: string;
  floorLevel: number;
  floorId: number;
  floorLabel: string;
  floorImageUrl: string | null;
  floorWidth: number;
  floorHeight: number;
};

export type GraphEdge = {
  fromNodeId: number;
  toNodeId: number;
  distance: number;
  accessible: boolean;
};
