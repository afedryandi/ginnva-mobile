import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { AuthNotice } from '@/components/auth/AuthShell';
import DateGrid from '@/components/ui/DateGrid';
import VehicleFormModal from '@/components/VehicleFormModal';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useFadeIn } from '@/lib/useFadeIn';
import { hapticLight, hapticSuccess, hapticError } from '@/lib/haptics';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { idempotencyBase, idempotencyKeyFor } from '@/lib/idempotency';
import {
  BookingService,
  CustomerVehicle,
  fetchBookingCatalog,
  fetchVehicleCatalog,
  fetchVehicles,
  ServiceKey,
  VehicleCatalog,
} from '@/lib/vehicles';

interface OpeningHoursRow {
  days: string[];
  closed?: boolean;
}

interface StoreOption {
  id: number;
  name: string;
  city: string;
  opening_hours: OpeningHoursRow[] | null;
}

// Sama persis dengan Store::DAYS di ginnva-api (app/Models/Store.php) —
// index array ini HARUS cocok dengan Date.getDay() JS (0=Minggu).
const JS_DAY_TO_CODE = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Slot jam kunjungan generik untuk semua toko — slot terakhir berhenti jam
// 17:00 supaya ada buffer 1 jam sebelum tutup untuk penyelesaian
// pemasangan/beres-beres. Hari yang toko-nya tutup (lihat closedWeekdays)
// tetap dinonaktifkan di pemilihan TANGGAL, jadi slot jam ini tidak perlu
// tahu-menahu soal hari buka/tutup per toko.
const TIME_SLOTS = [
  '09:00 - 11:00',
  '11:00 - 13:00',
  '13:00 - 15:00',
  '15:00 - 17:00',
];

// Daftar cadangan kalau katalog layanan gagal dimuat (tanpa harga): booking tetap bisa dikirim.
const FALLBACK_SERVICES: BookingService[] = [
  { key: 'kaca_film', label: 'Kaca Film (Window Film)', description: 'Kaca film untuk kenyamanan, privasi, dan penolak panas.', capacity_category: 'berat', estimated_duration_days: 1, price: null },
  { key: 'ppf', label: 'Pelindung Cat (PPF)', description: 'Lapisan pelindung cat dari baret, goresan halus, dan batu kerikil.', capacity_category: 'berat', estimated_duration_days: 3, price: null },
  { key: 'detailing', label: 'Detailing', description: 'Perawatan menyeluruh interior dan eksterior.', capacity_category: 'ringan', estimated_duration_days: 1, price: null },
  { key: 'premium_wash', label: 'Premium Wash', description: 'Cuci premium dengan perawatan detail.', capacity_category: 'ringan', estimated_duration_days: 1, price: null },
];

// Detailing dan Premium Wash: berdiri sendiri bila tanpa Kaca Film/PPF; menjadi layanan tambahan di bawah Kaca Film bila Kaca Film dipilih;
// dihilangkan bila PPF dipilih karena PPF sudah termasuk keduanya (2026-11-24).
const ADDON_KEYS: ServiceKey[] = ['detailing', 'premium_wash'];

// "Lainnya" (permintaan di luar empat layanan di atas) tetap lewat jalur lama: catatan wajib, tanpa kunci layanan.
const OTHER_LABEL = 'Lainnya';

