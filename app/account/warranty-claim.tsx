import React, { useEffect, useMemo, useState } from 'react';
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
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useFadeIn } from '@/lib/useFadeIn';
import { hapticLight, hapticSuccess, hapticError } from '@/lib/haptics';
import { useAppTheme } from '@/lib/theme-context';

// Bagian B rancangan "Klaim Garansi & Maintenance PPF" (2026-10-01) --
// SEBELUMNYA customer cuma bisa klik CTA WhatsApp manual dari
// warranty-detail.tsx (tidak ada form in-app sama sekali). Toko & customer
// SUDAH DITENTUKAN dari warranty yang dipilih (lewat ?id=), jadi alur ini
// cuma 3 langkah (Kategori, Jadwal, Ringkasan) -- beda dari app/booking/index.tsx
// yang 4 langkah termasuk pilih toko. Pola tanggal/jam/chip & gaya layar
// SENGAJA disalin dari booking/index.tsx (bukan diekstrak jadi komponen
// shared) supaya tidak mengganggu layar booking yang sudah stabil.
//
// Tampilan didesain ulang (2026-11-24): kemajuan berupa 3 segmen, kategori sebagai kartu pilihan, tanggal sebagai deretan kartu yang
// digeser, dan ringkasan berikon. Alur, validasi, dan panggilan API tidak berubah.

interface WarrantyForClaim {
  id: number;
  warranty_code: string;
  store: { id: number; name: string } | null;
}

interface StoreOpeningHours {
  days: string[];
  closed?: boolean;
}

const JS_DAY_TO_CODE = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const TIME_SLOTS = ['09:00 - 11:00', '11:00 - 13:00', '13:00 - 15:00', '15:00 - 17:00'];

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const CLAIM_CATEGORIES: { key: string; label: string; icon: IconName }[] = [
  { key: 'worry_free_wrap', label: 'Worry Free Wrap (Anti Gores)', icon: 'shield-checkmark-outline' },
  { key: 'product_warranty', label: 'Product Warranty', icon: 'ribbon-outline' },
  { key: 'other', label: 'Lainnya / Kustomisasi', icon: 'options-outline' },
];

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

type Phase = 'loading' | 'form' | 'submitting' | 'success' | 'error';
type Step = 0 | 1 | 2;

const STEP_TITLES = ['Kategori', 'Jadwal', 'Ringkasan'];
const TOTAL_STEPS = STEP_TITLES.length;

