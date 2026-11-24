/**
 * Isian jam "HH:MM" (2026-11-18): titik dua ditambahkan otomatis, dan jam yang mustahil ditandai merah.
 */

export const INVALID_TIME_MESSAGE = 'Jam tidak valid (00:00–23:59).';

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Pengguna cukup mengetik angka: "0830" menjadi "08:30", dan titik dua muncul begitu dua angka pertama terketik. Saat menghapus, titik dua ikut
 * terhapus bersama angka di belakangnya, sehingga mundur tidak tersangkut. Nilainya tidak dibatasi di sini; jam yang mustahil (mis. 25:00) tetap
 * terketik dan ditandai lewat isInvalidTime().
 *
 * @param next nilai baru dari kolom isian
 * @param prev nilai sebelumnya (untuk mengenali penghapusan)
 */
export function formatTimeInput(next: string, prev = ''): string {
  const digits = next.replace(/\D/g, '').slice(0, 4);
  const deleting = next.length < prev.length;

  if (digits.length < 2 || (digits.length === 2 && deleting)) {
    return digits;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** Jam sudah lengkap (HH:MM) tetapi mustahil, mis. 24:00, 25:00, atau 10:75. Isian yang belum lengkap tidak dianggap salah. */
export function isInvalidTime(value: string): boolean {
  const v = value.trim();

  return v.length === 5 && !TIME_FORMAT.test(v);
}