// toISOString() konversi ke UTC — antara jam 00:00-06:59 WIB, tanggal UTC
// masih "kemarin", jadi value yang dikirim ke backend beda 1 hari dari
// tanggal yang ditampilkan (toLocaleDateString, benar pakai kalender
// lokal). Backend validasi "after_or_equal:today" pakai APP_TIMEZONE
// Asia/Jakarta, jadi value yang mundur 1 hari itu ditolak — padahal user
// merasa sudah pilih "Hari ini". Format manual dari komponen tanggal
// lokal supaya tidak pernah lewat konversi UTC sama sekali.
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Generate 30 hari ke depan sebagai pilihan tanggal — MULAI DARI HARI INI
// (i=0), bukan besok, supaya customer yang mau booking untuk hari yang
// sama (kalau slot masih tersedia) tetap bisa pilih.
function generateDateOptions(): { label: string; value: string; day: string; date: string; dow: string }[] {
  const options = [];
  const today = new Date();
  for (let i = 0; i <= 29; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = toLocalDateString(d);
    const day = i === 0 ? 'Hari ini' : d.toLocaleDateString('id-ID', { weekday: 'short' });
    const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    const dow = JS_DAY_TO_CODE[d.getDay()];
    options.push({ label: `${day} ${date}`, value, day, date, dow });
  }
  return options;
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Phase = 'form' | 'submitting' | 'success';
type Step = 0 | 1 | 2 | 3 | 4;

const STEP_TITLES = ['Toko', 'Kendaraan', 'Layanan', 'Jadwal', 'Ringkasan'];
const TOTAL_STEPS = STEP_TITLES.length;

export default function BookingScreen() {
  // Dihitung tiap render (bukan sekali saat modul dimuat) supaya "Hari ini"
  // tidak basi kalau app dibiarkan hidup lewat tengah malam.
  const DATE_OPTIONS = generateDateOptions();
  const params = useLocalSearchParams<{ store_id?: string; store_name?: string }>();
  const { isLoggedIn } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const successOpacity = useFadeIn(400);

  const [phase, setPhase] = useState<Phase>('form');
  // Toko yang sudah dipilih dari layar sebelumnya (tab Toko) melewati langkah pertama.
  const [stepIndex, setStepIndex] = useState<Step>(params.store_id ? 1 : 0);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState(false);
  const [storesReload, setStoresReload] = useState(0);

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(
    params.store_id ? Number(params.store_id) : null
  );
  const [selectedStoreName, setSelectedStoreName] = useState<string>(
    params.store_name ?? ''
  );
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [fullDates, setFullDates] = useState<string[]>([]);
  const [limitedDates, setLimitedDates] = useState<string[]>([]);
  const [lightFullDates, setLightFullDates] = useState<string[]>([]);
  const [lightSlots, setLightSlots] = useState<{ slot: string; available: boolean }[] | null>(null);
  const [lightSlotsLoading, setLightSlotsLoading] = useState(false);
  const [lightSlotsReload, setLightSlotsReload] = useState(0);
  const [datesLoading, setDatesLoading] = useState(false);
  const [datesError, setDatesError] = useState(false);
  const [datesReload, setDatesReload] = useState(0);

  // Kendaraan Saya (langkah 2) dan katalog layanan (langkah 3).
  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState(false);
  const [vehiclesReload, setVehiclesReload] = useState(0);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [vehicleFormVisible, setVehicleFormVisible] = useState(false);
  const [catalog, setCatalog] = useState<VehicleCatalog | null>(null);
  const [services, setServices] = useState<BookingService[]>(FALLBACK_SERVICES);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [cancellationPolicy, setCancellationPolicy] = useState<string | null>(null);
  const [privacyNotice, setPrivacyNotice] = useState<string | null>(null);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  // Area pemasangan PPF: Eksterior dan Interior boleh dipilih bersamaan. Keduanya kosong saat PPF dicentang; pelanggan memilih sendiri (2026-11-24).
  const [ppfExterior, setPpfExterior] = useState(false);
  const [ppfInterior, setPpfInterior] = useState(false);
  const [ppfInteriorDays, setPpfInteriorDays] = useState(1);

  // Hari yang di-set "Libur" di jam operasional toko yang dipilih (lihat
  // fitur Jam Operasional per-toko di Filament) — dipakai buat nonaktifkan
  // opsi tanggal yang jatuh di hari itu, supaya customer tidak bisa pilih
  // hari toko sedang tutup (mis. Minggu). Dihitung ulang tiap toko yang
  // dipilih berubah, BUKAN di-hardcode ke satu hari tertentu, karena tiap
  // toko bisa punya jam operasional & hari libur berbeda-beda.
  const closedWeekdays = useMemo(() => {
    const store = stores.find((s) => s.id === selectedStoreId);
    const closed = new Set<string>();
    (store?.opening_hours ?? []).forEach((row) => {
      // Guard row.days — baris "closed" bisa saja tidak punya array days
      // kalau datanya diedit di luar form Filament (langsung ke DB), jadi
      // tidak boleh diasumsikan selalu ada seperti sisi backend yang
      // sudah pakai fallback ?? [].
      if (row.closed) (row.days ?? []).forEach((d) => closed.add(d));
    });
    return closed;
  }, [stores, selectedStoreId]);
  // Empat layanan boleh dipilih bersamaan (progres tahap berjalan paralel); "Lainnya" saling eksklusif dengan semuanya.
  const [selectedKeys, setSelectedKeys] = useState<ServiceKey[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [notes, setNotes] = useState('');
  const [notesFocused, setNotesFocused] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingNumber, setBookingNumber] = useState('');

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) ?? null;

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login' as never);
      return;
    }
    setStoresLoading(true);
    setStoresError(false);
    apiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => {
        // Ginnva House ditaruh paling atas (diminta user 2026-09-25, sama
        // perubahan di ginnva-web/app/dealers & tab Toko) — sisa urutan
        // dari API tetap dipertahankan (stable sort).
        const sorted = [...res.data].sort((a, b) => {
          const aIsDefault = a.name === 'Ginnva House';
          const bIsDefault = b.name === 'Ginnva House';
          if (aIsDefault === bIsDefault) return 0;
          return aIsDefault ? -1 : 1;
        });
        setStores(sorted);
      })
      .catch(() => setStoresError(true))
      .finally(() => setStoresLoading(false));
  }, [isLoggedIn, storesReload]);

  // Kendaraan Saya: dimuat saat layar dibuka (dan setelah menambah kendaraan). Kendaraan utama (atau satu-satunya)
  // terpilih otomatis supaya pelanggan langsung bisa lanjut.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    setVehiclesLoading(true);
    setVehiclesError(false);
    fetchVehicles()
      .then((list) => {
        if (cancelled) return;
        setVehicles(list);
        setSelectedVehicleId((current) => {
          if (current && list.some((v) => v.id === current)) return current;
          return (list.find((v) => v.is_default) ?? (list.length === 1 ? list[0] : null))?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setVehiclesError(true);
      })
      .finally(() => {
        if (!cancelled) setVehiclesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, vehiclesReload]);

  // Katalog merek/model hanya dimuat saat formulir kendaraan pertama kali dibuka.
  const openVehicleForm = useCallback(() => {
    if (!catalog) {
      fetchVehicleCatalog().then(setCatalog).catch(() => setCatalog({ brands: [], vehicles: [] }));
    }
    setVehicleFormVisible(true);
  }, [catalog]);

  // Katalog layanan (nama, deskripsi, lama pengerjaan) dimuat sekali. Harga tidak ditampilkan. Gagal dimuat = daftar cadangan.
  useEffect(() => {
    let cancelled = false;
    setServicesLoading(true);
    fetchBookingCatalog()
      .then((catalog) => {
        if (cancelled) return;
        if (catalog.services.length > 0) setServices(catalog.services);
        setCancellationPolicy(catalog.cancellation_policy);
        setPpfInteriorDays(catalog.ppf_interior_days ?? 1);
        setPrivacyNotice(catalog.privacy_notice?.text ?? null);
      })
      .catch(() => {
        if (!cancelled) setServices(FALLBACK_SERVICES);
      })
      .finally(() => {
        if (!cancelled) setServicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lama pengerjaan sebuah layanan. PPF mengikuti area: Eksterior memakai lama layanannya, Interior 1 hari, keduanya dijumlahkan.
  const serviceDays = (s: BookingService) =>
    // Interior tidak menambah hari kerja pada Eksterior (2026-11-24): bila Eksterior ikut dipilih, lamanya sama dengan Eksterior saja.
    s.key === 'ppf' ? (ppfExterior || !ppfInterior ? s.estimated_duration_days : ppfInteriorDays) : s.estimated_duration_days;

  // Lama pengerjaan layanan berat yang dipilih: tanggal mulai dianggap penuh bila hari lanjutannya penuh (server menghitungnya).
  const spanDays = Math.max(
    1,
    ...services.filter((s) => selectedKeys.includes(s.key) && s.capacity_category !== 'ringan').map(serviceDays),
  );

  // Ketersediaan tanggal toko terpilih (diblokir + penuh). Hasil dari toko
  // LAMA dibuang kalau toko sudah berganti, dan kegagalan tidak lagi diam-diam:
  // tanggal dikunci selama memuat dan ada tombol Coba Lagi (2026-10-05).
  useEffect(() => {
    if (!selectedStoreId) return;
    let cancelled = false;
    setDatesLoading(true);
    setDatesError(false);
    Promise.all([
      apiFetch<{ data: string[] }>(`/api/stores/${selectedStoreId}/blocked-dates`, { skipAuth: true }),
      // Tanggal yang kapasitas tokonya sudah penuh (hanya booking confirmed
      // yang dihitung) -- dinonaktifkan di pemilih tanggal.
      apiFetch<{ data: string[] }>(`/api/stores/${selectedStoreId}/full-dates?duration_days=${spanDays}`, { skipAuth: true }),
      // Penanda "hampir penuh" hanya informasi tambahan: kegagalannya tidak boleh menggagalkan pemilih tanggal.
      apiFetch<{ data: string[] }>(`/api/stores/${selectedStoreId}/limited-dates`, { skipAuth: true }).catch(() => ({ data: [] as string[] })),
      // Layanan ringan: tanggal yang semua slot jamnya penuh (kapasitas terpisah dari layanan berat).
      apiFetch<{ data: string[] }>(`/api/stores/${selectedStoreId}/light-full-dates`, { skipAuth: true }).catch(() => ({ data: [] as string[] })),
    ])
      .then(([blocked, full, limitedRes, lightFull]) => {
        if (cancelled) return;
        setBlockedDates(blocked.data);
        setFullDates(full.data);
        setLimitedDates(limitedRes.data);
        setLightFullDates(lightFull.data);
      })
      .catch(() => {
        if (!cancelled) setDatesError(true);
      })
      .finally(() => {
        if (!cancelled) setDatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStoreId, datesReload, spanDays]);

  const selectStore = (id: number, name: string) => {
    setSelectedStoreId(id);
    setSelectedStoreName(name);
    setPreferredDate('');
    setBlockedDates([]);
    setFullDates([]);
    setLimitedDates([]);
    setLightFullDates([]);
  };

  const toggleService = (key: ServiceKey) => {
    hapticLight();
    setOtherSelected(false);
    // PPF baru dicentang: area dikosongkan, pelanggan memilih sendiri Eksterior, Interior, atau keduanya.
    if (key === 'ppf' && !selectedKeys.includes('ppf')) {
      setPpfExterior(false);
      setPpfInterior(false);
    }
    // PPF sudah termasuk Detailing dan Premium Wash: keduanya dilepas dari pilihan saat PPF dicentang.
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return key === 'ppf' ? [...prev.filter((k) => !ADDON_KEYS.includes(k)), key] : [...prev, key];
    });
  };

  const toggleOther = () => {
    hapticLight();
    setSelectedKeys([]);
    setOtherSelected((v) => !v);
  };

  const chosenServices = services.filter((s) => selectedKeys.includes(s.key));
  // Hanya layanan ringan (Detailing/Premium Wash): jam kedatangan wajib dan kapasitasnya per slot jam.
  const isLight = !otherSelected && chosenServices.length > 0 && chosenServices.every((s) => s.capacity_category === 'ringan');
  const estimateDays = chosenServices.reduce((max, s) => Math.max(max, serviceDays(s)), 0);

  useEffect(() => {
    if (!isLight || !selectedStoreId || !preferredDate) {
      setLightSlots(null);
      return;
    }
    let cancelled = false;
    setLightSlotsLoading(true);
    apiFetch<{ data: { slots: { slot: string; available: boolean }[] } }>(
      `/api/stores/${selectedStoreId}/light-slots?date=${preferredDate}`,
      { skipAuth: true },
    )
      .then((res) => {
        if (cancelled) return;
        setLightSlots(res.data.slots);
        setPreferredTime((t) => (res.data.slots.some((x) => x.slot === t && x.available) ? t : ''));
      })
      .catch(() => {
        if (!cancelled) setLightSlots(null);
      })
      .finally(() => {
        if (!cancelled) setLightSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLight, selectedStoreId, preferredDate, lightSlotsReload]);

  const stepValid = [
    selectedStoreId !== null,
    selectedVehicleId !== null,
    (selectedKeys.length > 0 || otherSelected) && (!selectedKeys.includes('ppf') || ppfExterior || ppfInterior),
    preferredDate.length > 0 && (!isLight || (preferredTime !== '' && lightSlots !== null)),
    // 'Lainnya' wajib dijelaskan lewat catatan (server menolak kalau kosong).
    !(otherSelected && notes.trim().length === 0) && (!privacyNotice || privacyAccepted),
  ];

  const goNext = () => {
    if (!stepValid[stepIndex]) return;
    hapticLight();
    if (stepIndex < TOTAL_STEPS - 1) setStepIndex((s) => (s + 1) as Step);
  };

  const goBack = () => {
    if (stepIndex > 0) setStepIndex((s) => (s - 1) as Step);
  };

  // Kunci idempotensi (Fase 0 pengerjaan ulang booking): satu "dasar" per percobaan, dipakai ulang saat kirim ulang
  // (jaringan putus / ketukan ganda) supaya server mengembalikan booking pertama, bukan membuat dua atau menolak sebagai
  // duplikat. Dikosongkan setelah sukses.
  const submitBase = useRef<string | null>(null);

  const handleSubmit = async () => {
    setPhase('submitting');
    setSubmitError(null);
    try {
      const vehicleLine = selectedVehicle ? `Kendaraan: ${selectedVehicle.label} (${selectedVehicle.plate})` : '';

      // Booking v2 (layanan + kendaraan). "Lainnya" memakai jalur lama (tanpa kunci layanan) dengan data kendaraan di catatan.
      const payload = otherSelected
        ? {
            store_id: selectedStoreId,
            service_type: OTHER_LABEL,
            preferred_date: preferredDate,
            preferred_time: preferredTime || null,
            notes: [vehicleLine, notes.trim()].filter(Boolean).join('\n'),
            privacy_consent: privacyAccepted,
          }
        : {
            store_id: selectedStoreId,
            services: selectedKeys,
            customer_vehicle_id: selectedVehicleId,
            preferred_date: preferredDate,
            preferred_time: preferredTime || null,
            notes: notes.trim() || null,
            privacy_consent: true,
            ...(selectedKeys.includes('ppf') ? { ppf_exterior: ppfExterior, ppf_interior: ppfInterior } : {}),
          };

      if (!submitBase.current) submitBase.current = idempotencyBase();

      const res = await apiFetch<{ success: boolean; data: { booking_number: string } }>(
        '/api/customer/bookings',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKeyFor(submitBase.current, payload) },
          body: JSON.stringify(payload),
        }
      );
      submitBase.current = null;
      setBookingNumber(res.data.booking_number);
      setPhase('success');
      hapticSuccess();
    } catch (err) {
      setPhase('form');
      hapticError();
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Terjadi kesalahan. Periksa koneksi internetmu.'
      );
    }
  };

  const selectedDateLabel = DATE_OPTIONS.find((d) => d.value === preferredDate)?.label ?? '';
  const serviceSummary = otherSelected ? OTHER_LABEL : chosenServices.map((s) => s.label).join(', ');

  // Kerangka bersama: sorotan merah lembut, tombol kembali bulat, dan judul besar. Fungsi biasa (bukan komponen) supaya isi formulir
  // tidak dibangun ulang tiap render.
  const frame = (children: React.ReactNode) => (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />
      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle}>Buat Booking</Text>
      </View>
      {children}
    </SafeAreaView>
  );

  // ===== Success =====
  if (phase === 'success') {
    return frame(
      <Animated.View style={[styles.centerState, { opacity: successOpacity }]}>
        <View style={styles.successRing}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={40} color="#ffffff" />
          </View>
        </View>
        <Text style={styles.successTitle}>Booking diterima!</Text>
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Nomor bookingmu</Text>
          <Text style={styles.successCode} selectable>{bookingNumber}</Text>
        </View>
        <Text style={styles.successNote}>Tim toko akan menghubungimu untuk konfirmasi jadwal.</Text>
        <Button
          label="Lihat Booking Saya"
          onPress={() => router.replace('/account/my-bookings' as never)}
          style={styles.pillButton}
        />
        <Button label="Kembali" variant="ghost" onPress={() => router.back()} style={styles.ghostButton} />
      </Animated.View>
    );
  }

  const hasKaca = selectedKeys.includes('kaca_film');
  const hasPpf = selectedKeys.includes('ppf');

  const SERVICE_ICON: Record<string, IconName> = {
    kaca_film: 'contrast-outline',
    ppf: 'shield-checkmark-outline',
    detailing: 'sparkles-outline',
    premium_wash: 'water-outline',
  };

  return frame(
    <>
      {/* Kemajuan: lima segmen; langkah yang sudah lewat bisa diketuk untuk kembali, yang belum dicapai tidak (validasi tetap terjaga). */}
      <View style={styles.progress}>
        <View style={styles.progressBars}>
          {STEP_TITLES.map((title, i) => (
            <Pressable
              key={title}
              style={styles.progressTouch}
              disabled={i >= stepIndex}
              hitSlop={{ top: 10, bottom: 10 }}
              onPress={() => { hapticLight(); setStepIndex(i as Step); }}
              accessibilityRole="button"
              accessibilityLabel={`Langkah ${i + 1}: ${title}`}
            >
              <View style={[styles.progressBar, i <= stepIndex && styles.progressBarOn]} />
            </Pressable>
          ))}
        </View>
        <Text style={styles.progressText}>Langkah {stepIndex + 1} dari {TOTAL_STEPS} · <Text style={styles.progressTextBold}>{STEP_TITLES[stepIndex]}</Text></Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Step 0 — Pilih Toko */}
          {stepIndex === 0 && (
            <FadeInUp key="step0">
              <Text style={styles.stepTitle}>Pilih toko tujuan</Text>
              <Text style={styles.stepHint}>Pilih dealer Ginnva yang ingin kamu kunjungi. Tim kami akan mengonfirmasi jadwalnya.</Text>
              {storesLoading ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
              ) : storesError ? (
                <View style={styles.stateBox}>
                  <Text style={styles.stateText}>Gagal memuat daftar toko. Periksa koneksi internetmu.</Text>
                  <PressableScale onPress={() => setStoresReload((n) => n + 1)} style={styles.retryPill} accessibilityRole="button">
                    <Text style={styles.retryPillText}>Coba Lagi</Text>
                  </PressableScale>
                </View>
              ) : stores.length === 0 ? (
                <Text style={styles.stateText}>Tidak ada toko tersedia.</Text>
              ) : (
                <View style={styles.optionList}>
                  {stores.map((s) => {
                    const active = selectedStoreId === s.id;
                    return (
                      <PressableScale
                        key={s.id}
                        style={[styles.option, active && styles.optionActive]}
                        onPress={() => selectStore(s.id, `${s.name} — ${s.city}`)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                      >
                        <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                          <Ionicons name="storefront-outline" size={20} color={active ? '#ffffff' : colors.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionTitle}>{s.name}</Text>
                          <Text style={styles.optionSub}>{s.city}</Text>
                        </View>
                        <View style={[styles.radio, active && styles.radioActive]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                        </View>
                      </PressableScale>
                    );
                  })}
                </View>
              )}
            </FadeInUp>
          )}

          {/* Step 1 — Kendaraan */}
          {stepIndex === 1 && (
            <FadeInUp key="step1">
              <Text style={styles.stepTitle}>Pilih kendaraan</Text>
              <Text style={styles.stepHint}>Pilih mobil yang akan dikerjakan. Toko memakai data ini untuk menyiapkan pengerjaan.</Text>

              {vehiclesLoading ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
              ) : vehiclesError ? (
                <PressableScale onPress={() => setVehiclesReload((n) => n + 1)} style={styles.warnBox} accessibilityRole="button">
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                  <Text style={styles.warnText}>Gagal memuat kendaraan. Ketuk untuk coba lagi.</Text>
                </PressableScale>
              ) : (
                <View style={styles.optionList}>
                  {vehicles.map((v) => {
                    const active = selectedVehicleId === v.id;
                    return (
                      <PressableScale
                        key={v.id}
                        style={[styles.option, active && styles.optionActive]}
                        onPress={() => { hapticLight(); setSelectedVehicleId(v.id); }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                      >
                        <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                          <Ionicons name="car-sport-outline" size={20} color={active ? '#ffffff' : colors.accent} />
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <View style={styles.plate}><Text style={styles.plateText}>{v.plate}</Text></View>
                          <Text style={styles.optionTitle} numberOfLines={1}>{v.label}</Text>
                        </View>
                        <View style={[styles.radio, active && styles.radioActive]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                        </View>
                      </PressableScale>
                    );
                  })}

                  <PressableScale style={styles.addVehicle} onPress={openVehicleForm} accessibilityRole="button">
                    <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
                    <Text style={styles.addVehicleText}>{vehicles.length === 0 ? 'Tambah Kendaraan' : 'Tambah Kendaraan Lain'}</Text>
                  </PressableScale>
                </View>
              )}
            </FadeInUp>
          )}

          {/* Step 2 — Pilih Layanan */}
          {stepIndex === 2 && (
            <FadeInUp key="step2">
              <Text style={styles.stepTitle}>Pilih layanan</Text>
              <Text style={styles.stepHint}>Pilih satu atau lebih layanan. Harga dan jadwal dikonfirmasi oleh toko.</Text>
              {servicesLoading ? <Text style={styles.stepHint}>Memuat layanan...</Text> : null}

              <View style={styles.optionList}>
                {services.filter((s) => !(ADDON_KEYS.includes(s.key) && (hasKaca || hasPpf))).map((s) => {
                  const active = selectedKeys.includes(s.key);
                  const days = s.key === 'ppf' && active ? serviceDays(s) : s.estimated_duration_days;
                  return (
                    <React.Fragment key={s.key}>
                      <PressableScale
                        style={[styles.option, styles.optionTop, active && styles.optionActive]}
                        onPress={() => toggleService(s.key)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active }}
                      >
                        <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                          <Ionicons name={SERVICE_ICON[s.key] ?? 'construct-outline'} size={20} color={active ? '#ffffff' : colors.accent} />
                        </View>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={styles.optionTitle}>{s.label}</Text>
                          <Text style={styles.optionDesc}>{s.description}</Text>
                          <View style={styles.durationChip}>
                            <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                            <Text style={styles.durationText}>{days > 1 ? `±${days} hari kerja` : 'Selesai dalam 1 hari'}</Text>
                          </View>
                        </View>
                        <View style={[styles.check, active && styles.radioActive]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                        </View>
                      </PressableScale>

                      {/* Layanan tambahan di bawah Kaca Film (Detailing dan Premium Wash), opsional. */}
                      {s.key === 'kaca_film' && active && !hasPpf ? (
                        <View style={styles.areaBox}>
                          <Text style={styles.areaTitle}>Layanan tambahan <Text style={styles.optional}>(opsional)</Text></Text>
                          {services.filter((a) => ADDON_KEYS.includes(a.key)).map((a) => {
                            const on = selectedKeys.includes(a.key);
                            return (
                              <PressableScale
                                key={a.key}
                                style={[styles.addonRow, on && styles.addonRowActive]}
                                onPress={() => toggleService(a.key)}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: on }}
                              >
                                <View style={[styles.addonIcon, on && styles.optionIconActive]}>
                                  <Ionicons name={SERVICE_ICON[a.key] ?? 'construct-outline'} size={18} color={on ? '#ffffff' : colors.accent} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.addonTitle}>{a.label}</Text>
                                  <Text style={styles.addonSub}>{a.estimated_duration_days > 1 ? `±${a.estimated_duration_days} hari kerja` : 'Selesai dalam 1 hari'}</Text>
                                </View>
                                <View style={[styles.check, on && styles.radioActive]}>
                                  {on ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                                </View>
                              </PressableScale>
                            );
                          })}
                        </View>
                      ) : null}

                      {/* Area pemasangan PPF: Eksterior dan Interior boleh dipilih bersamaan. */}
                      {s.key === 'ppf' && active ? (
                        <View style={styles.areaBox}>
                          <Text style={styles.areaTitle}>Area pemasangan PPF</Text>
                          <View style={styles.areaChips}>
                            {([
                              { label: 'Eksterior', value: ppfExterior, set: setPpfExterior },
                              { label: 'Interior', value: ppfInterior, set: setPpfInterior },
                            ] as const).map((area) => (
                              <PressableScale
                                key={area.label}
                                style={[styles.areaChip, area.value && styles.areaChipActive]}
                                onPress={() => { hapticLight(); area.set(!area.value); }}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: area.value }}
                              >
                                <Ionicons name={area.value ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={area.value ? '#ffffff' : colors.textMuted} />
                                <Text style={[styles.areaChipText, area.value && styles.onAccent]}>{area.label}</Text>
                              </PressableScale>
                            ))}
                          </View>
                          {!ppfExterior && !ppfInterior ? <Text style={styles.areaHint}>Pilih Eksterior, Interior, atau keduanya.</Text> : null}
                        </View>
                      ) : null}
                    </React.Fragment>
                  );
                })}

                <PressableScale
                  style={[styles.option, styles.optionTop, otherSelected && styles.optionActive]}
                  onPress={toggleOther}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: otherSelected }}
                >
                  <View style={[styles.optionIcon, otherSelected && styles.optionIconActive]}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={otherSelected ? '#ffffff' : colors.accent} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.optionTitle}>{OTHER_LABEL}</Text>
                    <Text style={styles.optionDesc}>Permintaan lain di luar layanan di atas. Jelaskan di catatan pada langkah terakhir.</Text>
                  </View>
                  <View style={[styles.check, otherSelected && styles.radioActive]}>
                    {otherSelected ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                  </View>
                </PressableScale>
              </View>
            </FadeInUp>
          )}

          {/* Step 3 — Pilih Jadwal */}
          {stepIndex === 3 && (
            <FadeInUp key="step3">
              <Text style={styles.stepTitle}>Tanggal kunjungan</Text>
              {datesLoading && <Text style={styles.stepHint}>Memuat ketersediaan tanggal...</Text>}
              {datesError && (
                <PressableScale onPress={() => setDatesReload((n) => n + 1)} style={styles.warnBox} accessibilityRole="button">
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                  <Text style={styles.warnText}>Ketersediaan tanggal gagal dimuat — tanggal penuh bisa saja belum tertandai. Ketuk untuk coba lagi.</Text>
                </PressableScale>
              )}
              <View style={styles.calendarCard}>
                <DateGrid
                  value={preferredDate}
                  onChange={setPreferredDate}
                  disabledDates={DATE_OPTIONS
                    .filter((d) => blockedDates.includes(d.value) || closedWeekdays.has(d.dow) || (isLight ? lightFullDates : fullDates).includes(d.value))
                    .map((d) => d.value)}
                  limitedDates={isLight ? [] : limitedDates}
                  loading={datesLoading}
                  colors={colors}
                />
              </View>
              <Text style={styles.footnote}>Penanda "Hampir penuh" bersifat perkiraan; jadwal final dikonfirmasi oleh tim kami.</Text>

              <Text style={[styles.sectionLabel, styles.sectionGap]}>
                {isLight ? 'Jam kedatangan' : 'Jam preferensi'}{' '}
                <Text style={styles.optional}>{isLight ? '(wajib)' : '(opsional)'}</Text>
              </Text>
              {isLight && !preferredDate && <Text style={styles.stepHint}>Pilih tanggal dulu untuk melihat jam yang tersedia.</Text>}
              {isLight && preferredDate !== '' && lightSlotsLoading && <Text style={styles.stepHint}>Memuat jam yang tersedia...</Text>}
              {isLight && preferredDate !== '' && !lightSlotsLoading && lightSlots === null && (
                <PressableScale onPress={() => setLightSlotsReload((n) => n + 1)} style={styles.warnBox} accessibilityRole="button">
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                  <Text style={styles.warnText}>Jam gagal dimuat. Ketuk untuk coba lagi.</Text>
                </PressableScale>
              )}
              <View style={styles.slotGrid}>
                {(isLight ? lightSlots ?? [] : TIME_SLOTS.map((slot) => ({ slot, available: true }))).map(({ slot, available }) => {
                  const active = preferredTime === slot;
                  return (
                    <PressableScale
                      key={slot}
                      disabled={!available}
                      style={[styles.slot, active && styles.slotActive, !available && { opacity: 0.4 }]}
                      onPress={() => setPreferredTime(active && !isLight ? '' : slot)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled: !available }}
                    >
                      <Ionicons name="time-outline" size={16} color={active ? '#ffffff' : colors.textSecondary} />
                      <Text style={[styles.slotText, active && styles.onAccent]}>{slot}{!available ? ' (penuh)' : ''}</Text>
                    </PressableScale>
                  );
                })}
              </View>
            </FadeInUp>
          )}

          {/* Step 4 — Ringkasan + Catatan */}
          {stepIndex === 4 && (
            <FadeInUp key="step4">
              <Text style={styles.stepTitle}>Periksa dan kirim</Text>

              <Text style={styles.sectionLabel}>Ringkasan</Text>
              <View style={styles.summaryCard}>
                {([
                  { icon: 'storefront-outline', label: 'Toko', value: selectedStoreName || stores.find((s) => s.id === selectedStoreId)?.name || '' },
                  { icon: 'car-sport-outline', label: 'Kendaraan', value: selectedVehicle ? `${selectedVehicle.label} · ${selectedVehicle.plate}` : '-' },
                  { icon: 'construct-outline', label: 'Layanan', value: serviceSummary },
                  { icon: 'calendar-outline', label: 'Tanggal', value: selectedDateLabel },
                  { icon: 'time-outline', label: 'Jam', value: preferredTime || 'Tidak ada preferensi' },
                  ...(estimateDays > 0 ? [{ icon: 'hourglass-outline', label: 'Perkiraan lama', value: estimateDays > 1 ? `±${estimateDays} hari kerja` : '1 hari' }] : []),
                ] as { icon: IconName; label: string; value: string }[]).map((row, i) => (
                  <View key={row.label} style={[styles.summaryRow, i > 0 && styles.summaryDivider]}>
                    <View style={styles.summaryIcon}>
                      <Ionicons name={row.icon} size={18} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.summaryLabel}>{row.label}</Text>
                      <Text style={styles.summaryValue}>{row.value}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <Text style={[styles.sectionLabel, styles.sectionGap]}>
                Catatan <Text style={styles.optional}>{otherSelected ? '(wajib untuk layanan Lainnya)' : '(opsional)'}</Text>
              </Text>
              <View style={[styles.textAreaWrap, notesFocused && styles.textAreaFocused]}>
                <TextInput
                  style={styles.textArea}
                  placeholder="mis. permintaan khusus atau kondisi mobil yang perlu kami ketahui..."
                  placeholderTextColor={colors.textMuted}
                  value={notes}
                  onChangeText={setNotes}
                  onFocus={() => setNotesFocused(true)}
                  onBlur={() => setNotesFocused(false)}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {!!cancellationPolicy && (
                <>
                  <Text style={[styles.sectionLabel, styles.sectionGap]}>Kebijakan pembatalan</Text>
                  <View style={styles.policyCard}>
                    <Text style={styles.policyText}>{cancellationPolicy}</Text>
                  </View>
                </>
              )}
              {!!privacyNotice && (
                <>
                  <Text style={[styles.sectionLabel, styles.sectionGap]}>Pemberitahuan privasi</Text>
                  <View style={styles.policyCard}>
                    <Text style={styles.policyText}>{privacyNotice}</Text>
                    <PressableScale
                      onPress={() => setPrivacyAccepted((v) => !v)}
                      style={styles.consentRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: privacyAccepted }}
                    >
                      <View style={[styles.check, privacyAccepted && styles.radioActive]}>
                        {privacyAccepted ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                      </View>
                      <Text style={styles.consentText}>Saya telah membaca dan menyetujui pemberitahuan privasi ini</Text>
                    </PressableScale>
                  </View>
                </>
              )}
              <Text style={styles.footnote}>
                Pembatalan atau pindah jadwal bisa diajukan dari menu Booking Saya. Tim toko akan mengonfirmasi jadwal dan menyampaikan harga.
              </Text>

              {submitError ? <AuthNotice kind="error" message={submitError} /> : null}
            </FadeInUp>
          )}
        </ScrollView>

        {/* Nav bawah */}
        <View style={[styles.navRow, { paddingBottom: insets.bottom + spacing.sm }]}>
          {stepIndex > 0 ? (
            <Button label="Kembali" variant="ghost" onPress={goBack} style={styles.navBack} />
          ) : null}
          {stepIndex < TOTAL_STEPS - 1 ? (
            <Button label="Lanjut" onPress={goNext} disabled={!stepValid[stepIndex]} style={styles.navNext} />
          ) : (
            <Button
              label="Kirim Booking"
              onPress={handleSubmit}
              disabled={!stepValid[4]}
              loading={phase === 'submitting'}
              style={styles.navNext}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      <VehicleFormModal
        visible={vehicleFormVisible}
        vehicle={null}
        catalog={catalog}
        onClose={() => setVehicleFormVisible(false)}
        onSaved={(saved) => {
          setVehicleFormVisible(false);
          setSelectedVehicleId(saved.id);
          setVehiclesReload((n) => n + 1);
          hapticSuccess();
        }}
      />
    </>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    progress: { paddingHorizontal: 24, paddingBottom: spacing.md, gap: 10 },
    progressBars: { flexDirection: 'row', gap: 6 },
    progressTouch: { flex: 1 },
    progressBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceElevated },
    progressBarOn: { backgroundColor: colors.accent },
    progressText: { fontSize: 13, color: colors.textMuted },
    progressTextBold: { fontWeight: '800', color: colors.textPrimary },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 32 },
    stepTitle: { fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary, marginBottom: 6 },
    stepHint: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginBottom: 18 },
    footnote: { fontSize: 12, lineHeight: 18, color: colors.textMuted, marginTop: 12, marginLeft: 4 },
    sectionLabel: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: 12 },
    sectionGap: { marginTop: 28 },
    optional: { fontWeight: '500', color: colors.textMuted, fontSize: 13 },

    stateBox: { alignItems: 'center', gap: 12, paddingVertical: 24 },
    stateText: { fontSize: 14, lineHeight: 21, color: colors.textMuted, textAlign: 'center' },
    retryPill: { height: 44, paddingHorizontal: 24, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    retryPillText: { fontSize: 14, fontWeight: '800', color: colors.accent },
    warnBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, marginBottom: 14, borderRadius: 18, backgroundColor: colors.warningBg },
    warnText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.warning },

    // Pilihan (toko, kendaraan, layanan): kartu lembut dengan ikon bulat dan penanda pilih.
    optionList: { gap: 10 },
    option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    optionTop: { alignItems: 'flex-start' },
    optionActive: { borderColor: colors.accent, backgroundColor: colors.bg },
    optionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    optionIconActive: { backgroundColor: colors.accent },
    optionTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    optionSub: { fontSize: 13, color: colors.textSecondary },
    optionDesc: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    radio: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.borderStrong },
    check: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.borderStrong },
    radioActive: { borderColor: colors.accent, backgroundColor: colors.accent },
    plate: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textPrimary, backgroundColor: colors.bg },
    plateText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, color: colors.textPrimary },
    durationChip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.bg },
    durationText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    addVehicle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 56, borderRadius: 22, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent },
    addVehicleText: { fontSize: 14, fontWeight: '800', color: colors.accent },

    areaBox: { marginTop: -2, padding: 14, gap: 10, borderRadius: 20, backgroundColor: colors.accentSoft },
    areaTitle: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
    areaChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    areaChip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.bg },
    areaChipActive: { backgroundColor: colors.accent },
    areaChipText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    addonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.bg },
    addonRowActive: { borderColor: colors.accent },
    addonIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    addonTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    addonSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    areaHint: { fontSize: 12, fontWeight: '600', color: colors.danger },
    onAccent: { color: '#ffffff' },

    calendarCard: { padding: 14, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    slot: { flexBasis: '47.5%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26, backgroundColor: colors.surfaceElevated },
    slotActive: { backgroundColor: colors.accent },
    slotText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

    summaryCard: { borderRadius: 24, backgroundColor: colors.surfaceElevated, paddingHorizontal: 6 },
    summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, paddingVertical: 14 },
    summaryDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    summaryIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    summaryLabel: { fontSize: 12, color: colors.textMuted },
    summaryValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },

    textAreaWrap: { borderRadius: 22, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    textAreaFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    textArea: { minHeight: 110, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, fontSize: 15, lineHeight: 22, color: colors.textPrimary },

    policyCard: { padding: 16, gap: 12, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    policyText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    consentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
    consentText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.textPrimary },

    navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingTop: spacing.sm, backgroundColor: colors.bg },
    navBack: { height: 56, borderRadius: 28, paddingHorizontal: 24, backgroundColor: colors.surfaceElevated },
    navNext: { flex: 1, height: 56, borderRadius: 28 },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32, paddingBottom: 48 },
    pillButton: { width: '100%', height: 54, borderRadius: 27, marginTop: 6 },
    ghostButton: { width: '100%', height: 48, borderRadius: 24 },
    successRing: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 6 },
    successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    successTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    codeCard: { alignItems: 'center', gap: 4, alignSelf: 'stretch', paddingVertical: 18, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    codeLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    successCode: { fontSize: 24, fontWeight: '800', letterSpacing: 1.5, color: colors.accent },
    successNote: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
  });
}