export default function WarrantyClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const successOpacity = useFadeIn(400);

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [warranty, setWarranty] = useState<WarrantyForClaim | null>(null);
  const [closedWeekdays, setClosedWeekdays] = useState<Set<string>>(new Set());
  const [blockedDates, setBlockedDates] = useState<string[]>([]);

  const [stepIndex, setStepIndex] = useState<Step>(0);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [descFocused, setDescFocused] = useState(false);
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [claimNumber, setClaimNumber] = useState('');

  useEffect(() => {
    // Bug diperbaiki 2026-10-01 (audit Bagian B) -- SEBELUMNYA tanpa `id`
    // (link rusak/navigasi tidak normal) layar ini diam di 'loading'
    // selamanya, tidak pernah pindah ke state error apa pun.
    if (!id) {
      setLoadError('Tautan klaim tidak valid. Coba buka ulang dari halaman Garansi Saya.');
      setPhase('error');
      return;
    }
    apiFetch<{ data: WarrantyForClaim }>(`/api/customer/warranties/${id}`)
      .then((res) => {
        if (!res.data.store) {
          setLoadError('Garansi ini tidak terhubung ke toko mana pun, klaim tidak bisa diajukan lewat app. Hubungi tim kami langsung.');
          setPhase('error');
          return;
        }
        setWarranty(res.data);
        setPhase('form');
        return apiFetch<{ data: { id: number; name: string; opening_hours: StoreOpeningHours[] | null } }>(
          `/api/stores/${res.data.store!.id}`,
          { skipAuth: true }
        )
          .then((storeRes) => {
            const closed = new Set<string>();
            (storeRes.data.opening_hours ?? []).forEach((row) => {
              if (row.closed) (row.days ?? []).forEach((d) => closed.add(d));
            });
            setClosedWeekdays(closed);
          })
          .catch(() => {});
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : 'Gagal memuat data garansi.');
        setPhase('error');
      });
  }, [id]);

  useEffect(() => {
    if (!warranty?.store) return;
    apiFetch<{ data: string[] }>(`/api/stores/${warranty.store.id}/blocked-dates`, { skipAuth: true })
      .then((res) => setBlockedDates(res.data))
      .catch(() => {});
  }, [warranty]);

  // Kalender menonaktifkan hari toko tutup mingguan (mis. Minggu) dan tanggal yang diblokir admin toko.
  const disabledDates = useMemo(
    () => [...blockedDates, ...DATE_OPTIONS.filter((d) => closedWeekdays.has(d.dow)).map((d) => d.value)],
    [blockedDates, closedWeekdays]
  );

  const stepValid = [category.length > 0, preferredDate.length > 0, true];

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
      const res = await apiFetch<{ success: boolean; data: { claim_number: string } }>(
        `/api/customer/warranties/${id}/claims`,
        {
          method: 'POST',
          body: JSON.stringify({
            category,
            description: description.trim() || null,
            preferred_date: preferredDate,
            preferred_time: preferredTime || null,
          }),
        }
      );
      setClaimNumber(res.data.claim_number);
      setPhase('success');
      hapticSuccess();
    } catch (err) {
      setPhase('form');
      hapticError();
      setSubmitError(
        err instanceof ApiError ? err.message : 'Terjadi kesalahan. Periksa koneksi internetmu.'
      );
    }
  };

  const selectedDateLabel = DATE_OPTIONS.find((d) => d.value === preferredDate)?.label ?? '';
  const selectedCategoryLabel = CLAIM_CATEGORIES.find((c) => c.key === category)?.label ?? '';

  // Kepala bersama: tombol kembali bulat + judul besar, di atas sorotan merah lembut.
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
        <Text style={styles.topTitle}>Klaim Garansi</Text>
      </View>
      {children}
    </SafeAreaView>
  );

  if (phase === 'loading') {
    return frame(
      <>
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </>
    );
  }

  if (phase === 'error') {
    return frame(
      <>
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>{loadError}</Text>
          <Button label="Kembali" variant="outline" onPress={() => router.back()} style={styles.pillButton} />
        </View>
      </>
    );
  }

  if (phase === 'success') {
    return frame(
      <>
        <Animated.View style={[styles.centerState, { opacity: successOpacity }]}>
          <View style={styles.successRing}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={40} color="#ffffff" />
            </View>
          </View>
          <Text style={styles.successTitle}>Klaim diajukan!</Text>
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Nomor klaimmu</Text>
            <Text style={styles.successCode} selectable>{claimNumber}</Text>
          </View>
          <Text style={styles.successNote}>Tim toko akan menghubungimu untuk konfirmasi jadwal.</Text>
          <Button
            label="Lihat Garansi Saya"
            onPress={() => router.replace('/account/my-warranties' as never)}
            style={styles.pillButton}
          />
          <Button label="Kembali" variant="ghost" onPress={() => router.back()} style={styles.ghostButton} />
        </Animated.View>
      </>
    );
  }

  return frame(
    <>
      {/* Kemajuan: tiga segmen; langkah yang sudah lewat bisa diketuk untuk kembali. */}
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
          {stepIndex === 0 && (
            <FadeInUp key="step0" style={styles.stepBody}>
              <View style={styles.context}>
                <View style={styles.contextIcon}>
                  <Ionicons name="storefront-outline" size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextCode} numberOfLines={1}>{warranty?.warranty_code}</Text>
                  <Text style={styles.contextStore} numberOfLines={1}>{warranty?.store?.name}</Text>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Kategori klaim</Text>
              <View style={styles.optionList}>
                {CLAIM_CATEGORIES.map((c) => {
                  const active = category === c.key;
                  return (
                    <PressableScale
                      key={c.key}
                      style={[styles.option, active && styles.optionActive]}
                      onPress={() => setCategory(active ? '' : c.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                    >
                      <View style={[styles.optionIcon, active && styles.optionIconActive]}>
                        <Ionicons name={c.icon} size={20} color={active ? '#ffffff' : colors.accent} />
                      </View>
                      <Text style={styles.optionText}>{c.label}</Text>
                      <View style={[styles.radio, active && styles.radioActive]}>
                        {active ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                      </View>
                    </PressableScale>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, styles.sectionGap]}>
                Keluhan atau permintaan <Text style={styles.optional}>(opsional)</Text>
              </Text>
              <View style={[styles.textAreaWrap, descFocused && styles.textAreaFocused]}>
                <TextInput
                  style={styles.textArea}
                  placeholder="mis. ada gelembung di bagian kap mesin..."
                  placeholderTextColor={colors.textMuted}
                  value={description}
                  onChangeText={setDescription}
                  onFocus={() => setDescFocused(true)}
                  onBlur={() => setDescFocused(false)}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </FadeInUp>
          )}

          {stepIndex === 1 && (
            <FadeInUp key="step1" style={styles.stepBody}>
              <Text style={styles.sectionLabel}>Tanggal kunjungan</Text>
              <View style={styles.calendarCard}>
                <DateGrid
                  value={preferredDate}
                  onChange={setPreferredDate}
                  disabledDates={disabledDates}
                  colors={colors}
                />
              </View>
              {selectedDateLabel ? (
                <View style={styles.pickedDate}>
                  <Ionicons name="calendar-outline" size={16} color={colors.accent} />
                  <Text style={styles.pickedDateText}>{selectedDateLabel}</Text>
                </View>
              ) : null}

              <Text style={[styles.sectionLabel, styles.sectionGap]}>
                Jam preferensi <Text style={styles.optional}>(opsional)</Text>
              </Text>
              <View style={styles.slotGrid}>
                {TIME_SLOTS.map((slot) => {
                  const active = preferredTime === slot;
                  return (
                    <PressableScale
                      key={slot}
                      style={[styles.slot, active && styles.slotActive]}
                      onPress={() => setPreferredTime(active ? '' : slot)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Ionicons name="time-outline" size={16} color={active ? '#ffffff' : colors.textSecondary} />
                      <Text style={[styles.slotText, active && styles.onAccent]}>{slot}</Text>
                    </PressableScale>
                  );
                })}
              </View>
            </FadeInUp>
          )}

          {stepIndex === 2 && (
            <FadeInUp key="step2" style={styles.stepBody}>
              <Text style={styles.sectionLabel}>Ringkasan</Text>
              <View style={styles.summaryCard}>
                {([
                  { icon: 'storefront-outline', label: 'Toko', value: warranty?.store?.name ?? '' },
                  { icon: 'pricetag-outline', label: 'Kategori', value: selectedCategoryLabel },
                  { icon: 'calendar-outline', label: 'Tanggal', value: selectedDateLabel },
                  { icon: 'time-outline', label: 'Jam', value: preferredTime || 'Tidak ada preferensi' },
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

              {description.trim() ? (
                <View style={styles.summaryNote}>
                  <Text style={styles.summaryLabel}>Keluhan</Text>
                  <Text style={styles.summaryValue}>{description.trim()}</Text>
                </View>
              ) : null}

              {submitError ? <AuthNotice kind="error" message={submitError} /> : null}
            </FadeInUp>
          )}
        </ScrollView>

        <View style={[styles.navRow, { paddingBottom: insets.bottom + spacing.sm }]}>
          {stepIndex > 0 ? (
            <Button label="Kembali" variant="ghost" onPress={goBack} style={styles.navBack} />
          ) : null}
          {stepIndex < TOTAL_STEPS - 1 ? (
            <Button label="Lanjut" onPress={goNext} disabled={!stepValid[stepIndex]} style={styles.navNext} />
          ) : (
            <Button
              label="Ajukan Klaim"
              onPress={handleSubmit}
              loading={phase === 'submitting'}
              style={styles.navNext}
            />
          )}
        </View>
      </KeyboardAvoidingView>
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

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 32, paddingBottom: 48 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    pillButton: { width: '100%', height: 54, borderRadius: 27, marginTop: 6 },
    ghostButton: { width: '100%', height: 48, borderRadius: 24 },

    progress: { paddingHorizontal: 24, paddingBottom: spacing.md, gap: 10 },
    progressBars: { flexDirection: 'row', gap: 8 },
    progressTouch: { flex: 1 },
    progressBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceElevated },
    progressBarOn: { backgroundColor: colors.accent },
    progressText: { fontSize: 13, color: colors.textMuted },
    progressTextBold: { fontWeight: '800', color: colors.textPrimary },

    scrollContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 32 },
    stepBody: { gap: 0 },
    sectionLabel: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: 12 },
    sectionGap: { marginTop: 28 },
    optional: { fontWeight: '500', color: colors.textMuted, fontSize: 13 },

    context: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, backgroundColor: colors.accentSoft, marginBottom: 24 },
    contextIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    contextCode: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5, color: colors.textPrimary },
    contextStore: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

    optionList: { gap: 10 },
    option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    optionActive: { borderColor: colors.accent, backgroundColor: colors.bg },
    optionIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    optionIconActive: { backgroundColor: colors.accent },
    optionText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    radio: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.borderStrong },
    radioActive: { borderColor: colors.accent, backgroundColor: colors.accent },

    textAreaWrap: { borderRadius: 22, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.surfaceElevated },
    textAreaFocused: { borderColor: colors.accent, backgroundColor: colors.bg },
    textArea: { minHeight: 110, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, fontSize: 15, lineHeight: 22, color: colors.textPrimary },

    calendarCard: { padding: 14, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    pickedDate: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', height: 36, paddingHorizontal: 14, borderRadius: 18, marginTop: 12, backgroundColor: colors.accentSoft },
    pickedDateText: { fontSize: 13, fontWeight: '800', color: colors.accent },
    onAccent: { color: '#ffffff' },

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
    summaryNote: { marginTop: 12, padding: 16, borderRadius: 22, backgroundColor: colors.surfaceElevated },

    navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingTop: spacing.sm, backgroundColor: colors.bg },
    navBack: { height: 56, borderRadius: 28, paddingHorizontal: 24, backgroundColor: colors.surfaceElevated },
    navNext: { flex: 1, height: 56, borderRadius: 28 },

    successRing: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: 6 },
    successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    successTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    codeCard: { alignItems: 'center', gap: 4, alignSelf: 'stretch', paddingVertical: 18, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    codeLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
    successCode: { fontSize: 24, fontWeight: '800', letterSpacing: 1.5, color: colors.accent },
    successNote: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
  });
}
