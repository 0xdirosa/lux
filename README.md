# Proof Gatekeeper — starter aman

Starter Node.js untuk track Proof Gatekeeper Agent Games. Proyek ini memuat endpoint `/agent`, pemeriksaan HMAC terhadap byte request mentah, responder preflight bertanda tangan, aturan jebakan deterministik yang dipublikasikan, penyimpanan idempotensi, dan artifact circuit resmi.

## Status

**Belum siap didaftarkan sebagai endpoint kompetisi.** Dokumentasi Agent Games tidak menetapkan encoding/algoritma HMAC secara eksplisit; tidak menerbitkan schema input circuit (WASM mengharapkan 13 sinyal), public-signal ordering, atau API verifikasi `proof_tx` dan finalisasi. Ada juga contoh response yang tidak selaras dengan keharusan proof pada task provable. Tanpa adapter yang mengisi celah tersebut, endpoint sengaja hanya melayani health/preflight; task akan dijawab `503 NOT_READY`, bukan menyetujui/menolak tanpa bukti. Endpoint publik stabil juga belum dideploy.

Dokumentasi yang menjadi acuan: [build guide](https://agentgames.zkverify.io/build), [rules](https://agentgames.zkverify.io/rules), [event Proof Gatekeeper](https://agentgames.zkverify.io/events/proof-gatekeeper), [circuit-info](https://agentgames.zkverify.io/api/circuit-info). Pada panduan saat ini, HMAC-SHA256/hex pada `.env.example` hanyalah default konvensional untuk development—konfirmasikan format persisnya sebelum aktivasi.

## Menjalankan tes

```bash
npm ci
npm test
cp .env.example .env
# isi secret hanya setelah diterbitkan oleh dashboard Agent Games
npm start
```

Liveness check `GET /health` selalu 200 saat proses hidup, agar hosting dapat memeriksa service sebelum secret disetel. `GET /ready` tetap 503 sampai secret dan adapter tersedia. Handler penuh terdaftar di `POST /agent`. Di local mode, set `AGENT_GAMES_HMAC_SECRET`; sebelum menggunakannya, cocokkan algoritma, digest encoding, key encoding, serta prefix signature dengan format resmi. Opsi encoding disediakan agar format yang dikonfirmasi bisa dipasang tanpa mengubah kode.

### Tes handshake preflight

Setelah ada URL HTTPS endpoint dan HMAC secret, lakukan tes sintetis dari mesin/lingkungan yang menyimpan secret:

```bash
AGENT_GAMES_ENDPOINT_URL=https://host.example/agent npm run check:preflight
```

Skrip mengirim envelope `agent-games.preflight.v1` bertanda tangan, lalu memeriksa HTTP 200, body `{ "ok": true, "protocolVersion": "v1" }`, dan signature pada raw response body. Nilai signature/HMAC tidak dicetak. Tes ini memverifikasi endpoint dengan konfigurasi lokal; **preflight resmi tetap harus dijalankan dari dashboard Agent Games setelah endpoint diregistrasikan dan secret platform dipasang pada host**. Tanpa secret belum ada tes end-to-end resmi yang bisa dijalankan.

## Menyelesaikan integrasi

Ikuti [ADAPTER.md](./ADAPTER.md) untuk membuat adapter privat yang memverifikasi proof masuk dan public inputs on-chain, menyusun witness sesuai schema resmi, menghasilkan Groth16 proof memakai artifact di `circuits/`, dan menunggu finalisasi zkVerify. Server gagal tertutup jika adapter tidak ada atau tidak lengkap. Jangan masukkan kredensial dalam source control.

## Perilaku rules lokal

Aturan jebakan yang diketahui: `VK_SUBSTITUTION`, `THRESHOLD_MISMATCH`, `PROOF_REUSED`, `EXPIRED_CONDITION`, `RECIPIENT_MISMATCH`, `AMOUNT_OVERFLOW`; valid candidate menjadi `VALID_CONDITION`. `INVALID_TASK`, `INVALID_PROOF`, dan `PROOF_UNVERIFIED` pada kode adalah penanda lokal—enum lengkapnya tidak dicantumkan pada sumber resmi, jadi konfirmasikan sebelum kompetisi. Urutan ini dipakai untuk memilih satu reason saat beberapa kondisi gagal, tetapi urutan precedence tidak dispesifikasikan resmi. Batas expiry memakai `current_block > expiry_block`; perlakuan nilai sama juga perlu konfirmasi.
