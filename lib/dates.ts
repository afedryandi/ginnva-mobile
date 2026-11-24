/**
 * Parse tanggal polos "YYYY-MM-DD" sebagai tanggal LOKAL (bukan tengah malam
 * UTC). new Date('2026-10-05') adalah 05 Okt 00:00 UTC, yang bagi pengguna di
 * zona barat UTC tampil sebagai 04 Okt. Nilai lain (ISO dengan jam) diparse
 * biasa.
 */
export function parseDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

/**
 * Tanggal LOKAL perangkat sebagai "YYYY-MM-DD". Jangan pakai toISOString().slice(0, 10): itu tanggal UTC, jadi di WIB
 * (UTC+7) antara pukul 00.00 dan 06.59 hasilnya mundur sehari (izin/koreksi absen/jadwal salah hari).
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
