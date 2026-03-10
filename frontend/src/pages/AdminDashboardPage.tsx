import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api";
import type { MapImportPayload, MapVersionSummary } from "../types";

const ADMIN_TOKEN_KEY = "equinav_admin_token";
const MIN_BOX_SIZE = 14;

type AreaKind = "room" | "hallway" | "entrance" | "stairs" | "elevator" | "poi";

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

type Point = {
  x: number;
  y: number;
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

const areaCenter = (area: MapArea): Point => ({
  x: area.x + area.width / 2,
  y: area.y + area.height / 2,
});

const centerDistance = (a: MapArea, b: MapArea): number => {
  const centerA = areaCenter(a);
  const centerB = areaCenter(b);
  const dx = centerA.x - centerB.x;
  const dy = centerA.y - centerB.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const intersectsOrTouches = (a: MapArea, b: MapArea): boolean => {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;

  return !(aRight < b.x || bRight < a.x || aBottom < b.y || bBottom < a.y);
};

const displayAreaName = (area: MapArea): string => {
  if (area.kind === "room") {
    if (area.roomCode && area.roomName) {
      return `${area.roomCode} - ${area.roomName}`;
    }
    if (area.roomCode) {
      return area.roomCode;
    }
    if (area.roomName) {
      return area.roomName;
    }
  }

  return area.label || KIND_LABELS[area.kind];
};

const makeDefaultArea = (
  kind: AreaKind,
  rect: { x: number; y: number; width: number; height: number },
  index: number,
): MapArea => {
  const label = `${KIND_LABELS[kind]} ${index}`;
  const id = `${kind}-${crypto.randomUUID()}`;
  if (kind === "room") {
    const code = `R${100 + index}`;
    return {
      id,
      kind,
      label,
      roomCode: code,
      roomName: label,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  return {
    id,
    kind,
    label,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

const buildEdgesFromAreas = (areas: MapArea[], image: EditorImage): MapImportPayload["edges"] => {
  const edgeMap = new Map<string, { from: string; to: string; accessible?: boolean }>();

  const addEdge = (from: string, to: string, accessible = true) => {
    if (from === to) {
      return;
    }
    const key = [from, to].sort().join("::");
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { from, to, accessible });
    }
  };

  const nonRoomAreas = areas.filter((area) => area.kind !== "room");
  const roomAreas = areas.filter((area) => area.kind === "room");

  for (const room of roomAreas) {
    let nearest: MapArea | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const area of nonRoomAreas) {
      const distance = centerDistance(room, area);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = area;
      }
    }
    if (nearest) {
      addEdge(room.id, nearest.id, true);
    }
  }

  const autoConnectDistance = Math.max(90, Math.min(260, Math.max(image.width, image.height) * 0.16));

  for (let i = 0; i < nonRoomAreas.length; i += 1) {
    for (let j = i + 1; j < nonRoomAreas.length; j += 1) {
      const areaA = nonRoomAreas[i];
      const areaB = nonRoomAreas[j];
      if (intersectsOrTouches(areaA, areaB) || centerDistance(areaA, areaB) <= autoConnectDistance) {
        const accessible = areaA.kind !== "stairs" && areaB.kind !== "stairs";
        addEdge(areaA.id, areaB.id, accessible);
      }
    }
  }

  return [...edgeMap.values()];
};

export const AdminDashboardPage = () => {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drawingStartRef = useRef<Point | null>(null);

  const [token, setToken] = useState<string | null>(null);
  const [mapVersions, setMapVersions] = useState<MapVersionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [mapName, setMapName] = useState(`Karte ${new Date().toISOString().slice(0, 10)}`);
  const [mapDescription, setMapDescription] = useState("");
  const [building, setBuilding] = useState("Hauptgebaeude");
  const [floorLevel, setFloorLevel] = useState(0);
  const [floorLabel, setFloorLabel] = useState("EG");
  const [autoActivate, setAutoActivate] = useState(true);

  const [editorImage, setEditorImage] = useState<EditorImage | null>(null);
  const [areas, setAreas] = useState<MapArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [startAreaId, setStartAreaId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<AreaKind>("room");
  const [draftRect, setDraftRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    const storedToken = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (!storedToken) {
      navigate("/admin/login");
      return;
    }
    setToken(storedToken);
  }, [navigate]);

  const loadMapVersions = async (authToken: string) => {
    setBusy(true);
    try {
      const items = await adminApi.listMapVersions(authToken);
      setMapVersions(items);
      setError(null);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Karten konnten nicht geladen werden.");
      if (loadError instanceof Error && loadError.message.includes("Unauthorized")) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        navigate("/admin/login");
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadMapVersions(token);
  }, [token]);

  const selectedArea = useMemo(
    () => areas.find((area) => area.id === selectedAreaId) ?? null,
    [areas, selectedAreaId],
  );

  useEffect(() => {
    if (!areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(null);
    }
    if (!areas.some((area) => area.id === startAreaId)) {
      const preferredStart =
        areas.find((area) => area.kind === "entrance") ??
        areas.find((area) => area.kind === "hallway") ??
        areas.find((area) => area.kind !== "room");
      setStartAreaId(preferredStart?.id ?? null);
    }
  }, [areas, selectedAreaId, startAreaId]);

  const getCanvasPoint = (event: PointerEvent<HTMLDivElement>): Point | null => {
    if (!editorImage || !stageRef.current) {
      return null;
    }

    const bounds = stageRef.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * editorImage.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * editorImage.height;

    return {
      x: clamp(x, 0, editorImage.width),
      y: clamp(y, 0, editorImage.height),
    };
  };

  const onStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!editorImage) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const startPoint = getCanvasPoint(event);
    if (!startPoint) {
      return;
    }

    drawingStartRef.current = startPoint;
    setDraftRect({
      x: startPoint.x,
      y: startPoint.y,
      width: 0,
      height: 0,
    });
  };

  const onStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!editorImage || !drawingStartRef.current) {
      return;
    }

    const currentPoint = getCanvasPoint(event);
    if (!currentPoint) {
      return;
    }

    const startPoint = drawingStartRef.current;
    const nextRect = {
      x: Math.min(startPoint.x, currentPoint.x),
      y: Math.min(startPoint.y, currentPoint.y),
      width: Math.abs(currentPoint.x - startPoint.x),
      height: Math.abs(currentPoint.y - startPoint.y),
    };
    setDraftRect(nextRect);
  };

  const onStagePointerUp = () => {
    if (!drawingStartRef.current || !draftRect) {
      drawingStartRef.current = null;
      return;
    }

    drawingStartRef.current = null;
    if (draftRect.width < MIN_BOX_SIZE || draftRect.height < MIN_BOX_SIZE) {
      setDraftRect(null);
      return;
    }

    const area = makeDefaultArea(selectedTool, draftRect, areas.length + 1);
    setAreas((current) => [...current, area]);
    setSelectedAreaId(area.id);
    setDraftRect(null);
  };

  const updateSelectedArea = (updates: Partial<MapArea>) => {
    if (!selectedAreaId) {
      return;
    }
    setAreas((current) =>
      current.map((area) => (area.id === selectedAreaId ? { ...area, ...updates } : area)),
    );
  };

  const removeSelectedArea = () => {
    if (!selectedAreaId) {
      return;
    }
    setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
    setSelectedAreaId(null);
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
    setInfo(null);

    try {
      const uploadedAsset = await adminApi.uploadAsset(token, file);
      const localPreviewUrl = URL.createObjectURL(file);
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
          URL.revokeObjectURL(localPreviewUrl);
        };
        image.onerror = () => {
          reject(new Error("Bild konnte nicht gelesen werden."));
          URL.revokeObjectURL(localPreviewUrl);
        };
        image.src = localPreviewUrl;
      });

      setEditorImage({
        assetUrl: uploadedAsset.assetUrl,
        fileName: uploadedAsset.fileName,
        width: dimensions.width,
        height: dimensions.height,
      });
      setAreas([]);
      setSelectedAreaId(null);
      setStartAreaId(null);
      setInfo("Bild erfolgreich hochgeladen. Zeichne jetzt Raeume und Flure als Boxen.");
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : "Bild-Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const onActivate = async (mapVersionId: number) => {
    if (!token) {
      return;
    }

    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      await adminApi.activateMapVersion(token, mapVersionId);
      setInfo(`Version ${mapVersionId} ist jetzt aktiv.`);
      await loadMapVersions(token);
    } catch (activationError: unknown) {
      setError(activationError instanceof Error ? activationError.message : "Aktivierung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const createPayloadFromEditor = (): MapImportPayload => {
    if (!editorImage) {
      throw new Error("Bitte zuerst ein Kartenbild hochladen.");
    }
    if (areas.length === 0) {
      throw new Error("Bitte mindestens eine Box zeichnen.");
    }

    const roomAreas = areas.filter((area) => area.kind === "room");
    const nonRoomAreas = areas.filter((area) => area.kind !== "room");
    if (roomAreas.length === 0) {
      throw new Error("Bitte mindestens einen Raum markieren.");
    }
    if (nonRoomAreas.length === 0) {
      throw new Error("Bitte mindestens einen Flur/Eingang/Aufzug/Treppe markieren.");
    }

    const startNodeId =
      startAreaId ??
      areas.find((area) => area.kind === "entrance")?.id ??
      areas.find((area) => area.kind === "hallway")?.id ??
      nonRoomAreas[0]?.id;

    if (!startNodeId) {
      throw new Error("Startpunkt konnte nicht bestimmt werden.");
    }

    const nodes: MapImportPayload["nodes"] = areas.map((area) => {
      const center = areaCenter(area);
      return {
        id: area.id,
        building,
        floorLevel,
        x: Number(center.x.toFixed(2)),
        y: Number(center.y.toFixed(2)),
        type: area.kind,
        label: area.label || displayAreaName(area),
      };
    });

    const rooms: MapImportPayload["rooms"] = roomAreas.map((area, index) => {
      const roomCode = area.roomCode?.trim() || `R-${index + 1}`;
      const roomName = area.roomName?.trim() || area.label || `Raum ${index + 1}`;
      return {
        code: roomCode,
        name: roomName,
        moduleName: area.moduleName?.trim() || undefined,
        building,
        floorLevel,
        nodeId: area.id,
      };
    });

    const edges = buildEdgesFromAreas(areas, editorImage);
    if (edges.length === 0) {
      throw new Error("Keine Verbindungen erzeugt. Bitte mehr Flurbereiche markieren.");
    }

    return {
      name: mapName.trim() || `Karte ${new Date().toISOString().slice(0, 10)}`,
      description: mapDescription.trim() || undefined,
      startNodeId,
      floors: [
        {
          building,
          floorLevel,
          label: floorLabel.trim() || `${building} - Ebene ${floorLevel}`,
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

  const onSaveEditorMap = async () => {
    if (!token) {
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const payload = createPayloadFromEditor();
      const result = await adminApi.importMap(token, payload);

      if (autoActivate) {
        await adminApi.activateMapVersion(token, result.mapVersionId);
        setInfo(`Karte gespeichert und Version ${result.mapVersionId} direkt aktiviert.`);
      } else {
        setInfo(`Karte gespeichert als Version ${result.mapVersionId}.`);
      }

      await loadMapVersions(token);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Karte konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page-shell admin-layout">
      <header className="inline-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Admin - Karteneditor</h1>
          <p className="muted">
            Lade einen Plan hoch, zeichne Raeume und Flure mit Boxen und speichere die Kartenversion.
          </p>
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
              <th>Objekte</th>
              <th>Status</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {mapVersions.map((mapVersion) => (
              <tr key={mapVersion.id}>
                <td>{mapVersion.id}</td>
                <td>
                  <strong>{mapVersion.name}</strong>
                  <br />
                  <span className="muted">{mapVersion.description ?? "Keine Beschreibung"}</span>
                </td>
                <td>{new Date(mapVersion.createdAt).toLocaleString()}</td>
                <td>
                  {mapVersion.roomCount} Raeume / {mapVersion.nodeCount} Knoten
                </td>
                <td>
                  <span className={`pill ${mapVersion.isActive ? "active" : ""}`}>
                    {mapVersion.isActive ? "Aktiv" : "Inaktiv"}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy || mapVersion.isActive}
                    onClick={() => void onActivate(mapVersion.id)}
                  >
                    Aktivieren
                  </button>
                </td>
              </tr>
            ))}
            {mapVersions.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Noch keine Kartenversion vorhanden.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="card editor-grid">
        <aside className="editor-sidebar">
          <h2>Editor</h2>

          <label htmlFor="map-name">Kartenname</label>
          <input
            id="map-name"
            className="input"
            value={mapName}
            onChange={(event) => setMapName(event.target.value)}
          />

          <label htmlFor="map-description">Beschreibung</label>
          <input
            id="map-description"
            className="input"
            value={mapDescription}
            onChange={(event) => setMapDescription(event.target.value)}
          />

          <label htmlFor="building">Gebaeude</label>
          <input
            id="building"
            className="input"
            value={building}
            onChange={(event) => setBuilding(event.target.value)}
          />

          <div className="inline-row">
            <div style={{ flex: 1 }}>
              <label htmlFor="floor-level">Ebene</label>
              <input
                id="floor-level"
                className="input"
                type="number"
                value={floorLevel}
                onChange={(event) => setFloorLevel(Number(event.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="floor-label">Ebenen-Label</label>
              <input
                id="floor-label"
                className="input"
                value={floorLabel}
                onChange={(event) => setFloorLabel(event.target.value)}
              />
            </div>
          </div>

          <label htmlFor="map-upload">Kartenbild (PNG/JPG/WEBP)</label>
          <input
            id="map-upload"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={(event) => void onImageUpload(event)}
          />
          {editorImage ? (
            <p className="muted">
              Bild: {editorImage.fileName} ({editorImage.width} x {editorImage.height})
            </p>
          ) : null}

          <p className="muted">Werkzeug waehlen und dann im Plan ziehen, um eine Box zu erstellen.</p>
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

          <label htmlFor="start-node">Startpunkt (Empfang)</label>
          <select
            id="start-node"
            className="input"
            value={startAreaId ?? ""}
            onChange={(event) => setStartAreaId(event.target.value || null)}
          >
            <option value="">Automatisch waehlen</option>
            {areas
              .filter((area) => area.kind !== "room")
              .map((area) => (
                <option key={area.id} value={area.id}>
                  {displayAreaName(area)} ({KIND_LABELS[area.kind]})
                </option>
              ))}
          </select>

          {selectedArea ? (
            <div className="selected-area-panel">
              <h3>Ausgewaehlte Box</h3>
              <p className="muted">{KIND_LABELS[selectedArea.kind]}</p>
              <label htmlFor="selected-label">Label</label>
              <input
                id="selected-label"
                className="input"
                value={selectedArea.label}
                onChange={(event) => updateSelectedArea({ label: event.target.value })}
              />

              {selectedArea.kind === "room" ? (
                <>
                  <label htmlFor="selected-room-code">Raum-Code</label>
                  <input
                    id="selected-room-code"
                    className="input"
                    value={selectedArea.roomCode ?? ""}
                    onChange={(event) => updateSelectedArea({ roomCode: event.target.value })}
                  />

                  <label htmlFor="selected-room-name">Raum-Name</label>
                  <input
                    id="selected-room-name"
                    className="input"
                    value={selectedArea.roomName ?? ""}
                    onChange={(event) => updateSelectedArea({ roomName: event.target.value })}
                  />

                  <label htmlFor="selected-module-name">Modul</label>
                  <input
                    id="selected-module-name"
                    className="input"
                    value={selectedArea.moduleName ?? ""}
                    onChange={(event) => updateSelectedArea({ moduleName: event.target.value })}
                  />
                </>
              ) : null}

              <button type="button" className="button button-danger" onClick={removeSelectedArea}>
                Box loeschen
              </button>
            </div>
          ) : (
            <p className="muted">Klicke eine Box an, um Details zu bearbeiten.</p>
          )}

          <label className="inline-row" style={{ alignItems: "center", gap: "8px" }}>
            <input
              type="checkbox"
              checked={autoActivate}
              onChange={(event) => setAutoActivate(event.target.checked)}
            />
            Nach Import direkt aktivieren
          </label>

          <div className="inline-row">
            <button type="button" className="button" disabled={busy} onClick={() => void onSaveEditorMap()}>
              {busy ? "Speichere..." : "Karte speichern"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setAreas([]);
                setSelectedAreaId(null);
                setStartAreaId(null);
              }}
            >
              Alle Boxen entfernen
            </button>
          </div>
        </aside>

        <div className="editor-stage-wrapper">
          {!editorImage ? (
            <div className="editor-placeholder">
              <p>Lade zuerst ein Kartenbild hoch.</p>
            </div>
          ) : (
            <>
              <div
                ref={stageRef}
                className="editor-stage"
                style={{
                  backgroundImage: `url(${editorImage.assetUrl})`,
                  aspectRatio: `${editorImage.width} / ${editorImage.height}`,
                }}
                onPointerDown={onStagePointerDown}
                onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp}
                onPointerLeave={onStagePointerUp}
              >
                {areas.map((area) => (
                  <button
                    key={area.id}
                    type="button"
                    className={`editor-box area-${area.kind} ${
                      selectedAreaId === area.id ? "editor-box-selected" : ""
                    }`}
                    style={{
                      left: `${(area.x / editorImage.width) * 100}%`,
                      top: `${(area.y / editorImage.height) * 100}%`,
                      width: `${(area.width / editorImage.width) * 100}%`,
                      height: `${(area.height / editorImage.height) * 100}%`,
                    }}
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

              <div className="card" style={{ marginTop: "12px" }}>
                <h3>Erkannte Bereiche</h3>
                {areas.length === 0 ? <p className="muted">Noch keine Boxen gezeichnet.</p> : null}
                <ul className="editor-area-list">
                  {areas.map((area) => (
                    <li key={area.id}>
                      <button
                        type="button"
                        className={`result-item-button ${
                          selectedAreaId === area.id ? "result-item-selected" : ""
                        }`}
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
