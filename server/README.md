# NetNav Measurement Server

A lightweight, zero-dependency Node.js HTTP server providing real network-quality measurement endpoints for NetNav.

## Endpoints

| Endpoint | Method | Description | Cache-Control |
| :--- | :--- | :--- | :--- |
| `/health` | `GET`, `HEAD` | Health check to verify server reachability. | `no-store` |
| `/probe` | `GET`, `HEAD` | Ultra-lightweight payload for HTTP round-trip latency & jitter measurements. | `no-store` |
| `/download` | `GET` | Streams a controlled binary payload to measure downlink throughput ($Mbps$). Accepts `?bytes=N` (Default: 512 KB, Min: 1 KB, Max: 10 MB). | `no-store` |
| `/upload` | `POST` | Bounded payload sink to measure uplink throughput ($Mbps$). Drains request without disk storage (Max: 10 MB). | `no-store` |

## Running the Server

### Local Development
```bash
npm run server
# or directly:
node server/index.js
```
The server will start on `http://0.0.0.0:3001` (accessible locally and to other devices on your Wi-Fi/hotspot network).

### Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3001` | Port number to bind the HTTP server. |
| `HOST` | `0.0.0.0` | Network interface to listen on (`0.0.0.0` for all interfaces, `127.0.0.1` for local-only). |
| `CORS_ORIGIN` | *(empty; no cross-origin browser access)* | Comma-separated exact HTTP(S) origins without paths or wildcards. Example: `http://localhost:5173,https://your-project.vercel.app`; list permitted preview origins explicitly. Requests without an Origin header remain supported. |

### Production Deployment
In production, deploy this server on any cloud platform (VPS, Railway, Render, Fly.io, AWS EC2, or a campus edge server) or as a serverless/edge worker with CORS enabled for your NetNav domain.

## Measurement storage API

- `POST /api/measurements`: validate and store one measurement; returns 201.
- `GET /api/measurements`: newest-first history; optional `operator`, `limit` (1–500), and `before` ISO timestamp filters.
- Requires server-only `DATABASE_URL` and migration `server/migrations/001_create_network_measurements.sql`.

## Neon setup

Create the database in Neon yourself, set `DATABASE_URL=...` in the local `.env` (never in a `VITE_` variable), run `npm run migrate`, then `npm run server`. The migration uses additive `CREATE TABLE/INDEX IF NOT EXISTS` statements. Tests inject a fake repository and do not connect to Neon.
