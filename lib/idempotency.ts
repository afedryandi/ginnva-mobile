// Kunci idempotensi untuk tindakan yang tidak boleh terjadi dua kali (Fase 0 pengerjaan ulang booking, 2026-10-14).
//
// Pola pemakaian di layar kirim: simpan SATU "dasar" per percobaan di useRef (idempotencyBase()), lalu kirim
// header 'Idempotency-Key': idempotencyKeyFor(dasar, isiPermintaan). Kiriman ulang dengan isi yang sama (jaringan putus,
// ketukan ganda) memakai kunci yang sama, sehingga server mengembalikan hasil asli, bukan membuat dua kali. Kalau
// pengguna mengubah isian, kunci ikut berubah otomatis. Setelah sukses, kosongkan dasar supaya tindakan berikutnya
// memakai kunci baru.

export function idempotencyBase(): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  const c: any = (globalThis as any).crypto;

  if (c && typeof c.randomUUID === 'function') {
    return String(c.randomUUID()).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  }

  return `${Date.now().toString(36)}${random()}${random()}`.slice(0, 24);
}

// Hash 32-bit sederhana (djb2) — cukup untuk membedakan isi permintaan; bukan untuk keamanan.
function shortHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function idempotencyKeyFor(base: string, payload: unknown): string {
  return `${base}-${shortHash(JSON.stringify(payload))}`;
}
