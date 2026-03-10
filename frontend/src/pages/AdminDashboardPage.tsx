import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api";
import type { MapImportPayload, MapVersionSummary } from "../types";

const ADMIN_TOKEN_KEY = "equinav_admin_token";
const MIN_BOX_SIZE = 14;
const DEFAULT_START_NODE_EXTERNAL_ID = "kiosk-start-node";

type AreaKind = "room" | "hallway" | "entrance" | "stairs" | "elevator" | "poi";
type Point = { x: number; y: number };

type MapArea = {
  id: string;
  kind: AreaKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  roomCode?: string;
  roomName?: string;
  moduleName?: string;
};

type EditorImage = {
  assetUrl: string;
  fileName: string;
  width: number;
  height: number;
};

const KIND_LABELS: Record<AreaKind, string> = {
  room: "Raum",
  hallway: "Flur",
  entrance: "Eingang",
  stairs: "Treppe",
  elevator: "Aufzug",
  poi: "POI",
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const areaCenter = (area: MapArea): Point => ({ x: area.x + area.width / 2, y: area.y + area.height / 2 });
const displayAreaName = (area: MapArea): string =>
  area.kind === "room"
    ? area.roomCode && area.roomName
      ? `${area.roomCode} - ${area.roomName}`
      : area.roomCode ?? area.roomName ?? area.label ?? "Raum"
    : area.label || KIND_LABELS[area.kind];

const distance = (a: MapArea, b: MapArea) => {
  const ca = areaCenter(a);
  const cb = areaCenter(b);
  const dx = ca.x - cb.x;
  const dy = ca.y - cb.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const intersects = (a: MapArea, b: MapArea): boolean => {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return !(ax2 < b.x || bx2 < a.x || ay2 < b.y || by2 < a.y);
};

const deriveStartArea = (areas: MapArea[]): MapArea | null =>
  areas.find((area) => area.kind === "entrance") ??
  areas.find((area) => area.kind === "hallway") ??
  areas.find((area) => area.kind !== "room") ??
  null;

const buildEdges = (areas: MapArea[], image: EditorImage) => {
  const roomAreas = areas.filter((area) => area.kind === "room");
  const transitAreas = areas.filter((area) => area.kind !== "room");
  const maxNear = Math.max(90, Math.min(260, Math.max(image.width, image.height) * 0.14));
  const edgeMap = new Map<string, { from: string; to: string; accessible: boolean }>();

  const addEdge = (from: string, to: string, accessible = true) => {
    if (from === to) {
      return;
    }
    const key = [from, to].sort().join("::");
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { from, to, accessible });
    }
  };

  for (const room of roomAreas) {
    let nearest: MapArea | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const transit of transitAreas) {
      const d = distance(room, transit);
      if (d < nearestDistance) {
        nearest = transit;
        nearestDistance = d;
      }
    }
    if (nearest) {
      addEdge(room.id, nearest.id, true);
    }
  }

  for (let i = 0; i < transitAreas.length; i += 1) {
    for (let j = i + 1; j < transitAreas.length; j += 1) {
      const a = transitAreas[i];
      const b = transitAreas[j];
      if (intersects(a, b) || distance(a, b) <= maxNear) {
        addEdge(a.id, b.id, a.kind !== "stairs" && b.kind !== "stairs");
      }
    }
  }

  return [...edgeMap.values()];
};

