import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kioskApi } from "../api";
import { RouteFloorView } from "../components/RouteFloorView";
import type { ActiveMapInfo, RoomSearchItem, RouteResponse } from "../types";

const KIOSK_RESET_MS = 30_000;

export const KioskPage = () => {
  const [activeMap, setActiveMap] = useState<ActiveMapInfo | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RoomSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  const resetView = useCallback(() => {
    setQuery("");
    setResults([]);
    setRoute(null);
    setSelectedFloorId(null);
    setError(null);
  }, []);

  const bumpResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(resetView, KIOSK_RESET_MS);
  }, [resetView]);

  useEffect(() => {
    void kioskApi.getActiveMap().then(setActiveMap).catch(() => {
      setError("Aktive Karte konnte nicht geladen werden.");
    });
  }, []);

  useEffect(() => {
    bumpResetTimer();
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "touchstart",
      "keydown",
      "wheel",
    ];
    const listener = () => bumpResetTimer();

    for (const eventName of events) {
      window.addEventListener(eventName, listener, { passive: true });
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, listener);
      }
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, [bumpResetTimer]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      void kioskApi
        .searchRooms(trimmed)
        .then((items) => {
          setResults(items);
          setError(null);
        })
        .catch((searchError: unknown) => {
          setError(searchError instanceof Error ? searchError.message : "Suche fehlgeschlagen.");
        })
        .finally(() => {
          setSearchLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  const requestRoute = async (targetRoomId: number) => {
    bumpResetTimer();
    setError(null);
    try {
      const routeResponse = await kioskApi.routeToRoom(targetRoomId, false);
      setRoute(routeResponse);
      setSelectedFloorId(routeResponse.floors[0]?.id ?? null);
    } catch (routeError: unknown) {
      setRoute(null);
      setSelectedFloorId(null);
      setError(routeError instanceof Error ? routeError.message : "Route konnte nicht berechnet werden.");
    }
  };

  const selectedFloor = useMemo(
    () => route?.floors.find((floor) => floor.id === selectedFloorId) ?? route?.floors[0] ?? null,
    [route, selectedFloorId],
  );

  const nodesOnSelectedFloor = useMemo(() => {
    if (!route || !selectedFloor) {
      return [];
    }
    return route.path.filter((node) => node.floorId === selectedFloor.id);
  }, [route, selectedFloor]);

  return (
    <main className="page-shell">
      <header>
        <h1 className="page-title">EquiNav Kiosk</h1>
        <p className="muted">
          {activeMap?.hasData
            ? `Aktive Karte: ${activeMap.name}`
            : "Aktuell ist keine Karte aktiv. Bitte Admin informieren."}
        </p>
      </header>

      <section className="kiosk-layout">
        <aside className="card">
          <h2>Ziel suchen</h2>
          <input
            className="input"
            value={query}
            onChange={(event) => {
              bumpResetTimer();
              setQuery(event.target.value);
            }}
            placeholder="Modul, Raum oder Code"
            autoFocus
          />

          {searchLoading ? <p className="muted">Suche läuft...</p> : null}
          {error ? <p className="error">{error}</p> : null}

          <ul className="result-list">
            {results.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  className="result-item-button"
                  onClick={() => void requestRoute(room.id)}
                >
                  <strong>{room.code}</strong> - {room.name}
                  <br />
                  <span className="muted">
                    {room.moduleName ? `${room.moduleName} · ` : ""}
                    {room.floorLabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="card">
          <h2>Weganzeige</h2>
          {!route ? (
            <p className="muted">
              Nach Auswahl eines Suchergebnisses erscheint hier der Weg vom Empfang zum Ziel.
            </p>
          ) : (
            <>
              <p>
                Ziel: <strong>{route.targetRoom.code}</strong> - {route.targetRoom.name}
              </p>
              <p className="muted">Gesamtdistanz: {route.totalDistance} Einheiten</p>

              <div className="floor-tabs">
                {route.floors.map((floor) => (
                  <button
                    key={floor.id}
                    type="button"
                    className={`floor-tab ${selectedFloor?.id === floor.id ? "active" : ""}`}
                    onClick={() => {
                      bumpResetTimer();
                      setSelectedFloorId(floor.id);
                    }}
                  >
                    {floor.label}
                  </button>
                ))}
              </div>

              {selectedFloor ? (
                <RouteFloorView floor={selectedFloor} nodes={nodesOnSelectedFloor} />
              ) : (
                <p className="muted">Keine Etageninformationen zur Route vorhanden.</p>
              )}

              <h3>Wegpunkte</h3>
              <ol>
                {route.path.map((node) => (
                  <li key={node.id}>
                    {node.label ?? node.type} ({node.floorLabel})
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </section>
    </main>
  );
};
