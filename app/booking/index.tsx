import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useFadeIn } from '@/lib/useFadeIn';
import { hapticLight, hapticSuccess, hapticError } from '@/lib/haptics';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';

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

// Color Change Film sengaja dihapus — belum dijual di Indonesia
const SERVICE_TYPES = [
  'Kaca Film (Window Film)',
  'Pelindung Cat (PPF)',
  'Kaca Film + PPF',
  'Konsultasi Produk',
  'Klaim Garansi',
  'Lainnya',
];

// Dua opsi ini boleh dipilih BARENGAN (booking 2 produk sekaligus, progress
// tahapnya berjalan paralel) — sisanya cuma boleh 1 pilihan.
const PRODUCT_SERVICE_TYPES = ['Kaca Film (Window Film)', 'Pelindung Cat (PPF)'];

// Shortcut chip — sama persis efeknya dengan tap kedua chip produk di atas
// sekaligus, cuma lebih cepat buat customer yang dari awal sudah tahu mau
// pasang keduanya.
const BOTH_PRODUCTS_LABEL = 'Kaca Film + PPF';

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

const DATE_OPTIONS = generateDateOptions();

type Phase = 'form' | 'submitting' | 'success';
type Step = 0 | 1 | 2 | 3;

const STEP_TITLES = ['Toko', 'Layanan', 'Jadwal', 'Ringkasan'];
const TOTAL_STEPS = STEP_TITLES.length;

