# Adapter Gatekeeper: kontrak lokal, bukan format resmi platform

Dokumentasi publik Agent Games yang diperiksa tidak menerbitkan format API untuk memverifikasi `proof_tx`, skema witness Circom, susunan 13 public signals, atau polling status Kurier hingga `Finalized`. Karena itu server ini tidak mengarang implementasinya. Implementasi kompetisi perlu adapter privat sesuai antarmuka di bawah setelah detail resminya dikonfirmasi.

Isi file CommonJS privat, lalu set `AGENT_GAMES_ADAPTER=/absolute/path/to/adapter.js`. Jangan commit adapter jika memuat credential.

```js
module.exports = {
  // Cari proof_tx jaringan, cocokkan VK & public inputs, dan pastikan finalized.
  async verifyIncomingProof(task) {
    // Return: { verified: true, finalized: true, publicInputsMatch: true }
    // Return false/throw untuk hasil tidak pasti. Server akan fail closed.
  },

  // Bangun object input Circom berdasarkan schema resmi circuit.
  async buildCircuitInputs(task, decision) {
    // Return object input untuk gatekeeper.wasm/gatekeeper_final.zkey.
    // Nama input, encoding alamat/VK, serta pemetaan task belum diterbitkan.
  },

  // Kirim proof agent ke zkVerify dan tunggu Finalized bila diwajibkan.
  async submitAgentProof({ proof, publicSignals, task, decision }) {
    // Return { finalized: true, proof_tx?: "0x…" }.
  }
};
```

Syarat aman server: approval hanya jika `verifyIncomingProof` memastikan seluruh kondisi proof dan finalisasi; setiap keputusan harus memiliki `proof` dan `public_signals` yang dihasilkan dari artifact resmi; bila hasil adapter gagal/tidak pasti, handler gagal tertutup. Adapter harus menyimpan API key hanya lewat secret manager/environment, tidak menulisnya ke log.
