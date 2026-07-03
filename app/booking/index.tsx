import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useFadeIn } from '@/lib/useFadeIn';
import { hapticLight, hapticSuccess, hapticError } from '@/lib/haptics';
import { useAuth } from '@/lib/auth-context';

interface StoreOption {
  id: number;
  name: string;
  city: string;
}

const TIME_SLOTS = [
  '08:00 - 10:00',
  '10:00 - 12:00',
  '13:00 - 15:00',
  '15:00 - 17:00',
];

// Color Change Film sengaja dihapus — belum dijual di Indonesia
const SERVICE_TYPES = [
  'Kaca Film (Window Film)',
  'Pelindung Cat (PPF)',
  'Konsultasi Produk',
  'Klaim Garansi',
  'Lainnya',
];

// Generate 14 hari ke depan sebagai pilihan tanggal
function generateDateOptions(): { label: string; value: string }[] {
  const options = [];
  const today = new Date();
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    options.push({ label, value });
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
  const [serviceType, setServiceType] = useState('');
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

  const stepValid = [
    selectedStoreId !== null,
    serviceType.length > 0,
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
            service_type: serviceType,
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

  // ===== Success =====
  if (phase === 'success') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Buat Booking" />
        <Animated.View style={[styles.centerState, { opacity: successOpacity }]}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={36} color={colors.white} />
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Buat Booking" />

      {/* Progress */}
      <View style={styles.progressRow}>
        {STEP_TITLES.map((title, i) => (
          <View key={title} style={styles.progressItem}>
            <View style={[
              styles.progressDot,
              i === stepIndex && styles.progressDotActive,
              i < stepIndex && styles.progressDotDone,
            ]}>
              {i < stepIndex ? (
                <Ionicons name="checkmark" size={12} color={colors.white} />
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
          </View>
        ))}
      </View>

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
                    onPress={() => {
                      setSelectedStoreId(s.id);
                      setSelectedStoreName(`${s.name} — ${s.city}`);
                    }}
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
            <View style={styles.chipWrap}>
              {SERVICE_TYPES.map((s) => (
                <Pressable
                  key={s}
                  style={[styles.chip, serviceType === s && styles.chipActive]}
                  onPress={() => setServiceType(s)}
                >
                  <Text style={[styles.chipText, serviceType === s && styles.chipTextActive]}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Step 2 — Pilih Jadwal */}
        {stepIndex === 2 && (
          <View>
            <Text style={styles.sectionLabel}>Tanggal Kunjungan</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll}>
              <View style={styles.dateRow}>
                {DATE_OPTIONS.map((d) => (
                  <Pressable
                    key={d.value}
                    style={[styles.dateChip, preferredDate === d.value && styles.dateChipActive]}
                    onPress={() => setPreferredDate(d.value)}
                  >
                    <Text style={[styles.dateChipText, preferredDate === d.value && styles.dateChipTextActive]}>
                      {d.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

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
            <Card style={styles.formCard}>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="mis. tipe mobil, warna, atau permintaan khusus..."
                placeholderTextColor={colors.mutedLight}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </Card>

            <Text style={styles.sectionLabel}>Ringkasan</Text>
            <Card style={styles.formCard}>
              {[
                { label: 'Toko', value: selectedStoreName },
                { label: 'Layanan', value: serviceType },
                { label: 'Tanggal', value: selectedDateLabel },
                { label: 'Jam', value: preferredTime || 'Tidak ada preferensi' },
              ].map((row) => (
                <View key={row.label} style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>{row.label}</Text>
                  <Text style={styles.summaryValue}>{row.value}</Text>
                </View>
              ))}
            </Card>

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
      <View style={[styles.navRow, { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.md }]}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  centerState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, padding: spacing.xl,
  },
  centerStateText: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center' },
  introContext: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: '600',
    lineHeight: 20,
    marginBottom: spacing.sm,
    backgroundColor: '#fce8ed',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  intro: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20, marginBottom: spacing.md },
  sectionLabel: { fontSize: fontSize.base, fontWeight: '700', color: colors.ink, marginBottom: spacing.sm },
  optional: { fontWeight: '400', color: colors.mutedLight, fontSize: fontSize.sm },
  emptyText: { fontSize: fontSize.sm, color: colors.mutedLight, textAlign: 'center', marginTop: spacing.lg },

  // Progress
  progressRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  progressItem: { flex: 1, alignItems: 'center', position: 'relative' },
  progressDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.alt, alignItems: 'center', justifyContent: 'center',
  },
  progressDotActive: { backgroundColor: colors.accent },
  progressDotDone: { backgroundColor: colors.success },
  progressDotText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.mutedLight },
  progressDotTextActive: { color: colors.white },
  progressLabel: { fontSize: 10, color: colors.mutedLight, marginTop: spacing.xs },
  progressLabelActive: { color: colors.ink, fontWeight: '700' },
  progressLine: {
    position: 'absolute', top: 11, left: '60%', right: '-40%',
    height: 2, backgroundColor: colors.line,
  },
  progressLineDone: { backgroundColor: colors.success },

  // Store chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  storeChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.alt, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line,
    minWidth: '45%',
  },
  storeChipActive: { backgroundColor: '#fce8ed', borderColor: colors.accent },
  storeChipName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.ink },
  storeChipNameActive: { color: colors.accent },
  storeChipCity: { fontSize: fontSize.xs, color: colors.muted, marginTop: 2 },
  storeChipCityActive: { color: colors.accent },

  // Service/time chips
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.alt, borderRadius: radius.pill,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontSize: fontSize.sm, color: colors.ink, fontWeight: '600' },
  chipTextActive: { color: colors.white },

  // Date chips
  dateScroll: { marginBottom: spacing.sm },
  dateRow: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.xs },
  dateChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.alt, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, alignItems: 'center',
    minWidth: 80,
  },
  dateChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  dateChipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.ink },
  dateChipTextActive: { color: colors.white },

  // Form
  formCard: { marginBottom: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.sm, color: colors.ink,
  },
  textArea: { minHeight: 80, paddingTop: spacing.sm },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    gap: spacing.sm, paddingVertical: spacing.xs,
  },
  summaryLabel: { fontSize: fontSize.sm, color: colors.mutedLight },
  summaryValue: { flex: 1, fontSize: fontSize.sm, color: colors.ink, fontWeight: '600', textAlign: 'right' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: '#fde8e8', borderRadius: radius.md,
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  errorBannerText: { flex: 1, fontSize: fontSize.sm, color: colors.danger },

  // Nav
  navRow: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  navButton: { flex: 1 },

  // Success
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successTitle: { fontSize: fontSize.xl, fontWeight: '800', color: colors.ink },
  successCode: { fontWeight: '800', color: colors.accent, fontSize: fontSize.base },
  successNote: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  successButton: { marginTop: spacing.sm, width: '100%' },
});