export default function BookingScreen() {
  const params = useLocalSearchParams<{ store_id?: string; store_name?: string }>();
  const { isLoggedIn } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const successOpacity = useFadeIn(400);

  const [phase, setPhase] = useState<Phase>('form');
  const [stepIndex, setStepIndex] = useState<Step>(0);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);

  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(
    params.store_id ? Number(params.store_id) : null
  );
  const [selectedStoreName, setSelectedStoreName] = useState<string>(
    params.store_name ?? ''
  );
  const [blockedDates, setBlockedDates] = useState<string[]>([]);

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
  // Kaca Film & PPF BOLEH dipilih sekaligus (progress tahapnya berjalan
  // paralel) — Konsultasi/Klaim Garansi/Lainnya tetap 1 pilihan saja,
  // saling eksklusif dengan produk maupun sesamanya. Lihat toggleService().
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingNumber, setBookingNumber] = useState('');

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login' as never);
      return;
    }
    apiFetch<{ data: StoreOption[] }>('/api/stores', { skipAuth: true })
      .then((res) => setStores(res.data))
      .catch(() => {})
      .finally(() => setStoresLoading(false));
  }, [isLoggedIn]);

  useEffect(() => {
    if (!selectedStoreId) return;
    apiFetch<{ data: string[] }>(`/api/stores/${selectedStoreId}/blocked-dates`, { skipAuth: true })
      .then((res) => setBlockedDates(res.data))
      .catch(() => {});
  }, [selectedStoreId]);

  const selectStore = (id: number, name: string) => {
    setSelectedStoreId(id);
    setSelectedStoreName(name);
    setPreferredDate('');
    setBlockedDates([]);
  };

  // Semua opsi single-select — mau Kaca Film saja, PPF saja, atau
  // keduanya sekaligus lewat chip gabungan "Kaca Film + PPF".
  const toggleService = (s: string) => {
    setSelectedServices((prev) => (prev.length === 1 && prev[0] === s ? [] : [s]));
  };

  const stepValid = [
    selectedStoreId !== null,
    selectedServices.length > 0,
    preferredDate.length > 0,
    true,
  ];

  const goNext = () => {
    if (!stepValid[stepIndex]) return;
    hapticLight();
    if (stepIndex < TOTAL_STEPS - 1) setStepIndex((s) => (s + 1) as Step);
  };

  const goBack = () => {
    if (stepIndex > 0) setStepIndex((s) => (s - 1) as Step);
  };

  const handleSubmit = async () => {
    setPhase('submitting');
    setSubmitError(null);
    try {
      const res = await apiFetch<{ success: boolean; data: { booking_number: string } }>(
        '/api/customer/bookings',
        {
          method: 'POST',
          body: JSON.stringify({
            store_id: selectedStoreId,
            service_type: selectedServices.includes(BOTH_PRODUCTS_LABEL)
              ? PRODUCT_SERVICE_TYPES.join(', ')
              : selectedServices.join(', '),
            product_kaca_film: selectedServices.includes(BOTH_PRODUCTS_LABEL) || selectedServices.includes('Kaca Film (Window Film)'),
            product_ppf: selectedServices.includes(BOTH_PRODUCTS_LABEL) || selectedServices.includes('Pelindung Cat (PPF)'),
            preferred_date: preferredDate,
            preferred_time: preferredTime || null,
            notes: notes.trim() || null,
          }),
        }
      );
      setBookingNumber(res.data.booking_number);
      setPhase('success');
      hapticSuccess();
    } catch (err) {
      setPhase('form');
      hapticError();
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : 'Terjadi kesalahan. Periksa koneksi internet Anda.'
      );
    }
  };

  const selectedDateLabel = DATE_OPTIONS.find((d) => d.value === preferredDate)?.label ?? '';

  const HeaderBar = ({ title }: { title: string }) => (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sideButton} />
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.sideButton} />
    </View>
  );

  // ===== Success =====
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar title="Buat Booking" />
        <Animated.View style={[styles.centerState, { opacity: successOpacity }]}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={36} color="#ffffff" />
          </View>
          <Text style={styles.successTitle}>Booking Diterima!</Text>
          <Text style={styles.centerStateText}>
            Nomor booking Anda:{'\n'}
            <Text style={styles.successCode}>{bookingNumber}</Text>
          </Text>
          <Text style={styles.successNote}>
            Tim toko akan menghubungi Anda untuk konfirmasi jadwal.
          </Text>
          <Button
            label="Lihat Booking Saya"
            onPress={() => router.replace('/account/my-bookings' as never)}
            style={styles.successButton}
          />
          <Button
            label="Kembali"
            variant="ghost"
            onPress={() => router.back()}
            style={styles.successButton}
          />
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar title="Buat Booking" />

      {/* Progress — step yang sudah dilewati bisa ditap untuk lompat balik
          langsung, bukan cuma indikator visual. Step yang belum dicapai
          TIDAK bisa ditap (mencegah lompat maju melewati validasi). */}
      <View style={styles.progressRow}>
        {STEP_TITLES.map((title, i) => (
          <Pressable
            key={title}
            style={styles.progressItem}
            disabled={i >= stepIndex}
            onPress={() => { hapticLight(); setStepIndex(i as Step); }}
          >
            <View style={[
              styles.progressDot,
              i === stepIndex && styles.progressDotActive,
              i < stepIndex && styles.progressDotDone,
            ]}>
              {i < stepIndex ? (
                <Ionicons name="checkmark" size={12} color="#ffffff" />
              ) : (
                <Text style={[styles.progressDotText, i === stepIndex && styles.progressDotTextActive]}>
                  {i + 1}
                </Text>
              )}
            </View>
            <Text style={[styles.progressLabel, i === stepIndex && styles.progressLabelActive]} numberOfLines={1}>
              {title}
            </Text>
            {i < STEP_TITLES.length - 1 && (
              <View style={[styles.progressLine, i < stepIndex && styles.progressLineDone]} />
            )}
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Step 0 — Pilih Toko */}
        {stepIndex === 0 && (
          <View>
            <Text style={styles.introContext}>
              Sudah sepakat harga dengan tim kami? Buat jadwal instalasi di sini.
            </Text>
            <Text style={styles.intro}>Pilih dealer Ginnva yang ingin Anda kunjungi.</Text>
            <Text style={styles.sectionLabel}>Toko Tujuan</Text>
            {storesLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.md }} />
            ) : stores.length === 0 ? (
              <Text style={styles.emptyText}>Tidak ada toko tersedia.</Text>
            ) : (
              <View style={styles.chipWrap}>
                {stores.map((s) => (
                  <Pressable
                    key={s.id}
                    style={[styles.storeChip, selectedStoreId === s.id && styles.storeChipActive]}
                    onPress={() => selectStore(s.id, `${s.name} — ${s.city}`)}
                  >
                    <Text style={[styles.storeChipName, selectedStoreId === s.id && styles.storeChipNameActive]}>
                      {s.name}
                    </Text>
                    <Text style={[styles.storeChipCity, selectedStoreId === s.id && styles.storeChipCityActive]}>
                      {s.city}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Step 1 — Pilih Layanan */}
        {stepIndex === 1 && (
          <View>
            <Text style={styles.sectionLabel}>Jenis Layanan</Text>
            <Text style={styles.intro}>
              Pilih layanan Anda.
            </Text>
            <View style={styles.chipWrap}>
              {SERVICE_TYPES.map((s) => {
                const active = selectedServices.includes(s);
                return (
                  <Pressable
                    key={s}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => toggleService(s)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {s}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {/* Step 2 — Pilih Jadwal */}
        {stepIndex === 2 && (
          <View>
            <Text style={styles.sectionLabel}>Tanggal Kunjungan</Text>
            <View style={styles.dateGrid}>
              {DATE_OPTIONS.map((d) => {
                const isClosed = closedWeekdays.has(d.dow);
                const isBlocked = blockedDates.includes(d.value) || isClosed;
                const isSelected = preferredDate === d.value;
                return (
                  <Pressable
                    key={d.value}
                    style={[
                      styles.dateChip,
                      isSelected && styles.dateChipActive,
                      isBlocked && styles.dateChipBlocked,
                    ]}
                    onPress={() => { if (!isBlocked) setPreferredDate(d.value); }}
                  >
                    <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextActive, isBlocked && styles.dateChipTextBlocked]}>
                      {d.day}
                    </Text>
                    <Text style={[styles.dateChipDate, isSelected && styles.dateChipTextActive, isBlocked && styles.dateChipTextBlocked]}>
                      {d.date}
                    </Text>
                    {/* Label SEBELUMNYA "Penuh" untuk tanggal di blockedDates —
                        menyesatkan, karena blockedDates murni tanggal yang
                        diblokir manual oleh admin toko (lihat
                        Store::isClosedOn()), BUKAN hasil pengecekan
                        kapasitas slot instalasi real-time. Kapasitas baru
                        benar-benar dicek staff saat approve
                        (Booking::fullDatesInRange()). "Tidak Tersedia"
                        tidak mengklaim ada pengecekan slot yang sebenarnya
                        belum terjadi di titik ini. */}
                    {isBlocked && (
                      <Text style={styles.dateChipBlockedLabel}>{isClosed ? 'Tutup' : 'Tidak Tersedia'}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
              Jam Preferensi <Text style={styles.optional}>(opsional)</Text>
            </Text>
            <View style={styles.chipWrap}>
              {TIME_SLOTS.map((slot) => (
                <Pressable
                  key={slot}
                  style={[styles.chip, preferredTime === slot && styles.chipActive]}
                  onPress={() => setPreferredTime(preferredTime === slot ? '' : slot)}
                >
                  <Text style={[styles.chipText, preferredTime === slot && styles.chipTextActive]}>
                    {slot}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Step 3 — Ringkasan + Catatan */}
        {stepIndex === 3 && (
          <View>
            <Text style={styles.sectionLabel}>Catatan <Text style={styles.optional}>(opsional)</Text></Text>
            <View style={styles.formCard}>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="mis. tipe mobil, warna, atau permintaan khusus..."
                placeholderTextColor={colors.textMuted}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <Text style={styles.sectionLabel}>Ringkasan</Text>
            <View style={styles.formCard}>
              {[
                { label: 'Toko', value: selectedStoreName },
                { label: 'Layanan', value: selectedServices.join(', ') },
                { label: 'Tanggal', value: selectedDateLabel },
                { label: 'Jam', value: preferredTime || 'Tidak ada preferensi' },
              ].map((row) => (
                <View key={row.label} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{row.label}</Text>
                  <Text style={styles.summaryValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            {submitError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <Text style={styles.errorBannerText}>{submitError}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Nav bawah */}
      <View style={[styles.navRow, { paddingBottom: insets.bottom + spacing.sm }]}>
        {stepIndex > 0 ? (
          <Button label="Kembali" variant="outline" onPress={goBack} style={styles.navButton} />
        ) : (
          <View style={styles.navButton} />
        )}
        {stepIndex < TOTAL_STEPS - 1 ? (
          <Button
            label="Lanjut"
            onPress={goNext}
            disabled={!stepValid[stepIndex]}
            style={styles.navButton}
          />
        ) : (
          <Button
            label="Kirim Booking"
            onPress={handleSubmit}
            loading={phase === 'submitting'}
            style={styles.navButton}
          />
        )}
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  centerState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, padding: spacing.xl,
  },
  centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  introContext: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  intro: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  sectionLabel: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  optional: { fontWeight: '400', color: colors.textMuted, fontSize: fontSize.sm },
  emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },

  // Progress
  progressRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  progressItem: { flex: 1, alignItems: 'center', position: 'relative' },
  progressDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  progressDotActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  progressDotDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  progressDotText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted },
  progressDotTextActive: { color: '#ffffff' },
  progressLabel: { fontSize: 10, color: colors.textMuted, marginTop: spacing.xs },
  progressLabelActive: { color: colors.textPrimary, fontWeight: '700' },
  progressLine: {
    position: 'absolute', top: 11, left: '60%', right: '-40%',
    height: 2, backgroundColor: colors.border,
  },
  progressLineDone: { backgroundColor: colors.accent },

  // Store chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  storeChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    minWidth: '45%',
  },
  storeChipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  storeChipName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  storeChipNameActive: { color: colors.accent },
  storeChipCity: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  storeChipCityActive: { color: colors.accent },

  // Service/time chips
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
  chipTextActive: { color: '#ffffff' },

  // Date grid
  dateGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm,
  },
  dateChip: {
    width: '13%',
    minWidth: 44,
    flexGrow: 1,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  dateChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  dateChipBlocked: { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.4 },
  dateChipDay: { fontSize: 10, color: colors.textSecondary },
  dateChipDate: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary, marginTop: 1 },
  dateChipTextActive: { color: '#ffffff' },
  dateChipTextBlocked: { color: colors.textMuted },
  dateChipBlockedLabel: { fontSize: 9, color: colors.accent, fontWeight: '700', marginTop: 2 },

  // Form
  formCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.sm, color: colors.textPrimary,
  },
  textArea: { minHeight: 80, paddingTop: spacing.sm },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    gap: spacing.sm, paddingVertical: spacing.xs,
  },
  summaryLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  summaryValue: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600', textAlign: 'right' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.dangerBg, borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  errorBannerText: { flex: 1, fontSize: fontSize.sm, color: colors.danger },

  // Nav
  navRow: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  navButton: { flex: 1 },

  // Success
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary },
  successCode: { fontWeight: '800', color: colors.accent, fontSize: fontSize.base },
  successNote: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  successButton: { marginTop: spacing.sm, width: '100%' },
  });
}
