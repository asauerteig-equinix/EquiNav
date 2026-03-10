export type ActiveMapInfo = {
  id: number;
  name: string;
  description: string | null;
  hasData: boolean;
};

export type RoomSearchItem = {
  id: number;
  code: string;
  name: string;
  moduleName: string | null;
  building: string;
  floorLevel: number;
  floorLabel: string;
};

export type RouteNode = {
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

export type RouteFloor = {
  id: number;
  label: string;
  imageUrl: string | null;
  width: number;
  height: number;
};

export type RouteResponse = {
  targetRoom: {
    id: number;
    code: string;
    name: string;
    moduleName: string | null;
    nodeId: number;
  };
  totalDistance: number;
  path: RouteNode[];
  floors: RouteFloor[];
};

export type MapVersionSummary = {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  isActive: boolean;
  roomCount: number;
  nodeCount: number;
};

export type MapImportPayload = {
  name: string;
  description?: string;
  startNodeId: string;
  floors?: Array<{
    building: string;
    floorLevel: number;
    label: string;
    imageUrl?: string;
    width?: number;
    height?: number;
  }>;
  nodes: Array<{
    id: string;
    building: string;
    floorLevel: number;
    x: number;
    y: number;
    type: "hallway" | "entrance" | "stairs" | "elevator" | "room" | "poi";
    label?: string;
  }>;
  rooms: Array<{
    code: string;
    name: string;
    moduleName?: string;
    building: string;
    floorLevel: number;
    nodeId: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    distance?: number;
    accessible?: boolean;
  }>;
};

export type MapVersionExportPayload = MapImportPayload & {
  mapVersionId: number;
  isActive: boolean;
};
