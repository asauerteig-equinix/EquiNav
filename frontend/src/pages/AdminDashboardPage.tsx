import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api";
import type { MapImportPayload, MapVersionSummary } from "../types";

const ADMIN_TOKEN_KEY = "equinav_admin_token";

const EXAMPLE_IMPORT_PAYLOAD = `{
  "name": "Gebaeudeplan Stand 2026-03",
  "description": "Beispielimport",
  "startNodeId": "reception",
  "floors": [
    {
      "building": "Hauptgebaeude",
      "floorLevel": 0,
      "label": "EG"
    }
  ],
  "nodes": [
    { "id": "reception", "building": "Hauptgebaeude", "floorLevel": 0, "x": 120, "y": 300, "type": "entrance", "label": "Empfang" },
    { "id": "flur_a", "building": "Hauptgebaeude", "floorLevel": 0, "x": 280, "y": 300, "type": "hallway" },
    { "id": "raum_101", "building": "Hauptgebaeude", "floorLevel": 0, "x": 500, "y": 300, "type": "room", "label": "Raum 101" }
  ],
  "rooms": [
    { "code": "R101", "name": "Raum 101", "moduleName": "Modul A", "building": "Hauptgebaeude", "floorLevel": 0, "nodeId": "raum_101" }
  ],
  "edges": [
    { "from": "reception", "to": "flur_a", "accessible": true },
    { "from": "flur_a", "to": "raum_101", "accessible": true }
  ]
}`;

export const AdminDashboardPage = () => {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [mapVersions, setMapVersions] = useState<MapVersionSummary[]>([]);
  const [importPayload, setImportPayload] = useState(EXAMPLE_IMPORT_PAYLOAD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  const onImport = async () => {
    if (!token) {
      return;
    }

    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      const payload = JSON.parse(importPayload) as MapImportPayload;
      const result = await adminApi.importMap(token, payload);
      setInfo(`Karte importiert (Version ${result.mapVersionId}).`);
      await loadMapVersions(token);
    } catch (importError: unknown) {
      setError(importError instanceof Error ? importError.message : "Import fehlgeschlagen.");
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

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    setImportPayload(text);
  };

  return (
    <main className="page-shell admin-layout">
      <header className="inline-row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Admin - Kartenverwaltung</h1>
          <p className="muted">Karten importieren, Versionen aktivieren, Historie verwalten.</p>
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

      <section className="card">
        <h2>Neue Karte importieren</h2>
        <div className="inline-row">
          <input type="file" accept="application/json" onChange={onImportFile} />
          <button type="button" className="button" onClick={() => void onImport()} disabled={busy}>
            {busy ? "Importiere..." : "Import starten"}
          </button>
        </div>
        <p className="muted">
          Die importierte Version ist zuerst inaktiv und kann danach gezielt aktiviert werden.
        </p>
        <textarea
          className="text-area"
          value={importPayload}
          onChange={(event) => setImportPayload(event.target.value)}
        />
      </section>
    </main>
  );
};
