import type {
  ActiveMapInfo,
  MapImportPayload,
  MapVersionExportPayload,
  MapVersionSummary,
  RoomSearchItem,
  RouteResponse,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  token?: string;
};

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
};

export const kioskApi = {
  getActiveMap: async (): Promise<ActiveMapInfo> => request<ActiveMapInfo>("/api/kiosk/active-map"),
  searchRooms: async (query: string): Promise<RoomSearchItem[]> => {
    const result = await request<{ items: RoomSearchItem[] }>(
      `/api/kiosk/search?q=${encodeURIComponent(query)}`,
    );
    return result.items;
  },
  routeToRoom: async (targetRoomId: number, accessibilityOnly = false): Promise<RouteResponse> =>
    request<RouteResponse>("/api/kiosk/route", {
      method: "POST",
      body: {
        targetRoomId,
        accessibilityOnly,
      },
    }),
};

export const adminApi = {
  login: async (username: string, password: string): Promise<{ token: string }> =>
    request<{ token: string }>("/api/admin/login", {
      method: "POST",
      body: { username, password },
    }),
  listMapVersions: async (token: string): Promise<MapVersionSummary[]> => {
    const result = await request<{ items: MapVersionSummary[] }>("/api/admin/maps", { token });
    return result.items;
  },
  getSettings: async (
    token: string,
  ): Promise<{
    globalStartNodeExternalId: string | null;
  }> =>
    request<{ globalStartNodeExternalId: string | null }>("/api/admin/settings", {
      token,
    }),
  exportMapVersion: async (token: string, mapVersionId: number): Promise<MapVersionExportPayload> =>
    request<MapVersionExportPayload>(`/api/admin/maps/${mapVersionId}/export`, {
      token,
    }),
  importMap: async (token: string, payload: MapImportPayload): Promise<{ mapVersionId: number }> =>
    request<{ mapVersionId: number }>("/api/admin/maps/import", {
      method: "POST",
      token,
      body: payload,
    }),
  deleteMapVersion: async (token: string, mapVersionId: number): Promise<void> => {
    await request<{ message: string }>(`/api/admin/maps/${mapVersionId}`, {
      method: "DELETE",
      token,
    });
  },
  uploadAsset: async (
    token: string,
    file: File,
  ): Promise<{ fileName: string; assetUrl: string }> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE_URL}/api/admin/assets/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(errorBody?.error ?? `Upload failed (${response.status})`);
    }

    return (await response.json()) as { fileName: string; assetUrl: string };
  },
  activateMapVersion: async (token: string, mapVersionId: number): Promise<void> => {
    await request<{ message: string }>(`/api/admin/maps/${mapVersionId}/activate`, {
      method: "POST",
      token,
    });
  },
};
