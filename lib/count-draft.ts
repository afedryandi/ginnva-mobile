import * as FileSystem from 'expo-file-system/legacy';

/**
 * Draf hitung stok (layar Hitung Bahan Baku / Barang Habis Pakai) yang disimpan di perangkat sampai hasilnya dikirim.
 *
 * Hasil hitung yang sudah diisi tidak boleh hilang hanya karena aplikasi tertutup (ditutup pengguna, dimatikan sistem karena memori, atau
 * keluar dari layar). Daftar disimpan sebagai satu berkas JSON per akun dan jenis (bahan baku atau barang habis pakai), jadi akun lain di
 * perangkat yang sama tidak melihat hitungan orang lain. Draf kedaluwarsa setelah beberapa hari supaya hitungan basi tidak terbawa, dan
 * dihapus setelah berhasil dikirim. Semua operasi aman: kegagalan baca atau tulis tidak pernah merusak layar (dianggap tidak ada draf).
 */

export type CountKind = 'materials' | 'consumables' | 'rolls';

export interface DraftRow {
  id: number;
  name: string;
  unit: string;
  counted: string;
  note: string;
}

export interface CountDraft {
  v: 1;
  ownerId: number;
  kind: CountKind;
  storeId: number | null;
  rows: DraftRow[];
  savedAt: number;
}

/** Draf yang lebih tua dari ini dibuang saat dibuka. */
export const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function uriFor(ownerId: number, kind: CountKind): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}stock-count-draft-${kind}-${ownerId}.json` : null;
}

export async function clearCountDraft(ownerId: number, kind: CountKind): Promise<void> {
  const uri = uriFor(ownerId, kind);
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Tidak ada yang perlu dilakukan: draf tertinggal akan kedaluwarsa sendiri.
  }
}

/** Simpan draf; daftar kosong berarti tidak ada yang perlu disimpan, jadi berkasnya dihapus. */
export async function saveCountDraft(draft: Omit<CountDraft, 'v' | 'savedAt'>): Promise<void> {
  if (draft.rows.length === 0) {
    await clearCountDraft(draft.ownerId, draft.kind);
    return;
  }
  const uri = uriFor(draft.ownerId, draft.kind);
  if (!uri) return;
  try {
    const body: CountDraft = { v: 1, savedAt: Date.now(), ...draft };
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(body));
  } catch {
    // Gagal menyimpan tidak boleh mengganggu penghitungan.
  }
}

/** Muat draf milik akun ini; null bila tidak ada, rusak, milik akun lain, atau sudah kedaluwarsa (yang kedaluwarsa dihapus). */
export async function loadCountDraft(ownerId: number, kind: CountKind): Promise<CountDraft | null> {
  const uri = uriFor(ownerId, kind);
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;

    const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as Partial<CountDraft>;
    const valid =
      parsed.v === 1 &&
      parsed.ownerId === ownerId &&
      parsed.kind === kind &&
      Array.isArray(parsed.rows) &&
      typeof parsed.savedAt === 'number';

    if (!valid || Date.now() - (parsed.savedAt as number) > DRAFT_MAX_AGE_MS) {
      await clearCountDraft(ownerId, kind);
      return null;
    }

    const rows = (parsed.rows as DraftRow[]).filter((r) => typeof r?.id === 'number' && typeof r.name === 'string');

    return { v: 1, ownerId, kind, storeId: typeof parsed.storeId === 'number' ? parsed.storeId : null, rows, savedAt: parsed.savedAt as number };
  } catch {
    return null;
  }
}

/** Gabungkan baris draf dengan baris yang sudah ada di layar (mis. hasil scan yang baru tiba): draf lebih dulu, tanpa duplikat. */
export function mergeDraftRows(draftRows: DraftRow[], current: DraftRow[]): DraftRow[] {
  const known = new Set(draftRows.map((r) => r.id));
  return [...draftRows, ...current.filter((r) => !known.has(r.id))];
}
