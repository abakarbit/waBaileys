# waBaileys — WhatsApp Baileys Alert Bot

> **waBaileys** adalah bot WhatsApp gateway berbasis Node.js menggunakan library [Baileys](https://github.com/WhiskeySockets/Baileys). Mendukung **QR Code** dan **Pairing Code** untuk koneksi multi-device, REST API untuk mengirim pesan, serta dashboard real-time.

---

## Daftar Isi

- [Arsitektur](#arsitektur)
- [Persyaratan Sistem](#persyaratan-sistem)
- [Pemasangan dengan Docker (Direkomendasikan)](#pemasangan-dengan-docker-direkomendasikan)
- [Pemasangan Manual](#pemasangan-manual)
- [Konfigurasi](#konfigurasi)
- [Cara Penggunaan API](#cara-penggunaan-api)
- [Alur Pairing WhatsApp](#alur-pairing-whatsapp)
- [Multi Session](#multi-session)
- [Dashboard](#dashboard)
- [Keamanan](#keamanan)
- [Troubleshooting](#troubleshooting)

---

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│     waBaileys Server     │
│              │
│ ┌─────────────┐ ┌──────────────────────────────┐ │
│ │ Dashboard │ │  REST API    │ │
│ │ (HTML/JS) │ │ /api/pair /api/send  │ │
│ │ SSE Stream │ │ /api/sessions /api/send-group│ │
│ └──────┬───────┘ └──────────┬───────────────────┘ │
│   │      │      │
│ ┌──────┴─────────────────────┴───────────────────┐ │
│ │   SessionManager (Multi-Session)  │ │
│ │ ┌───────────────────────────────────────────┐ │ │
│ │ │ Session 1 │ Session 2 │ Session N │ │ │
│ │ │ (628xxx)  │ (628yyy)  │ (628zzz) │ │ │
│ │ └──────────────┴──────────────┴─────────────┘ │ │
│ └─────────────────────────────────────────────────┘ │
│      │        │
│ ┌─────────────────────┴───────────────────────────┐ │
│ │   Baileys (WhatsApp Web API)    │ │
│ │ ┌──────────────┐ ┌──────────────────────────┐ │ │
│ │ │ QR / Pairing │ │ Send Message / Group │ │ │
│ │ └──────────────┘ └──────────────────────────┘ │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Fitur Utama

| Fitur | Status |
|-------|--------|
| Pairing via **QR Code** | [OK] |
| Pairing via **8-digit Code** | [OK] |
| Kirim pesan **personal** | [OK] |
| Kirim pesan **grup** | [OK] |
| **Multi-session** (banyak nomor) | [OK] |
| **Dashboard real-time** (SSE) | [OK] |
| **Login page** (username + password) | [OK] |
| **User profile & settings** | [OK] |
| **Auto-reconnect** (exponential backoff) | [OK] |
| **REST API** dengan autentikasi | [OK] |
| **Rate limiter** | [OK] |
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
# ├── docker-compose.yml
# ├── index.js
# ├── dashboard.html
# ├── package.json
# └── .env
```

### 2. Konfigurasi .env

Buat file `.env` di root project:

```bash
cp .env.example .env
nano .env
```

Isi minimal:

```ini
# WAJIB: API Key untuk autentikasi API eksternal
API_KEY=isi_dengan_string_acak_minimal_16_karakter

# WAJIB: Password untuk login dashboard (username: admin)
DEFAULT_PASSWORD=isi_dengan_password_kuat

# Opsional: timezone
TZ=Asia/Jakarta
```

### 3. Build & Jalankan

```bash
docker compose up -d --build
```

Cek log:

```bash
docker compose logs -f wa-bot
```

Akses dashboard:

```
http://localhost:3000/dashboard
```

### 4. Update container

```bash
docker compose down
git pull # atau update file manual
docker compose up -d --build
```

### 5. Volume & Persistensi

Session WhatsApp tersimpan di volume `./auth_info:/app/auth_info`. 
Selama direktori ini tidak dihapus, session tetap aman walau container restart.

---

## Pemasangan Manual

### 1. Clone project

```bash
cd /var/www/html
git clone <repo-url> waBaileys
cd waBaileys
```

### 2. Install dependencies

```bash
npm install
```

### 3. Konfigurasi .env

```bash
cp .env.example .env
nano .env
```

### 4. Jalankan server

```bash
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
| `API_KEY` | `''` | [OK] | String acak untuk autentikasi semua API. Jika kosong, server refuse start |
| `REQUIRE_API_KEY` | `true` | [X] | Set `false` untuk development ([!] tidak aman) |
| `DEFAULT_USERNAME` | `admin` | [X] | Username untuk login dashboard |
| `DEFAULT_PASSWORD` | `''` | [OK] | Password untuk login dashboard. Jika kosong, fallback ke API_KEY |
| `PORT` | `3000` | [X] | Port server |
| `LOG_LEVEL` | `info` | [X] | Level logging: `info`, `debug`, `warn`, `error` |
| `AUTH_DIR` | `/app/auth_info` | [X] | Direktori penyimpanan session auth |
| `CORS_ORIGIN` | `*` | [X] | Origin CORS. `*` untuk semua, atau domain spesifik |
| `TRUST_PROXY` | `''` | [X] | Jumlah hop trust proxy (jika di belakang reverse proxy) |

---

## Cara Penggunaan API

> Semua endpoint `/api/*` WAJIB menyertakan autentikasi. 
> **Autentikasi ada 2 jenis:**
> 1. **Session token** — didapat dari `POST /api/login` dengan username + password. Digunakan untuk akses dashboard.
> 2. **API_KEY langsung** — `Authorization: Bearer <API_KEY>` atau `X-API-Key: <API_KEY>` atau `?token=<API_KEY>`. Untuk akses API dari aplikasi eksternal.

### Summary Endpoints

| Method | Endpoint | Auth | Rate Limit | Fungsi |
|--------|----------|------|------------|--------|
| `GET` | `/health` | [X] | — | Health check |
| `GET` | `/login` | [X] | — | Halaman login dashboard |
| `POST` | `/api/login` | [X] | — | Login (username + password) → session token |
| `GET` | `/api/me` | [OK] | — | Info user saat ini |
| `PUT` | `/api/me` | [OK] | — | Ubah display name |
| `POST` | `/api/logout` | [OK] | — | Hapus session |
| `GET` | `/api/sessions` | [OK] | — | Daftar semua session |
| `POST` | `/api/pair` | [OK] | 5/60s | Pairing nomor baru |
| `DELETE` | `/api/sessions/:phone` | [OK] | — | Hapus session |
| `POST` | `/api/send` | [OK] | 30/60s | Kirim pesan personal |
| `POST` | `/api/send-group` | [OK] | 30/60s | Kirim pesan grup |
| `GET` | `/api/logs` | [OK] | — | SSE stream log |
| `GET` | `/api/pairing-stream` | [OK] | — | SSE status pairing |
| `GET` | `/api/pairing-status/:phone` | [OK] | — | Cek status pairing |

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

> Token ini digunakan sebagai `Authorization: Bearer <token>` untuk semua request API selanjutnya. 
> Token berlaku **24 jam**. Untuk logout, panggil `POST /api/logout`.

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

> **Catatan:** `qr` berisi data URL base64 dari QR code. Tampilkan sebagai `<img src="...">` atau scan langsung. QR code aktif selama 30 detik — jika kedaluwarsa, panggil ulang endpoint.

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

> **Cara pakai:** Buka WhatsApp > Perangkat Tertaut > **Pair dengan Kode** > Masukkan `ABCD-12EF`. 
> Kode berlaku **5 menit**. Tampilkan countdown di UI.

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

> Session akan dihapus termasuk file auth di `auth_info/`. Untuk pairing ulang, panggil `/api/pair` lagi.

---

### Kirim Pesan Personal

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
- `phone`: Nomor session bot yang akan digunakan untuk mengirim
- `to`: Nomor tujuan (bisa dengan atau tanpa `@s.whatsapp.net`)
- `message`: Teks pesan (maks 64KB)

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

### Kirim Pesan ke Grup

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
- `phone`: Nomor session bot
- `groupJid`: JID grup (dapatkan dari log atau dashboard) 
 Format: `<nomor>-<id>@g.us`
- `message`: Teks pesan

Response:
```json
{
 "success": true,
 "id": "ABEGYk80m2p8..."
}
```

> **Tips:** Untuk cek JID grup, kirim pesan ke grup dari nomor yang sudah paired, lalu lihat log di dashboard — JID grup akan muncul di log.

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

> EventSource JavaScript: `new EventSource('/api/logs?token=' + token)`

---

### SSE Stream: Status Pairing Real-time

```http
GET /api/pairing-stream?token=<API_KEY>
```

Event stream:
```
data: {"phone":"628xxx","code":"ABCD-12EF","status":"pairing",...}
```

---

## Alur Pairing WhatsApp

### QR Code (Rekomendasi)

```
User    Dashboard    Server   WhatsApp
 │     │      │     │
 │ Buka dashboard  │      │     │
 │ Pilih "QR Code" │      │     │
 │ Isi nomor   │      │     │
 │ Klik "Mulai QR" │ POST /api/pair  │     │
 │───────────────────>│ method=qr   │     │
 │     │────────────────────>│     │
 │     │      │ Start session │
 │     │ QR base64   │ Generate QR  │
 │     │<────────────────────│     │
 │ Tampilkan QR  │      │     │
 │ Scan QR   │      │     │
 │──────────────────────────────────────────────────────────>│
 │     │      │     │
 │     │ SSE: paired  │ Connection open │
 │     │<────────────────────│     │
 │ [OK] Terhubung  │      │     │
```

### Pairing Code

```
User    Dashboard    Server   WhatsApp
 │     │      │     │
 │ Buka dashboard  │      │     │
 │ Pilih "Pairing Code"│     │     │
 │ Isi nomor   │      │     │
 │ Klik "Mulai Pair" │ POST /api/pair  │     │
 │───────────────────>│ method=code  │     │
 │     │────────────────────>│     │
 │     │ 8-digit code  │ requestCode() │
 │     │<────────────────────│     │
 │ Masukkan kode  │      │     │
 │ di WA > Tertaut │      │     │
 │──────────────────────────────────────────────────────────>│
 │     │      │     │
 │     │ SSE: paired  │ Connection open │
 │     │<────────────────────│     │
 │ [OK] Terhubung  │      │     │
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
- Auto-reconnect dengan exponential backoff: 3s → 6s → 12s → ... → max 5 menit

---

## Dashboard

Dashboard tersedia di `GET /dashboard` (redirect dari `/`).

### Fitur Dashboard:
- **Stat cards**: Connected / Disconnected / Total session
- **Tabel Sessions**: Nomor, status, pairing code, JID, tombol hapus
- **Pair Modal**: Pilih metode QR atau Pairing Code
- **Kirim Pesan**: Form kirim ke personal atau grup
- **Activity Log**: Streaming real-time via SSE
- **Auto-refresh**: Session di-refresh tiap 3 detik

### Autentikasi Dashboard:
Dashboard menggunakan **halaman login** (`/login`) dengan form username + password. 
Setelah login berhasil, session token disimpan di **localStorage** browser dan digunakan untuk semua request API. 
Tersedia tombol **Logout** di header dashboard serta menu **Settings** untuk mengubah nama tampilan.

---

## Keamanan

### Lapisan Keamanan

| Lapisan | Implementasi |
|---------|-------------|
| **API Key** | Wajib diisi — server **refuse start** jika kosong |
| **Login Dashboard** | Username + password via halaman `/login` — session token UUID |
| **Autentikasi Multi-metode** | Bearer token, X-API-Key header, query param `?token=` |
| **Autentikasi SSE** | Semua SSE endpoint memerlukan token via `?token=` |
| **Security Headers** | X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, HSTS |
| **CORS** | Configurable via `CORS_ORIGIN` |
| **Rate Limiter** | Pairing: 5/60s, Send: 30/60s |
| **Body Size Limit** | 100KB per request |
| **Message Length** | 64KB maksimal per pesan |
| **Input Validation** | Phone format, JID format, sanitasi input |
| **Request Tracing** | Setiap response memiliki `X-Request-Id` header |

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
  proxy_buffering off; # Penting untuk SSE
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

1. Pastikan nomor valid (8-15 digit, tanpa +)
2. Cek log server: `docker compose logs wa-bot`
3. Coba pairing ulang dengan method `code`
4. QR timeout 30 detik — jika tidak muncul, panggil ulang endpoint

### Session terputus terus

- Exponential backoff akan mencoba reconnect otomatis
- Jika logged out permanent, hapus session via `DELETE /api/sessions/:phone` lalu pairing ulang
- Cek kualitas internet server

### "Session belum terhubung" saat kirim pesan

1. Cek status session via `GET /api/sessions`
2. Jika `connected: false` tapi `registered: true`, tunggu auto-reconnect
3. Jika `registered: false`, lakukan pairing ulang

### Error: `Connection Closed`

Ini adalah error Baileys yang umum terjadi saat:
- Koneksi internet tidak stabil
- WhatsApp mengirim ulang kode pairing
- Solusi: Coba lagi (endpoint sudah memiliki retry 3x otomatis)

### Docker: port 3000 sudah dipakai

Ubah port di `docker-compose.yml`:
```yaml
environment:
 - PORT=3001
```
Lalu akses di `http://localhost:3001`.

### Log tidak muncul di dashboard

- SSE membutuhkan `proxy_buffering off` jika di belakang Nginx
- Cek koneksi EventSource di browser console
- Pastikan token valid

---

## License

ISC

## Support

- GitHub Issues: [https://github.com/...](https://github.com/...)
- Dokumentasi: [https://hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs)
