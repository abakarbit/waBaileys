# waBaileys — WhatsApp Baileys Alert Bot

> **waBaileys** adalah WhatsApp gateway / bot berbasis Node.js menggunakan library [Baileys](https://github.com/WhiskeySockets/Baileys). Mendukung **QR Code** dan **Pairing Code** untuk koneksi multi-device, REST API untuk mengirim pesan (teks/gambar/dokumen), webhook untuk notifikasi pesan masuk, serta dashboard real-time.

---

## Daftar Isi

- [Arsitektur](#arsitektur)
- [Persyaratan Sistem](#persyaratan-sistem)
- [Pemasangan dengan Docker (Direkomendasikan)](#pemasangan-dengan-docker-direkomendasikan)
- [Pemasangan Manual](#pemasangan-manual)
- [Konfigurasi](#konfigurasi)
- [Cara Penggunaan API](#cara-penggunaan-api)
- [Kirim Media (Gambar / Dokumen)](#kirim-media-gambar--dokumen)
- [Alur Pairing WhatsApp](#alur-pairing-whatsapp)
- [Multi Session](#multi-session)
- [Webhook](#webhook)
- [Dashboard](#dashboard)
- [Keamanan](#keamanan)
- [Troubleshooting](#troubleshooting)

---


### Fitur Utama

| Fitur | Status |
|-------|--------|
| Pairing via **QR Code** | [OK] |
| Pairing via **8-digit Code** | [OK] |
| Kirim pesan **personal** (teks) | [OK] |
| Kirim **gambar** ke personal/grup | [OK] |
| Kirim **dokumen** ke personal/grup | [OK] |
| Kirim pesan **grup** | [OK] |
| **Multi-session** (banyak nomor) | [OK] |
| **Dashboard real-time** (SSE) | [OK] |
| **Login page** (username + password) | [OK] |
| **User profile & settings** | [OK] |
| **Auto-reconnect** (exponential backoff) | [OK] |
| **Cek nomor WhatsApp** | [OK] |
| **Webhook** pesan masuk & event koneksi | [OK] |
| **REST API** dengan autentikasi | [OK] |
| **Rate limiter** | [OK] |
| **Security headers & CORS** | [OK] |
| **Docker support** | [OK] |

---

## Persyaratan Sistem

### Docker (Direkomendasikan)
- Docker Engine >= 20.x
- Docker Compose >= 2.x

### Manual
- Node.js >= 18 (disarankan 22)
- npm

---

## Pemasangan dengan Docker (Direkomendasikan)

### 1. Clone atau siapkan direktori project

```bash
cd /path/project
# Pastikan struktur:
# ├── Dockerfile
# ├── docker-compose.yml (rename dari docker-compose.yml_example)
# ├── index.js
# ├── dashboard.html
# ├── login.html
# ├── package.json
# └── .env
```

### 2. Siapkan Docker Compose

```bash
cp docker-compose.yml_example docker-compose.yml
```

### 3. Konfigurasi .env

```bash
cp .env.example .env
# Edit .env — isi API_KEY dan DEFAULT_PASSWORD
```

### 4. Build & Jalankan

```bash
docker compose up -d --build
```

Akses dashboard di `http://localhost:3000` (redirect ke `/login`).

### Perintah Berguna

```bash
# Lihat log
docker compose logs -f wa-bot

# Restart
docker compose restart

# Update
docker compose down
git pull   # atau update file manual
docker compose up -d --build
```

### Volume & Persistensi

Session WhatsApp tersimpan di volume `./auth_info:/app/auth_info`. Selama direktori ini tidak dihapus, session tetap aman walau container restart.

---

## Pemasangan Manual

```bash
cd /var/www/html
git clone <repo-url> waBaileys
cd waBaileys
npm install
cp .env.example .env
# Edit .env, isi API_KEY dan DEFAULT_PASSWORD
node index.js
```

Atau dengan environment variable langsung:

```bash
API_KEY=rahasia123 DEFAULT_PASSWORD=admin123 node index.js
```

Server berjalan di `http://localhost:3000`.

---

## Konfigurasi

| Variable | Default | Wajib | Deskripsi |
|----------|---------|-------|-----------|
| `API_KEY` | `''` | [OK] | String acak untuk autentikasi API. Server refuse start jika kosong |
| `REQUIRE_API_KEY` | `true` | [X] | Set `false` untuk development ([!] tidak aman) |
| `DEFAULT_USERNAME` | `admin` | [X] | Username untuk login dashboard |
| `DEFAULT_PASSWORD` | `''` | [OK] | Password login dashboard. Jika kosong, fallback ke `API_KEY` |
| `DISPLAY_NAME` | `WhatsApp Bot` | [X] | Nama tampilan default (bisa diubah dari menu Settings) |
| `PORT` | `3000` | [X] | Port server HTTP |
| `LOG_LEVEL` | `info` | [X] | Level logging: `info`, `debug`, `warn`, `error` |
| `AUTH_DIR` | `/app/auth_info` | [X] | Direktori penyimpanan session auth |
| `CORS_ORIGIN` | `*` | [X] | Origin CORS. `*` untuk semua, atau domain spesifik (pisahkan dengan koma untuk multiple) |
| `TRUST_PROXY` | `''` | [X] | Jumlah hop trust proxy (jika di belakang reverse proxy) |
| `WEBHOOK_URL` | `''` | [X] | URL endpoint POST untuk webhook notifikasi (pesan masuk & event koneksi) |
| `WEBHOOK_SECRET` | `''` | [X] | Secret untuk HMAC-SHA256 signature webhook (`X-Webhook-Signature` header) |
| `TZ` | — | [X] | Timezone container (contoh: `Asia/Jakarta`) |

---

## Cara Penggunaan API

> Semua endpoint `/api/*` WAJIB menyertakan autentikasi.
>
> **Autentikasi ada 2 jenis:**
> 1. **Session token** — didapat dari `POST /api/login` dengan username + password. Digunakan untuk akses dashboard.
> 2. **API_KEY langsung** — `Authorization: Bearer <API_KEY>` atau `X-API-Key: <API_KEY>` atau `?token=<API_KEY>`. Untuk akses API dari aplikasi eksternal.

### Summary Endpoints

| Method | Endpoint | Auth | Rate Limit | Fungsi |
|--------|----------|------|------------|--------|
| `GET` | `/health` | [X] | — | Health check |
| `GET` | `/login` | [X] | — | Halaman login dashboard |
| `GET` | `/dashboard` | [X] | — | Halaman dashboard |
| `GET` | `/` | [X] | — | Redirect ke `/login` |
| `POST` | `/api/login` | [X] | — | Login (username + password) → session token |
| `GET` | `/api/me` | [OK] | — | Info user saat ini |
| `PUT` | `/api/me` | [OK] | — | Ubah display name |
| `POST` | `/api/logout` | [OK] | — | Hapus session |
| `GET` | `/api/sessions` | [OK] | — | Daftar semua session WhatsApp |
| `POST` | `/api/pair` | [OK] | 5/60s | Pairing nomor baru (QR / code) |
| `DELETE` | `/api/sessions/:phone` | [OK] | — | Hapus session + file auth |
| `POST` | `/api/send` | [OK] | 30/60s | Kirim pesan personal (teks/gambar/dokumen) |
| `POST` | `/api/send-group` | [OK] | 30/60s | Kirim pesan grup (teks/gambar/dokumen) |
| `POST` | `/api/check-number` | [OK] | 10/60s | Cek apakah nomor terdaftar di WhatsApp |
| `GET` | `/api/pairing-status/:phone` | [OK] | — | Cek status & kode pairing suatu nomor |
| `GET` | `/api/logs` | [OK] | — | SSE stream log server |
| `GET` | `/api/pairing-stream` | [OK] | — | SSE stream event pairing |

---

### Login

```http
POST /api/login
Content-Type: application/json

{
  "username": "admin",
  "password": "<DEFAULT_PASSWORD>"
}
```

Response:
```json
{
  "success": true,
  "token": "6a4e2523-a1e7-4259-99ec-752e5c7ddd1a",
  "user": {
    "username": "admin",
    "displayName": "WhatsApp Bot"
  }
}
```

> Token digunakan sebagai `Authorization: Bearer <token>` untuk semua request API selanjutnya. Token berlaku **24 jam** (diperpanjang setiap digunakan).

### Get Current User

```http
GET /api/me
Authorization: Bearer <token_atau_api_key>
```

Response:
```json
{
  "user": {
    "username": "admin",
    "displayName": "WhatsApp Bot"
  },
  "authType": "session"
}
```

### Update Display Name

```http
PUT /api/me
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "displayName": "Nama Baru"
}
```

### Logout

```http
POST /api/logout
Authorization: Bearer <session_token>
```

Response:
```json
{ "success": true }
```

### Health Check

```http
GET /health
```

Response:
```json
{
  "status": "disconnected",
  "uptime": 3600.5,
  "sessionCount": 2,
  "sessions": [
    {
      "phone": "6281234567890",
      "connected": true,
      "registered": true,
      "jid": "6281234567890@s.whatsapp.net",
      "pairing": null
    }
  ]
}
```

---

### Daftar Semua Session

```http
GET /api/sessions
Authorization: Bearer <API_KEY>
```

Response:
```json
{
  "sessions": [
    {
      "phone": "6281234567890",
      "connected": true,
      "registered": true,
      "jid": "6281234567890@s.whatsapp.net",
      "pairing": null
    },
    {
      "phone": "6289876543210",
      "connected": false,
      "registered": true,
      "jid": "6289876543210@s.whatsapp.net",
      "pairing": null
    }
  ]
}
```

---

### Hapus Session

```http
DELETE /api/sessions/6281234567890
Authorization: Bearer <API_KEY>
```

Response:
```json
{
  "message": "Session dihapus"
}
```

> Session akan dihapus termasuk file auth di `AUTH_DIR/{phone}/`. Untuk pairing ulang, panggil `/api/pair` lagi.

---

### Pairing via QR Code

```http
POST /api/pair
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890",
  "method": "qr"
}
```

Response:
```json
{
  "success": true,
  "method": "qr",
  "qr": "data:image/png;base64,iVBORw0KGgo...",
  "phone": "6281234567890",
  "registered": false,
  "connected": false
}
```

> `qr` berisi data URL base64 dari QR code. Tampilkan sebagai `<img src="...">`. QR code baru akan di-generate dan dikirim via SSE saat session siap.

---

### Pairing via Kode 8 Digit

```http
POST /api/pair
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890",
  "method": "code"
}
```

Tanpa parameter `method`, default `"code"`:

```http
POST /api/pair
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890"
}
```

Response:
```json
{
  "success": true,
  "method": "code",
  "code": "ABCD-12EF",
  "qr": null,
  "time": 1712345678000,
  "expiresAt": 1712345978000,
  "ttlSeconds": 300,
  "registered": false,
  "connected": false
}
```

> **Cara pakai:** Buka WhatsApp > Perangkat Tertaut > **Pair dengan Kode** > Masukkan `ABCD-12EF`. Kode berlaku **5 menit**.

---

### Cek Status Pairing

```http
GET /api/pairing-status/6281234567890
Authorization: Bearer <API_KEY>
```

Response:
```json
{
  "pairing": {
    "code": "ABCD-12EF",
    "time": 1712345678000,
    "expiresAt": 1712345978000
  },
  "connected": false,
  "registered": false
}
```

---

### Kirim Pesan Personal (Teks)

```http
POST /api/send
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890",
  "to": "6289876543210",
  "message": "Halo, ini pesan dari bot!"
}
```

Parameter:
- `phone` — Nomor session bot yang akan digunakan untuk mengirim
- `to` — Nomor tujuan (bisa dengan atau tanpa `@s.whatsapp.net`)
- `message` — Teks pesan (maks 64KB)

Response:
```json
{
  "success": true,
  "id": "ABEGYk80m2p7..."
}
```

Error jika session belum terhubung:
```json
{
  "error": "Session belum terhubung"
}
```

---

### Kirim Pesan ke Grup (Teks)

```http
POST /api/send-group
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890",
  "groupJid": "6281234567890-1234567890@g.us",
  "message": "Halo grup!"
}
```

Parameter:
- `phone` — Nomor session bot
- `groupJid` — JID grup. Format: `<nomor>-<id>@g.us`. Bisa dapat dari log atau dashboard.
- `message` — Teks pesan

Response:
```json
{
  "success": true,
  "id": "ABEGYk80m2p8..."
}
```

> **Tips:** Untuk cek JID grup, kirim pesan ke grup dari nomor yang sudah paired, lalu lihat log di dashboard — JID grup akan muncul.

---

### Cek Nomor WhatsApp

Memeriksa apakah suatu nomor terdaftar di WhatsApp.

```http
POST /api/check-number
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6289876543210"
}
```

Response (terdaftar):
```json
{
  "success": true,
  "exists": true,
  "jid": "6289876543210@s.whatsapp.net",
  "phone": "6289876543210"
}
```

Response (tidak terdaftar):
```json
{
  "success": true,
  "exists": false,
  "phone": "6289876543210"
}
```

> Memerlukan minimal satu session WhatsApp yang **terhubung** untuk melakukan pengecekan.

---

### SSE Stream: Log Real-time

```http
GET /api/logs?token=<API_KEY>
```

Event stream:
```
data: {"time":1712345678000,"level":"info","msg":"[628xxx] Terhubung"}
data: {"time":1712345679000,"level":"warn","msg":"[628xxx] Disconnected"}

: heartbeat
```

> Heartbeat setiap 20 detik untuk menjaga koneksi. Gunakan `EventSource` di JavaScript:
> ```js
> new EventSource('/api/logs?token=' + token)
> ```

### SSE Stream: Status Pairing Real-time

```http
GET /api/pairing-stream?token=<API_KEY>
```

Event stream:
```
data: {"phone":"628xxx","code":"ABCD-12EF","status":"pairing",...}
data: {"phone":"628xxx","qr":"data:image/png;base64,....","status":"qr_ready"}
data: {"phone":"628xxx","status":"paired"}
data: {"phone":"628xxx","status":"removed"}
```

> Berguna untuk update UI pairing secara real-time tanpa polling.

---

## Kirim Media (Gambar / Dokumen)

Endpoint `/api/send` dan `/api/send-group` mendukung pengiriman media dengan parameter `type`.

### Kirim Gambar

```http
POST /api/send
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890",
  "to": "6289876543210",
  "message": "Lihat foto ini!",
  "type": "image",
  "imageUrl": "https://example.com/foto.jpg"
}
```

Atau dengan base64:
```json
{
  "phone": "6281234567890",
  "to": "6289876543210",
  "message": "Lihat foto ini!",
  "type": "image",
  "image": "/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
```

### Kirim Dokumen

```http
POST /api/send
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "phone": "6281234567890",
  "to": "6289876543210",
  "message": "Ini file PDF",
  "type": "document",
  "documentUrl": "https://example.com/file.pdf",
  "fileName": "laporan.pdf",
  "mimetype": "application/pdf"
}
```

Atau dengan base64:
```json
{
  "phone": "6281234567890",
  "to": "6289876543210",
  "type": "document",
  "document": "JVBERi0xLjQKMSAwIG9iag...",
  "fileName": "dokumen.pdf",
  "mimetype": "application/pdf"
}
```

Parameter media:

| Parameter | Tipe | Wajib | Deskripsi |
|-----------|------|-------|-----------|
| `type` | string | [OK] | `"image"` atau `"document"`. Jika tidak diisi, default `"text"` |
| `image` / `imageUrl` | string | [OK]* | Data base64 atau URL gambar |
| `document` / `documentUrl` | string | [OK]* | Data base64 atau URL dokumen |
| `fileName` | string | [X] | Nama file (khusus dokumen) |
| `mimetype` | string | [X] | MIME type (khusus dokumen, default `application/octet-stream`) |

\* Wajib diisi sesuai `type`.

---

## Alur Pairing WhatsApp

### QR Code (Rekomendasi)

```
User           Dashboard          Server              WhatsApp
 │                │                  │                    │
 │ Buka dashboard │                  │                    │
 │ Pilih "QR"     │                  │                    │
 │ Isi nomor      │                  │                    │
 │ (auto-trigger) │ POST /api/pair   │                    │
 │──────────────> │ method=qr        │                    │
 │                │─────────────────>│                    │
 │                │                  │ Start session      │
 │                │ QR base64        │ Generate QR        │
 │                │<─────────────────│                    │
 │ Tampilkan QR   │                  │                    │
 │ Scan QR        │                  │                    │
 │───────────────────────────────────────────────────────>│
 │                │                  │                    │
 │                │ SSE: paired      │ Connection open    │
 │                │<─────────────────│                    │
 │ [OK] Terhubung │                  │                    │
```

### Pairing Code

```
User           Dashboard          Server              WhatsApp
 │                │                  │                    │
 │ Buka dashboard │                  │                    │
 │ Pilih "Code"   │                  │                    │
 │ Isi nomor      │                  │                    │
 │ Klik "Mulai"   │ POST /api/pair   │                    │
 │──────────────> │ method=code      │                    │
 │                │─────────────────>│                    │
 │                │ 8-digit code     │ requestPairing()   │
 │                │<─────────────────│                    │
 │ Masukkan kode  │                  │                    │
 │ di WA > Tertaut│                  │                    │
 │───────────────────────────────────────────────────────>│
 │                │                  │                    │
 │                │ SSE: paired      │ Connection open    │
 │                │<─────────────────│                    │
 │ [OK] Terhubung │                  │                    │
```

---

## Multi Session

waBaileys mendukung **banyak nomor WhatsApp secara bersamaan**. Setiap nomor memiliki session sendiri dengan autentikasi dan koneksi independen.

### Cara kerja:
1. Pair nomor A via QR → session aktif
2. Pair nomor B via QR → session kedua terpisah
3. Kirim pesan dengan menentukan `phone` di parameter request

### Contoh multi-session:

```bash
# Pair nomor 1
curl -X POST http://localhost:3000/api/pair \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"phone":"6281111111111","method":"qr"}'

# Pair nomor 2
curl -X POST http://localhost:3000/api/pair \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"phone":"6282222222222","method":"qr"}'

# Kirim dari nomor 1
curl -X POST http://localhost:3000/api/send \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"phone":"6281111111111","to":"6283333333333","message":"Dari nomor 1"}'

# Kirim dari nomor 2
curl -X POST http://localhost:3000/api/send \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"phone":"6282222222222","to":"6283333333333","message":"Dari nomor 2"}'
```

### Session recovery:
- Session tersimpan di `AUTH_DIR/{phone}/creds.json`
- Saat server restart, session tetap ada tapi dalam status `disconnected`
- Auto-reconnect dengan exponential backoff: `3s → 6s → 12s → ... → maks 5 menit`

---

## Webhook

waBaileys dapat mengirim notifikasi **pesan masuk** dan **event koneksi** ke URL yang Anda tentukan.

### Konfigurasi

Set `WEBHOOK_URL` dan (opsional) `WEBHOOK_SECRET` di `.env`:

```ini
WEBHOOK_URL=https://hook.example.com/whatsapp
WEBHOOK_SECRET=rahasia_webhook
```

### Format Payload

Semua webhook dikirim sebagai `POST` JSON:

```json
{
  "event": "message.incoming",
  "data": { ... },
  "time": 1712345678000
}
```

### Event: `message.incoming`

Terjadi saat ada pesan masuk ke nomor bot.

```json
{
  "event": "message.incoming",
  "data": {
    "phone": "6281234567890",
    "from": "6289876543210@s.whatsapp.net",
    "fromMe": false,
    "text": "Halo, ini pesan masuk",
    "type": "conversation"
  },
  "time": 1712345678000
}
```

### Event: `connection.open`

Terjadi saat session berhasil terhubung ke WhatsApp.

```json
{
  "event": "connection.open",
  "data": {
    "phone": "6281234567890"
  },
  "time": 1712345678000
}
```

### Event: `connection.close`

Terjadi saat session terputus.

```json
{
  "event": "connection.close",
  "data": {
    "phone": "6281234567890",
    "reason": "replaced",
    "willReconnect": true
  },
  "time": 1712345678000
}
```

### Keamanan Webhook

Jika `WEBHOOK_SECRET` dikonfigurasi, setiap request webhook akan menyertakan header:

```
X-Webhook-Signature: sha256=HMAC_SHA256(payload, WEBHOOK_SECRET)
```

Verifikasi signature di endpoint Anda untuk memastikan payload benar-benar dari waBaileys.

---

## Dashboard

Dashboard tersedia di `GET /dashboard` (redirect dari `/`).

### Fitur Dashboard:
- **Stat cards**: Connected / Disconnected / Total session
- **Tabel Sessions**: Nomor, status, pairing code, JID, tombol hapus
- **Pair Modal**: Pilih metode QR atau Pairing Code (auto-trigger QR saat nomor diketik)
- **Kirim Pesan**: Form kirim ke personal atau grup (teks, gambar, dokumen)
- **Activity Log**: Streaming real-time via SSE
- **Settings**: Ubah display name
- **Auto-refresh**: Session di-refresh tiap 3 detik

### Autentikasi Dashboard:
Dashboard menggunakan **halaman login** (`/login`) dengan form username + password. Setelah login berhasil, session token disimpan di **localStorage** browser dan digunakan untuk semua request API. Tersedia tombol **Logout** di header dashboard.

---

## Keamanan

### Lapisan Keamanan

| Lapisan | Implementasi |
|---------|-------------|
| **API Key** | Wajib diisi — server **refuse start** jika kosong |
| **Login Dashboard** | Username + password via halaman `/login` — session token UUID |
| **Autentikasi Multi-metode** | Bearer token, `X-API-Key` header, query param `?token=` |
| **Autentikasi SSE** | Semua SSE endpoint memerlukan token via `?token=` |
| **Security Headers** | `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Strict-Transport-Security` |
| **CORS** | Configurable via `CORS_ORIGIN` |
| **Rate Limiter** | Pairing: 5/60s, Send: 30/60s, Check-Number: 10/60s |
| **Body Size Limit** | 100KB per request |
| **Message Length** | 64KB maksimal per pesan |
| **Input Validation** | Phone format (8-15 digit), JID format, sanitasi input |
| **Error 463 Handling** | Deteksi pembatasan WhatsApp → return 403 |
| **Request Tracing** | Setiap response memiliki `X-Request-Id` header |
| **Webhook Signature** | Opsional HMAC-SHA256 pada payload webhook |

### Best Practices Production

1. **API_KEY kuat:**
   ```bash
   openssl rand -hex 32
   # contoh: a7b3c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
   ```

2. **CORS spesifik:**
   ```ini
   CORS_ORIGIN=https://dashboard.example.com
   ```

3. **Gunakan reverse proxy (Nginx) dengan HTTPS:**
   ```nginx
   location / {
     proxy_pass http://localhost:3000;
     proxy_set_header X-Forwarded-Proto $scheme;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_buffering off; # Penting untuk SSE!
   }
   ```
   Set `TRUST_PROXY=1` jika menggunakan Nginx.

4. **Jangan expose port 3000 langsung ke internet** tanpa reverse proxy.

---

## Troubleshooting

### Server tidak start: "API_KEY tidak dikonfigurasi"

Solusi: Set `API_KEY` di `.env`:
```ini
API_KEY=isi_dengan_string_acak
```
Atau untuk development:
```ini
REQUIRE_API_KEY=false
```

### QR Code tidak muncul

1. Pastikan nomor valid (8-15 digit, tanpa `+`)
2. Cek log server: `docker compose logs wa-bot`
3. Coba pairing ulang dengan method `code`
4. Jika tetap gagal, coba hapus session yang mungkin corrupt: `DELETE /api/sessions/:phone`

### Session terputus terus

- Exponential backoff akan mencoba reconnect otomatis (3s → 6s → 12s → max 5 menit)
- Jika logged out permanent, hapus session via `DELETE /api/sessions/:phone` lalu pairing ulang
- Cek kualitas internet server

### "Session belum terhubung" saat kirim pesan

1. Cek status session via `GET /api/sessions`
2. Jika `connected: false` tapi `registered: true`, tunggu auto-reconnect
3. Jika `registered: false`, lakukan pairing ulang

### Error: `Connection Closed`

Error Baileys yang umum terjadi saat:
- Koneksi internet tidak stabil
- WhatsApp mengirim ulang kode pairing
- Solusi: Coba lagi (endpoint sudah memiliki retry 3x otomatis)

### Error 463 / "tctoken" / "restricted"

Akun WhatsApp bot terkena pembatasan atau kontak memblokir nomor bot:
- Coba pairing ulang
- Jika terus terjadi, gunakan nomor WhatsApp lain

### Docker: port 3000 sudah dipakai

Ubah port di `docker-compose.yml`:
```yaml
environment:
  - PORT=3001
```
Lalu akses di `http://localhost:3001`.

### Log tidak muncul di dashboard

- SSE membutuhkan `proxy_buffering off` jika di belakang Nginx
- Cek koneksi EventSource di browser console (F12 > Console)
- Pastikan token valid

### docker-compose.yml tidak ditemukan

```bash
cp docker-compose.yml_example docker-compose.yml
```

---
