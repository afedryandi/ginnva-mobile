import { apiFetch } from './api';

// Kendaraan Saya + katalog kendaraan + katalog layanan booking (Fase 1 pengerjaan ulang booking, 2026-10-15).
// Endpoint: GET/POST/PUT/DELETE /api/customer/vehicles, GET /api/vehicles/catalog, GET /api/booking/services.

export type VehicleSize = 'S' | 'M' | 'L' | 'XL' | 'XXL';

export const VEHICLE_SIZES: VehicleSize[] = ['S', 'M', 'L', 'XL', 'XXL'];

export const VEHICLE_SIZE_HINTS: Record<VehicleSize, string> = {
  S: 'Kecil (city car)',
  M: 'Sedang (hatchback/sedan)',
  L: 'Besar (SUV/MPV)',
  XL: 'Sangat besar',
  XXL: 'Ekstra besar',
};

export interface CustomerVehicle {
  id: number;
  vehicle_id: number | null;
  brand: string;
  model: string;
  variant: string | null;
  label: string;
  plate: string;
  year: number | null;
  color: string | null;
  size_category: VehicleSize | null;
  vin: string | null;
  is_default: boolean;
}

export interface CatalogVehicle {
  id: number;
  brand: string;
  model: string;
  variant: string | null;
  size_category: VehicleSize | null;
}

export interface VehicleCatalog {
  brands: string[];
  vehicles: CatalogVehicle[];
}

export interface VehicleInput {
  vehicle_id?: number | null;
  brand?: string;
  model?: string;
  variant?: string | null;
  plate: string;
  year?: number | null;
  color?: string | null;
  size_category?: VehicleSize | null;
  is_default?: boolean;
}

export type ServiceKey = 'kaca_film' | 'ppf' | 'detailing' | 'premium_wash';

export interface ServicePrice {
  type: 'fixed' | 'from' | 'unavailable';
  amount: number | null;
  label: string;
}

export interface BookingService {
  key: ServiceKey;
  label: string;
  description: string;
  capacity_category: 'berat' | 'ringan';
  estimated_duration_days: number;
  // Harga tidak ditampilkan ke pelanggan (keputusan pemilik 2026-10-15): server mengirim null kecuali BOOKING_SHOW_PRICES aktif.
  price: ServicePrice | null;
}

export async function fetchVehicles(): Promise<CustomerVehicle[]> {
  const res = await apiFetch<{ data: CustomerVehicle[] }>('/api/customer/vehicles');
  return res.data;
}

export async function fetchVehicleCatalog(): Promise<VehicleCatalog> {
  const res = await apiFetch<{ data: VehicleCatalog }>('/api/vehicles/catalog', { skipAuth: true });
  return res.data;
}

export async function saveVehicle(input: VehicleInput, id?: number): Promise<CustomerVehicle> {
  const res = await apiFetch<{ data: CustomerVehicle }>(id ? `/api/customer/vehicles/${id}` : '/api/customer/vehicles', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function deleteVehicle(id: number): Promise<void> {
  await apiFetch(`/api/customer/vehicles/${id}`, { method: 'DELETE' });
}

export interface BookingCatalog {
  services: BookingService[];
  // Teks kebijakan pembatalan yang diedit admin (Fase 4); null di server lama.
  cancellation_policy: string | null;
  // Pemberitahuan privasi + versinya (Fase 5); null di server lama.
  privacy_notice: { text: string; version: string } | null;
  // Lama pemasangan PPF Interior (hari), menambah Eksterior bila keduanya dipilih; server lama tidak mengirimnya (dianggap 1).
  ppf_interior_days: number;
}

export async function fetchBookingCatalog(vehicleSize?: VehicleSize | null): Promise<BookingCatalog> {
  const query = vehicleSize ? `?vehicle_size=${vehicleSize}` : '';
  const res = await apiFetch<{ data: { services: BookingService[]; cancellation_policy?: string | null; privacy_notice?: { text: string; version: string } | null; ppf_interior_days?: number } }>(`/api/booking/services${query}`, { skipAuth: true });
  return { services: res.data.services, cancellation_policy: res.data.cancellation_policy ?? null, privacy_notice: res.data.privacy_notice ?? null, ppf_interior_days: res.data.ppf_interior_days ?? 1 };
}

export async function fetchBookingServices(vehicleSize?: VehicleSize | null): Promise<BookingService[]> {
  return (await fetchBookingCatalog(vehicleSize)).services;
}

// Huruf besar, hanya huruf/angka/spasi. Server menormalkan lagi (termasuk membuang tanda baca).
export function normalizePlateInput(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s{2,}/g, ' ');
}

// Label singkat kendaraan untuk ringkasan, mis. "Toyota Fortuner VRZ · B 1234 ABC".
export function vehicleSummary(vehicle: Pick<CustomerVehicle, 'label' | 'plate'>): string {
  return `${vehicle.label} · ${vehicle.plate}`;
}
