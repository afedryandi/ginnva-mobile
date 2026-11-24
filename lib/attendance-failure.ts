import * as storage from './storage';
import { staffApiFetch, ApiError } from './staff-api';

/**
 * Laporan kegagalan absen ke server (2026-11-11). Kegagalan di HP (GPS timeout, izin ditolak, jaringan putus) tidak pernah sampai ke server,
 * jadi tanpa laporan ini pertanyaan "kenapa gagal absen" hanya bisa ditebak. Yang dikirim hanya jenis kegagalan, tahap, kode HTTP, dan pesan
 * singkat: tanpa koordinat dan tanpa foto. Sifatnya "kirim dan lupakan": tidak pernah menghambat atau menggagalkan alur absen.
 *
 * Bila pengiriman gagal (misalnya karena jaringan sedang putus), laporan disimpan di HP (maksimal 10) dan dikirim saat layar Absensi
 * berhasil memuat data berikutnya (flushPendingAttendanceFailures).
 */
export type AttendanceFailureReason =
  | 'location_permission'
  | 'gps_timeout'
  | 'location_error'
  | 'camera_permission'
  | 'camera_error'
  | 'request_timeout'
  | 'network_error'
  | 'server_rejected'
  | 'unknown';

export interface AttendanceFailure {
  action: 'clock_in' | 'clock_out';
  stage: 'locating' | 'camera' | 'sending';
  reason: AttendanceFailureReason;
  http_status?: number;
  message?: string;
  occurred_at?: string;
}

const PENDING_KEY = 'ginnva_attendance_failures_pending';
const MAX_PENDING = 10;

async function send(failure: AttendanceFailure): Promise<void> {
  await staffApiFetch('/api/staff/attendance/client-failure', {
    method: 'POST',
    body: JSON.stringify(failure),
  });
}

async function readPending(): Promise<AttendanceFailure[]> {
  try {
    const raw = await storage.getItem(PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writePending(list: AttendanceFailure[]): Promise<void> {
  try {
    if (list.length === 0) await storage.deleteItem(PENDING_KEY);
    else await storage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    // Penyimpanan gagal: laporan ini dilepas saja.
  }
}

/** Kirim satu laporan; bila gagal terkirim, simpan untuk dicoba lagi nanti. Tidak pernah melempar error. */
export function reportAttendanceFailure(failure: AttendanceFailure): void {
  const withTime: AttendanceFailure = {
    ...failure,
    message: failure.message?.slice(0, 200),
    occurred_at: failure.occurred_at ?? new Date().toISOString(),
  };

  send(withTime).catch(async () => {
    const pending = await readPending();
    await writePending([...pending, withTime]);
  });
}

/** Kirim laporan yang tertunda. Dipanggil setelah layar Absensi berhasil memuat data (berarti jaringan hidup). */
export async function flushPendingAttendanceFailures(): Promise<void> {
  const pending = await readPending();
  if (pending.length === 0) return;

  const unsent: AttendanceFailure[] = [];
  for (const failure of pending) {
    try {
      await send(failure);
    } catch (err) {
      // Ditolak server karena isinya tidak valid: buang. Selain itu (jaringan) simpan lagi.
      if (!(err instanceof ApiError && err.status >= 400 && err.status < 500)) unsent.push(failure);
    }
  }
  await writePending(unsent);
}

/** Terjemahkan error pengiriman absen menjadi kode kegagalan untuk laporan. */
export function failureFromError(err: unknown): Pick<AttendanceFailure, 'reason' | 'http_status' | 'message'> {
  if (err instanceof ApiError) {
    if (err.status === 0) return { reason: 'request_timeout', message: err.message };
    return { reason: 'server_rejected', http_status: err.status, message: err.message };
  }
  return { reason: 'network_error', message: err instanceof Error ? err.message : undefined };
}

/** Kode kegagalan menurut tahap yang sedang berjalan saat error dilempar (tahap kirim memakai failureFromError). */
export function failureFromStage(
  stage: AttendanceFailure['stage'],
  err: unknown,
): Pick<AttendanceFailure, 'reason' | 'http_status' | 'message'> {
  if (stage === 'sending') return failureFromError(err);
  const message = err instanceof Error ? err.message : undefined;
  return { reason: stage === 'camera' ? 'camera_error' : 'location_error', message };
}
