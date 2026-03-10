# EquiNav

Indoor-Navigation mit Kiosk-Frontend (Empfang) und separatem Admin-Bereich (Kartenverwaltung).

## Aktueller Stand

- `Kiosk` unter `/`: Suche nach Raum/Modul und Routenanzeige.
- `30s Auto-Reset`: Bei Inaktivitaet springt die Kiosk-Ansicht nach 30 Sekunden auf die Startsuche zurueck.
- `Admin` unter `/admin`: Login, Karten-Import, Karten-Version aktivieren.
- `Backend`: Express + SQLite (WAL), JWT-geschuetzte Admin-APIs.
- `Container`: Ein Container (`Containerfile`) fuer Podman/VM.

## Projektstruktur

- `backend`: API, Auth, SQLite-Schema, Routing
- `frontend`: React-UI fuer Kiosk und Admin
- `data`: wird zur Laufzeit fuer die SQLite-Datei genutzt

## Voraussetzungen

- Node.js 22+
- npm 11+

## Lokal starten

1. Abhaengigkeiten installieren:

```bash
npm install
```

2. Optional `.env` anlegen (siehe `.env.example`).

3. Frontend und Backend in zwei Terminals starten:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

4. Aufrufen:

- Kiosk: `http://localhost:5173/`
- Admin: `http://localhost:5173/admin/login`

## Build und Produktion lokal

```bash
npm run build
npm run start
```

Dann laeuft die App unter `http://localhost:8080` (API + ausgeliefertes Frontend).

## Podman (ein Container)

Build:

```bash
podman build -t equinav:latest -f Containerfile .
```

Run:

```bash
podman run -d \
  --name equinav \
  -p 8080:8080 \
  -v equinav-data:/app/data:Z \
  --env-file .env \
  --restart unless-stopped \
  equinav:latest
```

Healthcheck kann spaeter ueber `/api/health` konfiguriert werden.

## Wichtige Umgebungsvariablen

- `PORT`: HTTP-Port (Default `8080`)
- `JWT_SECRET`: Secret fuer Admin-JWT (in Produktion zwingend setzen)
- `ADMIN_USERNAME`: Initialer Admin-Username
- `ADMIN_PASSWORD`: Initiales Admin-Passwort
- `DATA_DIR`: Verzeichnis fuer SQLite-Datei
- `CORS_ORIGINS`: fuer lokalen Dev-Betrieb

## Karten-Importformat (JSON)

Die Admin-Seite akzeptiert folgendes Format:

```json
{
  "name": "Gebaeudeplan Stand 2026-03",
  "description": "Beispielimport",
  "startNodeId": "reception",
  "floors": [
    { "building": "Hauptgebaeude", "floorLevel": 0, "label": "EG" }
  ],
  "nodes": [
    {
      "id": "reception",
      "building": "Hauptgebaeude",
      "floorLevel": 0,
      "x": 120,
      "y": 300,
      "type": "entrance",
      "label": "Empfang"
    },
    {
      "id": "raum_101",
      "building": "Hauptgebaeude",
      "floorLevel": 0,
      "x": 500,
      "y": 300,
      "type": "room",
      "label": "Raum 101"
    }
  ],
  "rooms": [
    {
      "code": "R101",
      "name": "Raum 101",
      "moduleName": "Modul A",
      "building": "Hauptgebaeude",
      "floorLevel": 0,
      "nodeId": "raum_101"
    }
  ],
  "edges": [{ "from": "reception", "to": "raum_101", "accessible": true }]
}
```

## Sicherheits-/Betriebshinweise

- Admin-Endpunkte sind nur mit JWT erreichbar.
- Kiosk hat keine Admin-Bedienelemente.
- SQLite liegt persistent im Volume (`/app/data`).
- Vor Produktivbetrieb:
  - `JWT_SECRET` und `ADMIN_PASSWORD` setzen
  - Reverse Proxy/TLS vorschalten
  - Backup fuer `data/equinav.sqlite` einrichten
