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

Health check: `GET /health`. Handler penuh terdaftar di `POST /agent`. Di local mode, set `AGENT_GAMES_HMAC_SECRET`; sebelum menggunakannya, cocokkan algoritma, encoding, dan apakah secret dashboard dipakai sebagai teks atau decoded bytes.

## Menyelesaikan integrasi

Ikuti [ADAPTER.md](./ADAPTER.md) untuk membuat adapter privat yang memverifikasi proof masuk dan public inputs on-chain, menyusun witness sesuai schema resmi, menghasilkan Groth16 proof memakai artifact di `circuits/`, dan menunggu finalisasi zkVerify. Server gagal tertutup jika adapter tidak ada atau tidak lengkap. Jangan masukkan kredensial dalam source control.

## Perilaku rules lokal

Aturan jebakan yang diketahui: `VK_SUBSTITUTION`, `THRESHOLD_MISMATCH`, `PROOF_REUSED`, `EXPIRED_CONDITION`, `RECIPIENT_MISMATCH`, `AMOUNT_OVERFLOW`; valid candidate menjadi `VALID_CONDITION`. `INVALID_TASK`, `INVALID_PROOF`, dan `PROOF_UNVERIFIED` pada kode adalah penanda lokal—enum lengkapnya tidak dicantumkan pada sumber resmi, jadi konfirmasikan sebelum kompetisi. Urutan ini dipakai untuk memilih satu reason saat beberapa kondisi gagal, tetapi urutan precedence tidak dispesifikasikan resmi. Batas expiry memakai `current_block > expiry_block`; perlakuan nilai sama juga perlu konfirmasi.
