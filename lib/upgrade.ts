// Pemaksaan pembaruan aplikasi (Fase 0 pengerjaan ulang booking, 2026-10-14).
// Kalau server menjawab 426 (versi aplikasi di bawah versi minimum), apiFetch/staffApiFetch memanggil
// notifyUpgradeRequired() dan layar pemblokir (components/UpgradeRequiredModal.tsx) tampil di atas semua layar.

export interface UpgradeInfo {
  message: string;
  storeUrl: string | null;
  minVersion: string | null;
}

type Listener = (info: UpgradeInfo) => void;

const listeners = new Set<Listener>();

export function onUpgradeRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyUpgradeRequired(json: any): void {
  const info: UpgradeInfo = {
    message: json?.message || 'Versi aplikasi sudah terlalu lama. Perbarui aplikasi untuk melanjutkan.',
    storeUrl: json?.store_url ?? null,
    minVersion: json?.min_version ?? null,
  };

  listeners.forEach((listener) => listener(info));
}
