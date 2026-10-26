# NETNAV — Network-Aware Campus Navigation

NetNav is a network-quality intelligence and navigation dashboard built for VIT Vellore. It pairs real-time network measurements with high-accuracy mobile GPS positioning and interactive Google Maps visualization.

---

## 🚀 Quick Start Guide

### 1. Start the Measurement Server
In a terminal window:
```bash
npm run server
```
The server will start on `http://0.0.0.0:3001` (accessible locally and to other devices on the same Wi-Fi/hotspot network).

### 2. Start the Frontend
In a second terminal window:
```bash
npm run dev
```
Open the printed local URL (e.g., `http://localhost:5173` or `http://<your-lan-ip>:5173` on mobile devices).

### 3. Run the Automated Test Suite
```bash
npm test
```
Runs the full suite of unit and integration tests (16 tests covering NQS normalization, active throughput, latency probes, timeouts, offline detection, and session cancellation).

---

## 📡 Environment Variables

| Variable | Location | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `VITE_MEASUREMENT_SERVER_URL` | `.env` / `src/.env` | `http://localhost:3001` | Measurement server endpoint URL for latency probes and throughput tests. |
| `VITE_GOOGLE_MAPS_API_KEY` | `.env` / `src/.env` | *(Configured)* | Google Maps JavaScript API key for campus map rendering. |
| `PORT` | Server Environment | `3001` | Port on which the measurement server listens. |
| `HOST` | Server Environment | `0.0.0.0` | Network interface to bind (`0.0.0.0` for all LAN/Wi-Fi devices). |
| `CORS_ORIGIN` | Server Environment | *(empty)* | Comma-separated exact HTTP(S) origins without paths or wildcards, e.g. `https://your-project.vercel.app`. List permitted preview origins explicitly. Requests without an `Origin` header remain supported. |

---

## 🏗️ Measurement Architecture

```text
NetNav Frontend (Browser)
   │
   ├── (Every ~1s) ────────> GET  /probe     (Lightweight HTTP RTT & Jitter)
   ├── (Every ~25s) ───────> GET  /download  (Active Download Speed Test)
   ├── (Every ~25s) ───────> POST /upload    (Active Upload Speed Test)
   └── (Session Start) ────> GET  /health    (Availability Check)
```

### Endpoints Implemented

1. **`GET /health`**: Verifies server health with anti-caching headers.
2. **`GET /probe`**: Returns an ultra-compact JSON response `{ ok: true, t: ... }` for sub-millisecond overhead RTT latency measurement.
3. **`GET /download?bytes=N`**: Streams binary data to measure genuine downlink speed in Mbps ($(\text{bytes} \times 8) / (\text{durationSec} \times 10^6)$).
4. **`POST /upload`**: Accepts a bounded binary payload to measure genuine uplink speed in Mbps without storing test files.

---

## 📊 Locked NQS Formula

NetNav calculates the Network Quality Score using the locked formula:

$$\text{NQS} = 0.25 L + 0.30 T + 0.20 P + 0.10 J + 0.15 S$$

- **$L$ (Latency Score):** Normalized from external RTT latency ($\le 15\text{ms} \to 100$, $\ge 300\text{ms} \to 0$).
- **$T$ (Throughput Score):** Normalized from active download throughput ($\ge 100\text{ Mbps} \to 100$, $\le 0 \to 0$).
- **$P$ (Probe Failure Rate):** Percentage of failed probes over the last 10 attempts ($\le 0\% \to 100$, $\ge 20\% \to 0$).
- **$J$ (Jitter Score):** Inter-probe latency variation $\lvert \text{RTT}_t - \text{RTT}_{t-1} \rvert$ ($\le 2\text{ms} \to 100$, $\ge 50\text{ms} \to 0$).
- **$S$ (Signal Strength):** Browser sandboxing does not expose cellular RSRP/dBm. $S$ is honestly reported as `UNAVAILABLE` and the score is renormalized by dividing by the sum of available weights ($0.85$):

$$\text{NQS} = \min\left(100, \max\left(0, \text{round}\left(\frac{0.25L + 0.30T + 0.20P + 0.10J}{0.85}\right)\right)\right)$$

---

## 📱 Mobile Browser Capabilities & Limitations

### What NetNav Genuinely Measures:
- **HTTP Round-Trip Latency (RTT):** High-precision timing to the measurement server.
- **Inter-probe Jitter:** Timing variation across consecutive successful probes.
- **HTTP Probe Loss Rate:** Percentage of timed-out or dropped HTTP probes.
- **Active Downlink Throughput:** Mbps calculated from actual binary bytes streamed.
- **Active Uplink Throughput:** Mbps calculated from actual binary bytes posted.
- **High-Accuracy Geolocation:** GPS coordinates, speed, heading, and accuracy radius.

### Mobile Browser Restrictions (By W3C Design):
- **Cellular Signal (RSRP / RSRQ / SINR / RSSI):** Cannot be read by web browsers without a native Android (Java/Kotlin) or iOS app.
- **Physical Radio Band (5G n78, 4G B1/B3/B40):** Blocked by browser security sandboxing.
- **Active SIM Detection:** The operator selector (Jio, Airtel, Vi, BSNL) in the UI serves as a user tag; web applications cannot read the SIM card IMSI or carrier profile.

---

## 📈 Mobile Data Usage Estimates

Because NetNav decouples lightweight 1 Hz latency probes from throttled throughput tests:
- **Latency Probes (~1 Hz):** ~3,600 requests/hour $\times$ ~100 bytes $\approx$ **0.36 MB / hour**.
- **Active Throughput Tests (Every 25s):** ~144 speed tests/hour $\times$ ~1 MB total payload $\approx$ **144 MB / hour**.
- **Total Expected Data Consumption:** **~145 MB / hour of continuous active measurement**.

## PostgreSQL storage (Neon or local PostgreSQL)

1. Create a PostgreSQL database in Neon yourself and copy its connection string.
2. Copy `.env.example` to `.env` if needed, then set `DATABASE_URL` in `.env`. Keep the real value private; do not use a `VITE_` prefix.
3. Install dependencies with `npm install`, then run `npm run migrate` to create the `network_measurements` table and indexes. The migration uses additive `CREATE TABLE/INDEX IF NOT EXISTS` statements.
4. Start the API with `npm run server`. Data endpoints return 503 until `DATABASE_URL` and the migration are configured.

The API supports `POST /api/measurements` and `GET /api/measurements?operator=Jio&limit=100&before=<ISO timestamp>`. History is newest-first and limited to 500 records per request. Server validation recalculates NQS using the existing locked formula. Automated tests use a fake repository and never connect to Neon.

## Telemetry and map location search

The telemetry panel shows the newest current-session sample for the selected operator when it is newer than saved history; otherwise it shows the newest valid persisted sample. Unavailable metrics are shown as N/A. The current browser formula version is `LTPJ-renormalized-v1`: latency (0.25), download (0.30), HTTP probe failure rate (0.20), and jitter (0.10), renormalized across available metrics. Signal is unavailable in the browser and is not scored. The database does not store an NQS formula-version field, so historical records remain unchanged and the UI compares their saved NQS with the current formula, flagging mismatches or unverifiable rows.

Map search uses the Google Maps JavaScript Geocoder, not Places Autocomplete. Enable the Google **Geocoding API** and billing for the key's Google Cloud project, and restrict the browser key to deployed HTTP referrers and required APIs. Saved measurements shown for a selected search result must match the selected operator and fall within 100 metres of the result coordinates.