export const AdminDashboardPage = () => {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drawStartRef = useRef<Point | null>(null);
  const drawPointerIdRef = useRef<number | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mapVersions, setMapVersions] = useState<MapVersionSummary[]>([]);
  const [globalStartNodeExternalId, setGlobalStartNodeExternalId] = useState<string | null>(null);

  const [mapName, setMapName] = useState(`Karte ${new Date().toISOString().slice(0, 10)}`);
  const [mapDescription, setMapDescription] = useState("");
  const [building, setBuilding] = useState("Gesamtgelaende");
  const [floorLevel, setFloorLevel] = useState(0);
  const [floorLabel, setFloorLabel] = useState("Ebene 0");
  const [autoActivate, setAutoActivate] = useState(true);

  const [editorImage, setEditorImage] = useState<EditorImage | null>(null);
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<AreaKind>("room");
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const storedToken = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!storedToken) {
      navigate("/admin/login");
      return;
    }
    setToken(storedToken);
  }, [navigate]);

  const loadAdminData = async (authToken: string) => {
    setBusy(true);
    try {
      const [versions, settings] = await Promise.all([
        adminApi.listMapVersions(authToken),
        adminApi.getSettings(authToken),
      ]);
      setMapVersions(versions);
      setGlobalStartNodeExternalId(settings.globalStartNodeExternalId);
      setError(null);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Admin-Daten konnten nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (token) {
      void loadAdminData(token);
    }
  }, [token]);

  const selectedArea = useMemo(
    () => areas.find((area) => area.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );

  const getPoint = (event: PointerEvent<HTMLDivElement>): Point | null => {
    if (!editorImage || !stageRef.current) {
      return null;
    }
    const bounds = stageRef.current.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * editorImage.width, 0, editorImage.width),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * editorImage.height, 0, editorImage.height),
    };
  };

  const commitDraft = () => {
    if (!draftRect) {
      setDraftRect(null);
      drawStartRef.current = null;
      return;
    }
    if (draftRect.width < MIN_BOX_SIZE || draftRect.height < MIN_BOX_SIZE) {
      setDraftRect(null);
      drawStartRef.current = null;
      return;
    }
    const index = areas.length + 1;
    const defaultLabel = `${KIND_LABELS[selectedTool]} ${index}`;
    const area: MapArea = {
      id: `${selectedTool}-${crypto.randomUUID()}`,
      kind: selectedTool,
      x: draftRect.x,
      y: draftRect.y,
      width: draftRect.width,
      height: draftRect.height,
      label: defaultLabel,
      roomCode: selectedTool === "room" ? `R${100 + index}` : undefined,
      roomName: selectedTool === "room" ? defaultLabel : undefined,
    };
    setAreas((current) => [...current, area]);
    setSelectedAreaId(area.id);
    setDraftRect(null);
    drawStartRef.current = null;
  };

  const onStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editorImage || event.button !== 0) {
      return;
    }
    const point = getPoint(event);
    if (!point) {
      return;
    }
    drawStartRef.current = point;
    drawPointerIdRef.current = event.pointerId;
    stageRef.current?.setPointerCapture(event.pointerId);
    setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const onStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawStartRef.current) {
      return;
    }
    if (drawPointerIdRef.current !== null && drawPointerIdRef.current !== event.pointerId) {
      return;
    }
    const point = getPoint(event);
    if (!point) {
      return;
    }
    const start = drawStartRef.current;
    setDraftRect({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const onStagePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drawPointerIdRef.current !== null && drawPointerIdRef.current !== event.pointerId) {
      return;
    }
    if (stageRef.current?.hasPointerCapture(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId);
    }
    drawPointerIdRef.current = null;
    commitDraft();
  };

  const onImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!token) {
      return;
    }
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const uploaded = await adminApi.uploadAsset(token, file);
      const preview = URL.createObjectURL(file);
      const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
          URL.revokeObjectURL(preview);
        };
        image.onerror = () => reject(new Error("Bild konnte nicht gelesen werden."));
        image.src = preview;
      });

      setEditorImage({
        assetUrl: uploaded.assetUrl,
        fileName: uploaded.fileName,
        width: dims.width,
        height: dims.height,
      });
      setAreas([]);
      setSelectedAreaId(null);
      setZoom(1);
      setInfo("Bild hochgeladen. Jetzt Boxen einzeichnen.");
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const updateSelectedArea = (updates: Partial<MapArea>) => {
    if (!selectedAreaId || !editorImage) {
      return;
    }
    setAreas((current) =>
      current.map((area) => {
        if (area.id !== selectedAreaId) {
          return area;
        }
        const width = updates.width ?? area.width;
        const height = updates.height ?? area.height;
        return {
          ...area,
          ...updates,
          width,
          height,
          x: clamp(updates.x ?? area.x, 0, editorImage.width - width),
          y: clamp(updates.y ?? area.y, 0, editorImage.height - height),
        };
      }),
    );
  };

  const deleteSelectedArea = () => {
    if (!selectedAreaId) {
      return;
    }
    setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
    setSelectedAreaId(null);
  };

  const toPayload = (): MapImportPayload => {
    if (!editorImage) {
      throw new Error("Kein Kartenbild geladen.");
    }
    if (areas.length === 0) {
      throw new Error("Noch keine Boxen eingezeichnet.");
    }
    const startArea = deriveStartArea(areas);
    if (!startArea) {
      throw new Error("Es fehlt ein transitiver Bereich (z. B. Eingang oder Flur).");
    }

    const roomAreas = areas.filter((area) => area.kind === "room");
    const transitAreas = areas.filter((area) => area.kind !== "room");
    if (roomAreas.length === 0 || transitAreas.length === 0) {
      throw new Error("Bitte mindestens einen Raum und einen Flur/Eingang markieren.");
    }

    const startExternalId = globalStartNodeExternalId ?? DEFAULT_START_NODE_EXTERNAL_ID;
    const nodeIdByAreaId = new Map<string, string>();
    for (const area of areas) {
      if (area.id === startArea.id) {
        nodeIdByAreaId.set(area.id, startExternalId);
        continue;
      }

      const mappedId = area.id === startExternalId ? `${area.id}-node` : area.id;
      nodeIdByAreaId.set(area.id, mappedId);
    }

    const nodes: MapImportPayload["nodes"] = areas.map((area) => {
      const center = areaCenter(area);
      return {
        id: nodeIdByAreaId.get(area.id) ?? area.id,
        building,
        floorLevel,
        x: Number(center.x.toFixed(2)),
        y: Number(center.y.toFixed(2)),
        type: area.kind,
        label: area.label || displayAreaName(area),
      };
    });

    const rooms: MapImportPayload["rooms"] = roomAreas.map((area, index) => ({
      code: area.roomCode?.trim() || `R-${index + 1}`,
      name: area.roomName?.trim() || area.label || `Raum ${index + 1}`,
      moduleName: area.moduleName?.trim() || undefined,
      building,
      floorLevel,
      nodeId: nodeIdByAreaId.get(area.id) ?? area.id,
    }));

    const edges: MapImportPayload["edges"] = buildEdges(areas, editorImage).map((edge) => ({
      from: nodeIdByAreaId.get(edge.from) ?? edge.from,
      to: nodeIdByAreaId.get(edge.to) ?? edge.to,
      accessible: edge.accessible,
    }));

    return {
      name: mapName.trim() || `Karte ${new Date().toISOString().slice(0, 10)}`,
      description: mapDescription.trim() || undefined,
      startNodeId: startExternalId,
      floors: [
        {
          building,
          floorLevel,
          label: floorLabel.trim() || `${building} Ebene ${floorLevel}`,
          imageUrl: editorImage.assetUrl,
          width: editorImage.width,
          height: editorImage.height,
        },
      ],
      nodes,
      rooms,
      edges,
    };
  };

  const onSave = async () => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const payload = toPayload();
      const result = await adminApi.importMap(token, payload);
      if (autoActivate) {
        await adminApi.activateMapVersion(token, result.mapVersionId);
      }
      setInfo(
        autoActivate
          ? `Karte gespeichert und Version ${result.mapVersionId} aktiviert.`
          : `Karte gespeichert als Version ${result.mapVersionId}.`,
      );
      await loadAdminData(token);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const onLoadVersion = async (version: MapVersionSummary) => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const exported = await adminApi.exportMapVersion(token, version.id);
      const floors = exported.floors ?? [];
      if (floors.length === 0) {
        throw new Error("Kartenversion enthaelt keine Ebenen.");
      }
      const floor = floors[0];

      const nodesForFloor = exported.nodes.filter(
        (node) => node.building === floor.building && node.floorLevel === floor.floorLevel,
      );
      const nodeIds = new Set(nodesForFloor.map((node) => node.id));
      const roomsForFloor = exported.rooms.filter((room) => nodeIds.has(room.nodeId));
      const roomByNodeId = new Map(roomsForFloor.map((room) => [room.nodeId, room]));
      const width = floor.width ?? 1200;
      const height = floor.height ?? 800;
      const loadedAreas: MapArea[] = nodesForFloor.map((node) => {
        const room = roomByNodeId.get(node.id);
        const w = node.type === "hallway" ? 150 : 110;
        const h = node.type === "hallway" ? 70 : 70;
        return {
          id: node.id,
          kind: node.type,
          x: clamp(node.x - w / 2, 0, width - w),
          y: clamp(node.y - h / 2, 0, height - h),
          width: w,
          height: h,
          label: node.label ?? room?.name ?? KIND_LABELS[node.type],
          roomCode: room?.code,
          roomName: room?.name,
          moduleName: room?.moduleName,
        };
      });

      setMapName(exported.name);
      setMapDescription(exported.description ?? "");
      setBuilding(floor.building);
      setFloorLevel(floor.floorLevel);
      setFloorLabel(floor.label);
      setEditorImage({
        assetUrl: floor.imageUrl ?? "",
        fileName: floor.imageUrl?.split("/").at(-1) ?? "ohne-bild",
        width,
        height,
      });
      setAreas(loadedAreas);
      setSelectedAreaId(loadedAreas[0]?.id ?? null);
      setZoom(1);
      setInfo(
        floors.length > 1
          ? `Version ${version.id} geladen (nur erste Ebene: ${floor.label}).`
          : `Version ${version.id} in den Editor geladen.`,
      );
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Laden fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteVersion = async (version: MapVersionSummary) => {
    if (!token) {
      return;
    }
    if (!window.confirm(`Version ${version.id} wirklich loeschen?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await adminApi.deleteMapVersion(token, version.id);
      setInfo(`Version ${version.id} geloescht.`);
      await loadAdminData(token);
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : "Loeschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const onActivateVersion = async (version: MapVersionSummary) => {
    if (!token) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await adminApi.activateMapVersion(token, version.id);
      setInfo(`Version ${version.id} aktiviert.`);
      await loadAdminData(token);
    } catch (activationError: unknown) {
      setError(activationError instanceof Error ? activationError.message : "Aktivierung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-shell admin-layout admin-wide">
      <header className="inline-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Admin - Karteneditor</h1>
          <p className="muted">Bild hochladen, Bereiche zeichnen, speichern. Startpunkt ist global fixiert.</p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            navigate("/admin/login");
          }}
        >
          Abmelden
        </button>
      </header>

      <section className="card">
        <h2>Versionen</h2>
        {error ? <p className="error">{error}</p> : null}
        {info ? <p>{info}</p> : null}
        <table className="map-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Erstellt</th>
              <th>Status</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {mapVersions.map((version) => (
              <tr key={version.id}>
                <td>{version.id}</td>
                <td>
                  <strong>{version.name}</strong>
                  <br />
                  <span className="muted">{version.description ?? "Keine Beschreibung"}</span>
                </td>
                <td>{new Date(version.createdAt).toLocaleString()}</td>
                <td>
                  <span className={`pill ${version.isActive ? "active" : ""}`}>
                    {version.isActive ? "Aktiv" : "Inaktiv"}
                  </span>
                </td>
                <td>
                  <div className="inline-row">
                    <button type="button" className="button button-secondary" onClick={() => void onLoadVersion(version)}>
                      Laden
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || version.isActive}
                      onClick={() => void onActivateVersion(version)}
                    >
                      Aktivieren
                    </button>
                    <button type="button" className="button button-danger" onClick={() => void onDeleteVersion(version)}>
                      Loeschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card editor-grid-large">
        <aside className="editor-sidebar">
          <h2>Editor</h2>
          <label>Kartenname</label>
          <input className="input" value={mapName} onChange={(event) => setMapName(event.target.value)} />
          <label>Beschreibung</label>
          <input className="input" value={mapDescription} onChange={(event) => setMapDescription(event.target.value)} />
          <label>Gebaeude/Kartenbereich</label>
          <input className="input" value={building} onChange={(event) => setBuilding(event.target.value)} />
          <div className="inline-row">
            <div style={{ flex: 1 }}>
              <label>Ebene</label>
              <input className="input" type="number" value={floorLevel} onChange={(event) => setFloorLevel(Number(event.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Ebenen-Label</label>
              <input className="input" value={floorLabel} onChange={(event) => setFloorLabel(event.target.value)} />
            </div>
          </div>
          <label>Kartenbild (PNG/JPG/WEBP)</label>
          <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={(event) => void onImageUpload(event)} />
          <p className="muted">
            Globaler Startpunkt: <strong>{globalStartNodeExternalId ?? "wird bei erstem Import gesetzt"}</strong>
          </p>
          <div className="tool-grid">
            {(Object.keys(KIND_LABELS) as AreaKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`button button-secondary ${selectedTool === kind ? "tool-active" : ""}`}
                onClick={() => setSelectedTool(kind)}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          {selectedArea ? (
            <div className="selected-area-panel">
              <h3>Ausgewaehlt</h3>
              <label>Label</label>
              <input className="input" value={selectedArea.label} onChange={(event) => updateSelectedArea({ label: event.target.value })} />
              {selectedArea.kind === "room" ? (
                <>
                  <label>Raum-Code</label>
                  <input className="input" value={selectedArea.roomCode ?? ""} onChange={(event) => updateSelectedArea({ roomCode: event.target.value })} />
                  <label>Raum-Name</label>
                  <input className="input" value={selectedArea.roomName ?? ""} onChange={(event) => updateSelectedArea({ roomName: event.target.value })} />
                  <label>Modul</label>
                  <input className="input" value={selectedArea.moduleName ?? ""} onChange={(event) => updateSelectedArea({ moduleName: event.target.value })} />
                </>
              ) : null}
              <button type="button" className="button button-danger" onClick={deleteSelectedArea}>
                Box loeschen
              </button>
            </div>
          ) : null}
          <label className="inline-row" style={{ gap: "8px" }}>
            <input type="checkbox" checked={autoActivate} onChange={(event) => setAutoActivate(event.target.checked)} />
            Nach Import aktivieren
          </label>
          <button type="button" className="button" disabled={busy} onClick={() => void onSave()}>
            {busy ? "Speichere..." : "Karte speichern"}
          </button>
        </aside>

        <div className="editor-stage-wrapper">
          {!editorImage ? (
            <div className="editor-placeholder">
              <p>Lade zuerst ein Kartenbild hoch.</p>
            </div>
          ) : (
            <>
              <div className="editor-toolbar">
                <label>Zoom</label>
                <input
                  type="range"
                  min={0.4}
                  max={2.5}
                  step={0.1}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" className="button button-secondary" onClick={() => setZoom(1)}>
                  100%
                </button>
              </div>
              <div className="editor-canvas-scroll">
                <div className="editor-canvas-size" style={{ width: `${editorImage.width * zoom}px`, height: `${editorImage.height * zoom}px` }}>
                  <div
                    ref={stageRef}
                    className="editor-stage"
                    style={{
                      width: `${editorImage.width}px`,
                      height: `${editorImage.height}px`,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                      backgroundImage: `url(${editorImage.assetUrl})`,
                    }}
                    onPointerDown={onStagePointerDown}
                    onPointerMove={onStagePointerMove}
                    onPointerUp={onStagePointerUp}
                  >
                    {areas.map((area) => (
                      <button
                        key={area.id}
                        type="button"
                        className={`editor-box area-${area.kind} ${selectedAreaId === area.id ? "editor-box-selected" : ""}`}
                        style={{
                          left: `${(area.x / editorImage.width) * 100}%`,
                          top: `${(area.y / editorImage.height) * 100}%`,
                          width: `${(area.width / editorImage.width) * 100}%`,
                          height: `${(area.height / editorImage.height) * 100}%`,
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedAreaId(area.id);
                        }}
                      >
                        <span>{displayAreaName(area)}</span>
                      </button>
                    ))}
                    {draftRect ? (
                      <div
                        className={`editor-box editor-draft area-${selectedTool}`}
                        style={{
                          left: `${(draftRect.x / editorImage.width) * 100}%`,
                          top: `${(draftRect.y / editorImage.height) * 100}%`,
                          width: `${(draftRect.width / editorImage.width) * 100}%`,
                          height: `${(draftRect.height / editorImage.height) * 100}%`,
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="card" style={{ marginTop: "12px" }}>
                <h3>Bereiche</h3>
                {areas.length === 0 ? <p className="muted">Noch keine Boxen gezeichnet.</p> : null}
                <ul className="editor-area-list">
                  {areas.map((area) => (
                    <li key={area.id}>
                      <button
                        type="button"
                        className={`result-item-button ${selectedAreaId === area.id ? "result-item-selected" : ""}`}
                        onClick={() => setSelectedAreaId(area.id)}
                      >
                        <strong>{displayAreaName(area)}</strong> ({KIND_LABELS[area.kind]})
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
};
