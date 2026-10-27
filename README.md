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
Runs the full suite of unit and integration tests (currently 96 tests, including controlled local HTTP endpoint tests, metric validation, historical telemetry, route ranking, and navigation helpers).

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
2. **`GET /probe`**: Returns `{ ok: true, t: ... }`. The browser times the fetch through response-body receipt. This is HTTP request/response time to the configured server, not ICMP ping or isolated radio latency. DNS, connection setup, TLS, server wake-up/load, and browser scheduling can affect it.
3. **`GET /download?bytes=N`**: Streams a bounded binary payload (up to 10 MiB). The client verifies the received byte count and calculates Mbps from actual bytes and elapsed time. This is a short application-level transfer sample, not sustained carrier speed.
4. **`POST /upload`**: Accepts and counts a bounded binary payload (up to 10 MiB), then returns the exact received byte count. The client requires a matching acknowledgement and times through its receipt. This includes the HTTP response path and is not a radio-only uplink rate.

The frontend uses `VITE_MEASUREMENT_SERVER_URL` when configured. Development can use a local server URL; production fails closed unless configured with a non-loopback HTTPS server URL. Set it to the deployed Render service URL for production.

---

## 📊 Locked NQS Formula

NetNav calculates the Network Quality Score using the locked formula:

$$\text{NQS} = 0.25 L + 0.30 T + 0.20 P + 0.10 J + 0.15 S$$

- **$L$ (Latency Score):** Normalized from browser HTTP response time to `/probe` ($\le 15\text{ms} \to 100$, $\ge 300\text{ms} \to 0$).
- **$T$ (Throughput Score):** Normalized from active download throughput ($\ge 100\text{ Mbps} \to 100$, $\le 0 \to 0$).
- **$P$ (HTTP Probe Failure Rate):** Percentage of failed HTTP probes in the rolling 10-attempt window ($\le 0\% \to 100$, $\ge 20\% \to 0$). It is unavailable until all 10 observations exist; HTTP failures are not IP packet loss.
- **$J$ (Jitter Score):** Absolute difference between successive successful HTTP response-time samples ($\le 2\text{ms} \to 100$, $\ge 50\text{ms} \to 0$). It is unavailable until two successful latency samples exist.
- **$S$ (Signal Strength):** Browser sandboxing does not expose cellular RSRP/dBm. $S$ is honestly reported as `UNAVAILABLE` and the score is renormalized by dividing by the sum of available weights ($0.85$):

$$\text{NQS} = \min\left(100, \max\left(0, \text{round}\left(\frac{0.25L + 0.30T + 0.20P + 0.10J}{0.85}\right)\right)\right)$$

Unavailable components are omitted and the remaining weights are renormalized. To avoid a perfect score from a very small early-session sample, NetNav displays and accepts an NQS only when at least `0.70` of the original formula weight is supported by valid metrics. With signal unavailable, the measurable total is `0.85`; for example, latency + download + jitter alone provide only `0.65`, so NQS remains unavailable until more evidence arrives. This evidence threshold does not change the formula or metric normalization thresholds.

For wire compatibility with older API deployments, the request may include `packetLossPercent` as an alias of `probeFailurePercent`, and `metricAvailability.packetLoss` as an alias of `metricAvailability.probeFailure`. Both names mean HTTP probe failure rate, never IP or cellular packet loss. When unavailable, both numeric aliases are `null` and both availability flags are `false`; a zero is sent only for an observed 0% rate.

---

## 📱 Mobile Browser Capabilities & Limitations

### What NetNav Genuinely Measures:
- **HTTP Round-Trip Latency (RTT):** High-precision timing to the measurement server.
- **Inter-probe Jitter:** Timing variation across consecutive successful probes.
- **HTTP Probe Loss Rate:** Percentage of timed-out or dropped HTTP probes.
- **Active Downlink Throughput:** Mbps calculated from actual binary bytes streamed.
- **Active Uplink Throughput:** Mbps calculated from actual binary bytes posted.
- **Browser geolocation:** Coordinates, speed, heading, and browser-reported accuracy radius when available; saved measurements require a fresh fix with reported accuracy of 10 m or better.

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

The API supports `POST /api/measurements` and `GET /api/measurements?operator=Jio&limit=100&before=<ISO timestamp>`. History is newest-first and limited to 500 records per request. Server validation recalculates NQS using the existing locked formula and rejects samples without at least `0.70` available component weight. Automated tests use a fake repository and never connect to Neon.

## Telemetry and map location search

The telemetry panel shows the newest current-session sample for the selected operator when it is newer than saved history; otherwise it shows the newest valid persisted sample. Unavailable metrics are shown as N/A. The current browser formula version is `LTPJ-renormalized-v1`: latency (0.25), download (0.30), HTTP probe failure rate (0.20), and jitter (0.10), renormalized across available metrics. Signal is unavailable in the browser and is not scored. New quality-v2 records store `_methodVersion` in the existing `metric_availability` JSONB column, without rewriting prior records. Rows without this marker are treated as legacy/unverified, shown with a warning, and excluded from corrected Find Best Spot and route-quality scoring. The telemetry view compares eligible saved scores with the current formula where the stored metrics permit verification.

### Measurement interpretation and limitations

- Latency uses `performance.now()` around a browser fetch to `/probe` through receipt of its response body. It is HTTP request/response time to the configured measurement server, not ICMP ping or isolated radio latency. DNS, connection setup, TLS, server wake-up/load, and browser scheduling can affect it, especially on a first request.
- Jitter is `abs(current successful HTTP response time - previous successful HTTP response time)`, in milliseconds. Failed requests do not contribute an invented RTT.
- Reliability is failed HTTP probes divided by the last 10 probe outcomes. It is unavailable until the complete window exists and is not IP packet loss. The UI/API use “HTTP probe failure”; the legacy physical PostgreSQL column name is `probe_failure_percent`.
- Download uses the validated received byte count and upload requires the server's exact byte-count acknowledgement. The client times through receipt of each response. Regular tests transfer 768 KiB down and 256 KiB up every 25 seconds. These are short application-level throughput samples, not sustained carrier speed tests; payload size, buffering, and server/browser behavior affect results. A failed refresh is unavailable instead of reusing an older value.
- New persisted measurements require valid GPS coordinates, a fix no older than 10 seconds, and valid browser-reported accuracy up to 10,000 metres. Fixes above the preferred 10-metre target remain usable with an explicit uncertainty warning; accuracy is the browser's estimate, not a guarantee of physical precision.
- Operator is a manually selected attribution label. Browser APIs do not verify which SIM or carrier actually served the request.
- Standard browser APIs do not provide reliable RSRP, RSRQ, SINR, or Wi-Fi RSSI. Signal remains unavailable and excluded from NQS; native OS instrumentation would be needed.

The normalization thresholds are unchanged: latency 15–300 ms, download 0–100 Mbps, HTTP probe failure 0–20%, and jitter 2–50 ms. Each valid available metric is normalized to 0–100; unavailable components are omitted and available weights are renormalized, subject to the `0.70` minimum evidence threshold above. A low NQS can therefore follow from low measured download throughput, HTTP failures, high latency/jitter, or their combination; it does not by itself indicate a formula defect.

Map search uses the Google Maps JavaScript Geocoder, not Places Autocomplete. Enable the Google **Geocoding API** and billing for the key's Google Cloud project, and restrict the browser key to deployed HTTP referrers and required APIs. Saved measurements shown for a selected search result must match the selected operator and fall within 100 metres of the result coordinates.
