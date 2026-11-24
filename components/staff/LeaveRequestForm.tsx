import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, Modal, Alert, Image, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { AppText as Text, AppTextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import DateGrid from '@/components/ui/DateGrid';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { shrinkForUpload } from '@/lib/image-compress';
import { toLocalDateString } from '@/lib/dates';
import { useAppTheme } from '@/lib/theme-context';
import { formatTimeInput, isInvalidTime, INVALID_TIME_MESSAGE } from '@/lib/time-input';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';

/**
 * Form "Ajukan Izin/Cuti" layar penuh (dirombak 2026-10-30): jenis dipilih dari kartu yang menampilkan aturannya, tanggal lewat dua
 * kartu besar + kalender + pintasan lama, dan ringkasan pengajuan selalu terlihat di bawah dekat tombol Kirim. Aturan validasi sama
 * dengan sebelumnya; server tetap sumber kebenaran akhir.
 */

export interface LeaveTypeOption {
  id: number;
  name: string;
  category: 'izin' | 'sakit' | 'cuti';
  deducts_annual_quota: boolean;
  max_days: number | null;
  document_required_from_days: number | null;
  notes: string | null;
  rule_summary: string;
}

interface Attachment {
  uri: string;
  name: string;
  mimeType: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  leaveTypes: LeaveTypeOption[];
  cutiQuota: number;
  cutiUsed: number;
}

// Sama persis LeaveRequest::MAX_DURATION_DAYS di backend (validasi cepat sisi app saja).
const MAX_DURATION_DAYS = 30;
// Sakit boleh diajukan susulan sampai sekian hari ke belakang; izin dan cuti harus sebelum hari H (sama dengan server).
const SICK_BACKDATE_DAYS = 1;
const MAX_REASON = 1000;

const CATEGORY_ICON: Record<LeaveTypeOption['category'], keyof typeof Ionicons.glyphMap> = {
  izin: 'document-text-outline',
  sakit: 'medkit-outline',
  cuti: 'calendar-outline',
};

// Ikon per jenis, dipilih dari kata kunci nama (nama bisa diubah staf di panel); jenis yang tidak dikenali memakai ikon kategorinya.
const NAME_ICONS: [string, keyof typeof Ionicons.glyphMap][] = [
  ['tahunan', 'calendar-outline'],
  ['haid', 'water-outline'],
  ['istri', 'man-outline'],
  ['keguguran', 'heart-dislike-outline'],
  ['melahirkan', 'woman-outline'],
  ['menikahkan', 'people-outline'],
  ['menikah', 'diamond-outline'],
  ['khitan', 'happy-outline'],
  ['baptis', 'happy-outline'],
  ['meninggal', 'flower-outline'],
  ['ibadah', 'book-outline'],
];

export function leaveTypeIcon(name: string | null | undefined, category: LeaveTypeOption['category']): keyof typeof Ionicons.glyphMap {
  const lower = (name ?? '').toLowerCase();

  return NAME_ICONS.find(([word]) => lower.includes(word))?.[1] ?? CATEGORY_ICON[category];
}

const QUICK_DURATIONS = [1, 2, 3, 7];

// Izin Sebagian Hari (2026-11-18): digabung ke form ini sebagai pilihan "Sebagian hari"; datanya tetap pengajuan terpisah di server
// (PartialLeaveRequestService). Batas hari sama dengan server.
type PartialCategory = 'late_arrival' | 'leave_office' | 'early_leave';

const PARTIAL_CATEGORIES: { value: PartialCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'late_arrival', label: 'Terlambat Masuk Kerja', icon: 'log-in-outline' },
  { value: 'leave_office', label: 'Keluar Lingkungan Kantor', icon: 'walk-outline' },
  { value: 'early_leave', label: 'Pulang Cepat', icon: 'log-out-outline' },
];
const PARTIAL_MAX_DAYS_BACK = 3;
const PARTIAL_MAX_DAYS_AHEAD = 14;
const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);

  return h * 60 + m;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);

  return next;
}

function key(date: Date): string {
  return toLocalDateString(date);
}

function fromKey(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);

  return new Date(y, m - 1, d);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000) + 1;
}

function shortRange(start: Date, end: Date): string {
  const fmt = (d: Date, withYear: boolean) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });

  return key(start) === key(end) ? fmt(start, true) : `${fmt(start, false)} – ${fmt(end, true)}`;
}

export default function LeaveRequestForm({ visible, onClose, onSubmitted, leaveTypes, cutiQuota, cutiUsed }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const insets = useSafeAreaInsets();

  // Tinggi keyboard dilacak manual (KeyboardAvoidingView bawaan terbukti tidak andal di sheet/modal app ini, lihat PickerModal).
  // Kartu diangkat tepat di atas keyboard tanpa mengangkat dua kali bila sistem sudah mengecilkan window modal (lihat lib/use-keyboard-lift.ts).
  const { keyboardVisible, lift, onBoxLayout } = useKeyboardLift();

  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [typeId, setTypeId] = useState<number | null>(null);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => startOfDay(new Date()));
  const [endDate, setEndDate] = useState(() => startOfDay(new Date()));
  const [calendar, setCalendar] = useState<'start' | 'end' | null>(null);
  const [reason, setReason] = useState('');
  const [document, setDocument] = useState<Attachment | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sehari penuh (izin, sakit, cuti) atau sebagian hari (telat masuk, keluar kantor, pulang cepat).
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [pCategory, setPCategory] = useState<PartialCategory>('late_arrival');
  const [pDate, setPDate] = useState(() => startOfDay(new Date()));
  const [pTime, setPTime] = useState('');
  const [pStart, setPStart] = useState('');
  const [pEnd, setPEnd] = useState('');

  // Setiap form dibuka: bersih, jenis pertama kategori "izin" terpilih (atau jenis pertama).
  useEffect(() => {
    if (!visible) return;
    setTypeId(leaveTypes.find((t) => t.category === 'izin')?.id ?? leaveTypes[0]?.id ?? null);
    setStartDate(startOfDay(new Date()));
    setEndDate(startOfDay(new Date()));
    setCalendar(null);
    setTypeMenuOpen(false);
    setReason('');
    setDocument(null);
    setMode('full');
    setPCategory('late_arrival');
    setPDate(startOfDay(new Date()));
    setPTime('');
    setPStart('');
    setPEnd('');
    // leaveTypes sengaja tidak jadi dependency: daftar yang baru selesai dimuat tidak boleh menimpa isian yang sedang diketik.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (typeId === null && leaveTypes.length > 0) {
      setTypeId(leaveTypes.find((t) => t.category === 'izin')?.id ?? leaveTypes[0].id);
    }
  }, [leaveTypes, typeId]);

  // "Sampai" tidak boleh sebelum "Dari": bila "Dari" digeser melewatinya, ikut maju.
  useEffect(() => {
    if (key(endDate) < key(startDate)) setEndDate(startDate);
  }, [startDate, endDate]);
  const type = useMemo(() => leaveTypes.find((t) => t.id === typeId) ?? null, [leaveTypes, typeId]);
  const dayCount = daysBetween(startDate, endDate);
  const maxDays = type?.max_days || MAX_DURATION_DAYS;
  const tooLong = dayCount > maxDays;
  // Hanya sakit yang boleh diajukan susulan (sama dengan LeaveRequest::SICK_BACKDATE_DAYS di server).
  const daysBack = type?.category === 'sakit' ? SICK_BACKDATE_DAYS : 0;

  // Berpindah dari sakit ke jenis lain saat tanggal sudah di masa lalu: kembali ke hari ini, karena hanya sakit yang boleh susulan.
  useEffect(() => {
    const todayStart = startOfDay(new Date());
    if (type && type.category !== 'sakit' && key(startDate) < key(todayStart)) {
      setStartDate(todayStart);
      setEndDate(todayStart);
    }
  }, [type, startDate]);
  const needsDocument = !!type && type.document_required_from_days !== null && dayCount >= type.document_required_from_days;
  const mayNeedDocumentLater = !!type && type.document_required_from_days !== null && !needsDocument;
  const remainingQuota = Math.max(0, cutiQuota - cutiUsed);
  const afterQuota = remainingQuota - dayCount;
  const overQuota = !!type?.deducts_annual_quota && afterQuota < 0;

  const setDuration = (days: number) => {
    if (days > maxDays) {
      setEndDate(addDays(startDate, maxDays - 1));

      return;
    }
    setEndDate(addDays(startDate, days - 1));
  };

  const pickImage = useCallback(async () => {
    if (Platform.OS === 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Izin Galeri Diperlukan', 'Aktifkan izin galeri di pengaturan HP untuk melampirkan foto.');

        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    // Foto lampiran dikecilkan (tulisan surat tetap terbaca) sebelum dikirim. PDF tidak disentuh.
    const shrunk = await shrinkForUpload(asset, asset.fileName ?? `lampiran-${Date.now()}.jpg`);
    setDocument({ uri: shrunk.uri, name: shrunk.name, mimeType: shrunk.type });
  }, []);

  const pickPdf = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setDocument({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/pdf' });
  }, []);

  const pickAttachment = useCallback(() => {
    Alert.alert('Lampirkan Dokumen', 'Pilih jenis lampiran', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Foto dari Galeri', onPress: pickImage },
      { text: 'File PDF', onPress: pickPdf },
    ]);
  }, [pickImage, pickPdf]);

  const submit = useCallback(async () => {
    if (!reason.trim()) {
      Alert.alert('Alasan Wajib Diisi', 'Tuliskan alasan pengajuan izin/cuti ini.');

      return;
    }
    if (tooLong) {
      Alert.alert(
        'Durasi Terlalu Panjang',
        type?.max_days ? `${type.name} maksimal ${maxDays} hari.` : `Durasi pengajuan maksimal ${MAX_DURATION_DAYS} hari. Hubungi admin untuk kasus khusus di luar itu.`
      );

      return;
    }
    if (needsDocument && !document) {
      Alert.alert('Lampiran Wajib', `${type?.name} untuk ${dayCount} hari wajib melampirkan dokumen pendukung (mis. surat dokter).`);

      return;
    }

    setSubmitting(true);
    try {
      // Multipart hanya bila ada lampiran; selain itu JSON biasa (staffApiFetch melepas Content-Type untuk FormData).
      let body: FormData | string;
      if (document) {
        const form = new FormData();
        if (type) form.append('leave_type_id', String(type.id));
        else form.append('type', 'izin');
        form.append('start_date', key(startDate));
        form.append('end_date', key(endDate));
        form.append('reason', reason.trim());
        form.append('document', { uri: document.uri, name: document.name, type: document.mimeType } as unknown as Blob);
        body = form;
      } else {
        body = JSON.stringify({
          ...(type ? { leave_type_id: type.id } : { type: 'izin' }),
          start_date: key(startDate),
          end_date: key(endDate),
          reason: reason.trim(),
        });
      }

      await staffApiFetch('/api/staff/leave-requests', { method: 'POST', body });
      onClose();
      onSubmitted();
      Alert.alert('Pengajuan Terkirim', 'Menunggu keputusan penyetuju. Pemberitahuan akan dikirim begitu diputuskan.');
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [reason, tooLong, type, maxDays, needsDocument, document, dayCount, startDate, endDate, onClose, onSubmitted]);

  const pMinKey = key(addDays(startOfDay(new Date()), -PARTIAL_MAX_DAYS_BACK));
  const pMaxKey = key(addDays(startOfDay(new Date()), PARTIAL_MAX_DAYS_AHEAD));
  const pIsRange = pCategory === 'leave_office';
  const pTimeOk = pIsRange
    ? TIME_FORMAT.test(pStart.trim()) && TIME_FORMAT.test(pEnd.trim()) && toMinutes(pEnd.trim()) > toMinutes(pStart.trim())
    : TIME_FORMAT.test(pTime.trim());
  const partialValid = reason.trim().length > 0 && pTimeOk;
  const pCategoryLabel = PARTIAL_CATEGORIES.find((c) => c.value === pCategory)?.label ?? '';

  const stepPartialDate = (delta: number) => {
    const next = addDays(pDate, delta);
    if (key(next) < pMinKey || key(next) > pMaxKey) return;
    setPDate(next);
  };

  const submitPartial = async () => {
    if (!partialValid || submitting) return;
    setSubmitting(true);
    try {
      await staffApiFetch('/api/staff/partial-leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          date: key(pDate),
          category: pCategory,
          time: pIsRange ? undefined : pTime.trim(),
          start_time: pIsRange ? pStart.trim() : undefined,
          end_time: pIsRange ? pEnd.trim() : undefined,
          reason: reason.trim(),
        }),
      });
      onClose();
      onSubmitted();
      Alert.alert('Pengajuan Terkirim', 'Menunggu keputusan penyetuju. Pemberitahuan akan dikirim begitu diputuskan.');
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const dateTile = (which: 'start' | 'end', label: string, date: Date) => {
    const open = calendar === which;

    return (
      <Pressable
        style={[styles.dateTile, open && styles.dateTileOpen]}
        onPress={() => setCalendar(open ? null : which)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${date.toLocaleDateString('id-ID', { dateStyle: 'full' })}. Ketuk untuk memilih dari kalender`}
      >
        <Text style={styles.dateTileLabel}>{label}</Text>
        <Text style={styles.dateTileDay}>{date.getDate()}</Text>
        <Text style={styles.dateTileMonth} numberOfLines={1}>{date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</Text>
        <Text style={styles.dateTileWeekday} numberOfLines={1}>{date.toLocaleDateString('id-ID', { weekday: 'long' })}</Text>
      </Pressable>
    );
  };

  // Judul kartu bagian: ubin ikon + nama, sama dengan formulir SPK.
  const sectionHeader = (icon: keyof typeof Ionicons.glyphMap, title: string, right?: React.ReactNode) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}>
        <Ionicons name={icon} size={18} color={accentText} />
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top }]} onLayout={onBoxLayout}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Tutup">
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>Ajukan Izin / Cuti</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Sehari penuh atau sebagian hari */}
          <View style={styles.modeRow}>
            {([['full', 'Sehari penuh'], ['partial', 'Sebagian hari']] as const).map(([value, label]) => {
              const active = mode === value;

              return (
                <Pressable key={value} style={[styles.modeOption, active && styles.modeOptionActive]} onPress={() => { setCalendar(null); setMode(value); }} accessibilityRole="button" accessibilityState={{ selected: active }}>
                  <Text style={[styles.modeOptionText, active && styles.modeOptionTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'full' ? (
            <>
          {/* Jenis */}
          <View style={styles.section}>
            {sectionHeader('layers-outline', 'Jenis')}
            <Pressable
              style={[styles.select, typeMenuOpen && styles.selectOpen]}
              onPress={() => { setCalendar(null); setTypeMenuOpen(true); }}
              accessibilityRole="button"
              accessibilityLabel={`Jenis: ${type?.name ?? 'belum dipilih'}. Ketuk untuk mengganti`}
            >
              <View style={styles.typeIcon}>
                <Ionicons name={type ? leaveTypeIcon(type.name, type.category) : 'help-outline'} size={20} color={accentText} />
              </View>
              <View style={styles.typeText}>
                <Text style={styles.typeName} numberOfLines={1}>{type?.name ?? 'Pilih jenis'}</Text>
                {type?.rule_summary ? <Text style={styles.typeRule} numberOfLines={2}>{type.rule_summary}</Text> : null}
              </View>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </Pressable>
            {type?.notes ? (
              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={17} color={accentText} />
                <Text style={styles.noteText}>{type.notes}</Text>
              </View>
            ) : null}
          </View>

          {/* Tanggal */}
          <View style={styles.section}>
            {sectionHeader('calendar-outline', 'Tanggal', (
              <View style={[styles.durationPill, tooLong && styles.durationPillBad]}>
                <Text style={[styles.durationText, tooLong && { color: colors.danger }]}>{dayCount} hari</Text>
              </View>
            ))}

            <View style={styles.dateTiles}>
              {dateTile('start', 'MULAI', startDate)}
              <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
              {dateTile('end', 'SELESAI', endDate)}
            </View>

            <View style={styles.quickRow}>
              {QUICK_DURATIONS.map((n) => (
                <Pressable key={n} style={[styles.quickChip, dayCount === n && styles.quickChipActive]} onPress={() => setDuration(n)} accessibilityRole="button" accessibilityLabel={`Lama ${n} hari`}>
                  <Text style={[styles.quickChipText, dayCount === n && styles.quickChipTextActive]}>{n} hari</Text>
                </Pressable>
              ))}
            </View>

            {calendar === 'start' ? (
              <View style={styles.calendarWrap}>
                <DateGrid
                  value={key(startDate)}
                  onChange={(k) => { setStartDate(fromKey(k)); setCalendar(null); }}
                  daysAhead={366}
                  daysBack={daysBack}
                  colors={colors}
                />
              </View>
            ) : null}
            {calendar === 'end' ? (
              <View style={styles.calendarWrap}>
                <DateGrid
                  value={key(endDate)}
                  onChange={(k) => { setEndDate(fromKey(k)); setCalendar(null); }}
                  daysAhead={366}
                  daysBack={daysBack}
                  disabledDates={Array.from({ length: 366 + daysBack }, (_, i) => key(addDays(startOfDay(new Date()), i - daysBack))).filter((k) => k < key(startDate))}
                  colors={colors}
                />
              </View>
            ) : null}

            {tooLong ? (
              <View style={[styles.note, styles.noteDanger]}>
                <Ionicons name="alert-circle-outline" size={17} color={colors.danger} />
                <Text style={[styles.noteText, { color: colors.danger }]}>
                  {type?.max_days ? `${type.name} maksimal ${maxDays} hari.` : `Durasi maksimal ${MAX_DURATION_DAYS} hari. Hubungi admin untuk kasus khusus.`}
                </Text>
              </View>
            ) : null}
            {daysBack > 0 && key(startDate) < key(startOfDay(new Date())) ? (
              <View style={styles.note}>
                <Ionicons name="information-circle-outline" size={17} color={accentText} />
                <Text style={styles.noteText}>Pengajuan susulan: tanggal yang sudah lewat akan diperiksa atasan sebelum disetujui.</Text>
              </View>
            ) : null}
            {type?.deducts_annual_quota ? (
              <View style={[styles.note, overQuota && styles.noteDanger]}>
                <Ionicons name="calendar-clear-outline" size={17} color={overQuota ? colors.danger : accentText} />
                <Text style={[styles.noteText, overQuota && { color: colors.danger }]}>
                  Sisa jatah cuti {remainingQuota} hari.{' '}
                  {overQuota ? `Pengajuan ${dayCount} hari melebihi jatah.` : `Setelah pengajuan ini tersisa ${afterQuota} hari.`}
                </Text>
              </View>
            ) : null}
          </View>

            </>
          ) : (
            <>
              {/* Kategori */}
              <View style={styles.section}>
                {sectionHeader('layers-outline', 'Kategori')}
                <View style={styles.categoryList}>
                  {PARTIAL_CATEGORIES.map((c) => {
                    const active = pCategory === c.value;

                    return (
                      <Pressable key={c.value} style={[styles.categoryRow, active && styles.categoryRowActive]} onPress={() => setPCategory(c.value)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                        <View style={[styles.typeIcon, active && styles.typeIconActive]}>
                          <Ionicons name={c.icon} size={20} color={active ? '#ffffff' : accentText} />
                        </View>
                        <Text style={styles.categoryLabel}>{c.label}</Text>
                        {active ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Tanggal dan jam */}
              <View style={styles.section}>
                {sectionHeader('calendar-outline', 'Tanggal dan jam')}
                <View style={styles.dateStepper}>
                  <Pressable style={[styles.stepButton, key(pDate) <= pMinKey && styles.stepButtonDisabled]} onPress={() => stepPartialDate(-1)} hitSlop={8} disabled={key(pDate) <= pMinKey} accessibilityRole="button" accessibilityLabel="Hari sebelumnya">
                    <Ionicons name="chevron-back" size={18} color={key(pDate) <= pMinKey ? colors.textMuted : colors.textPrimary} />
                  </Pressable>
                  <Text style={styles.stepDateText} numberOfLines={2}>{pDate.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                  <Pressable style={[styles.stepButton, key(pDate) >= pMaxKey && styles.stepButtonDisabled]} onPress={() => stepPartialDate(1)} hitSlop={8} disabled={key(pDate) >= pMaxKey} accessibilityRole="button" accessibilityLabel="Hari berikutnya">
                    <Ionicons name="chevron-forward" size={18} color={key(pDate) >= pMaxKey ? colors.textMuted : colors.textPrimary} />
                  </Pressable>
                </View>

                {pIsRange ? (
                  <View style={styles.timeRow}>
                    <View style={styles.timeTile}>
                      <Text style={styles.timeLabel}>Keluar</Text>
                      <AppTextInput style={[styles.timeInput, isInvalidTime(pStart) && { color: colors.danger }]} value={pStart} onChangeText={(v) => setPStart((prev) => formatTimeInput(v, prev))} placeholder="12:00" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={5} />
                    </View>
                    <View style={styles.timeTile}>
                      <Text style={styles.timeLabel}>Kembali</Text>
                      <AppTextInput style={[styles.timeInput, isInvalidTime(pEnd) && { color: colors.danger }]} value={pEnd} onChangeText={(v) => setPEnd((prev) => formatTimeInput(v, prev))} placeholder="14:00" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={5} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.timeTile}>
                    <Text style={styles.timeLabel}>{pCategory === 'late_arrival' ? 'Masuk paling lambat jam' : 'Mulai pulang jam'}</Text>
                    <AppTextInput style={[styles.timeInput, isInvalidTime(pTime) && { color: colors.danger }]} value={pTime} onChangeText={(v) => setPTime((prev) => formatTimeInput(v, prev))} placeholder={pCategory === 'late_arrival' ? '10:00' : '15:00'} placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={5} />
                  </View>
                )}
                <Text style={[styles.attachHint, (isInvalidTime(pStart) || isInvalidTime(pEnd) || isInvalidTime(pTime)) && { color: colors.danger }]}>{isInvalidTime(pStart) || isInvalidTime(pEnd) || isInvalidTime(pTime) ? INVALID_TIME_MESSAGE : 'Format 24 jam (HH:MM).'}</Text>
              </View>
            </>
          )}

          {/* Alasan */}
          <View style={styles.section}>
            {sectionHeader('chatbox-ellipses-outline', 'Alasan')}
            <View style={styles.inputWrap}>
              <AppTextInput
                style={styles.textArea}
                value={reason}
                onChangeText={(v) => setReason(v.slice(0, MAX_REASON))}
                placeholder={type?.category === 'sakit' ? 'Keluhan singkat dan perkiraan pulih…' : 'Tuliskan alasan pengajuan…'}
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.counter}>{reason.length}/{MAX_REASON}</Text>
            </View>
          </View>

          {/* Lampiran */}
          {mode === 'full' ? (
          <View style={styles.section}>
            {sectionHeader('attach-outline', 'Lampiran', needsDocument ? (
              <View style={styles.requiredBadge}><Text style={styles.requiredBadgeText}>WAJIB</Text></View>
            ) : undefined)}
            {mayNeedDocumentLater ? (
              <Text style={styles.attachHint}>Wajib bila {type?.name} {type?.document_required_from_days} hari atau lebih.</Text>
            ) : null}
            {document ? (
              <View style={styles.attachmentCard}>
                {document.mimeType === 'application/pdf' ? (
                  <View style={[styles.attachmentThumb, styles.attachmentPdf]}>
                    <Ionicons name="document-text-outline" size={22} color={accentText} />
                  </View>
                ) : (
                  <Image source={{ uri: document.uri }} style={styles.attachmentThumb} />
                )}
                <View style={styles.attachmentInfo}>
                  <Text style={styles.attachmentName} numberOfLines={1}>{document.name}</Text>
                  <Text style={styles.attachmentKind}>{document.mimeType === 'application/pdf' ? 'Dokumen PDF' : 'Foto'}</Text>
                </View>
                <Pressable onPress={() => setDocument(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hapus lampiran">
                  <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                </Pressable>
              </View>
            ) : (
              <Pressable style={[styles.attachButton, needsDocument && styles.attachButtonRequired]} onPress={pickAttachment} accessibilityRole="button">
                <View style={styles.attachIcon}>
                  <Ionicons name="cloud-upload-outline" size={22} color={accentText} />
                </View>
                <Text style={styles.attachButtonText}>
                  {type?.category === 'sakit' ? 'Unggah surat dokter' : 'Unggah dokumen pendukung'}
                </Text>
                <Text style={styles.attachButtonSub}>Foto atau PDF</Text>
              </Pressable>
            )}
          </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { marginBottom: lift, paddingBottom: keyboardVisible ? spacing.sm : Math.max(insets.bottom, 12) }]}>
          <View style={styles.summary}>
            <Text style={styles.summaryTitle} numberOfLines={1}>{mode === 'partial' ? pCategoryLabel : `${type?.name ?? 'Izin'} · ${dayCount} hari`}</Text>
            <Text style={styles.summarySub} numberOfLines={1}>{mode === 'partial' ? shortRange(pDate, pDate) : shortRange(startDate, endDate)}</Text>
          </View>
          <PressableScale
            style={[styles.submit, (submitting || (mode === 'partial' ? !partialValid : overQuota)) && styles.submitDisabled]}
            onPress={mode === 'partial' ? submitPartial : submit}
            disabled={submitting || (mode === 'partial' ? !partialValid : overQuota)}
            accessibilityRole="button"
            accessibilityLabel="Kirim pengajuan"
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.submitText}>Kirim</Text>
                <Ionicons name="paper-plane-outline" size={18} color="#ffffff" />
              </>
            )}
          </PressableScale>
        </View>
      </View>

      <Modal visible={typeMenuOpen} transparent animationType="fade" onRequestClose={() => setTypeMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setTypeMenuOpen(false)}>
          <Pressable style={[styles.menuSheet, { paddingBottom: spacing.md + insets.bottom }]} onPress={() => undefined}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>Pilih jenis</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {leaveTypes.map((t) => {
                const active = t.id === typeId;

                return (
                  <Pressable
                    key={t.id}
                    style={[styles.menuItem, active && styles.menuItemActive]}
                    onPress={() => { setTypeId(t.id); setTypeMenuOpen(false); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={[styles.typeIcon, active && styles.typeIconActive]}>
                      <Ionicons name={leaveTypeIcon(t.name, t.category)} size={20} color={active ? '#ffffff' : accentText} />
                    </View>
                    <View style={styles.typeText}>
                      <Text style={styles.typeName}>{t.name}</Text>
                      {t.rule_summary ? <Text style={styles.typeRule} numberOfLines={2}>{t.rule_summary}</Text> : null}
                    </View>
                    {active ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan halaman Izin & Cuti, Beranda, dan formulir SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerTitle: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    content: { paddingHorizontal: 20, paddingBottom: spacing.xl, gap: 16 },

    modeRow: { flexDirection: 'row', gap: 6, padding: 5, borderRadius: radius.pill, backgroundColor: chip },
    modeOption: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    modeOptionActive: { backgroundColor: card, ...shadow },
    modeOptionText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textMuted },
    modeOptionTextActive: { color: colors.textPrimary },
    categoryList: { gap: 8 },
    categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: chip },
    categoryRowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    categoryLabel: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
    dateStepper: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 20, backgroundColor: chip },
    stepButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: card },
    stepButtonDisabled: { opacity: 0.5 },
    stepDateText: { flex: 1, textAlign: 'center', fontSize: fontSize.sm + 1, fontWeight: '700', lineHeight: 21, color: colors.textPrimary, textTransform: 'capitalize' },
    timeRow: { flexDirection: 'row', gap: 12 },
    timeTile: { flex: 1, gap: 6, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 20, backgroundColor: chip },
    timeLabel: { textAlign: 'center', fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
    timeInput: { height: 48, padding: 0, textAlign: 'center', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, fontVariant: ['tabular-nums'] },

    section: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sectionIcon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    sectionTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },

    select: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: chip },
    selectOpen: { borderColor: colors.accent },
    typeIcon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    typeIconActive: { backgroundColor: colors.accent },
    typeText: { flex: 1, gap: 2 },
    typeName: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    typeRule: { fontSize: 12.5, fontWeight: '500', lineHeight: 18, color: colors.textMuted },

    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 16, backgroundColor: colors.accentSoft },
    noteDanger: { backgroundColor: colors.dangerBg },
    noteText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 18, color: colors.textSecondary },

    durationPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    durationPillBad: { backgroundColor: colors.dangerBg },
    durationText: { fontSize: 12.5, fontWeight: '800', color: accentText, fontVariant: ['tabular-nums'] },

    dateTiles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dateTile: { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, borderRadius: 20, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: chip },
    dateTileOpen: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    dateTileLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: colors.textMuted },
    dateTileDay: { fontSize: 38, fontWeight: '800', letterSpacing: -1.2, lineHeight: 44, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    dateTileMonth: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary, textTransform: 'capitalize' },
    dateTileWeekday: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted, textTransform: 'capitalize' },

    quickRow: { flexDirection: 'row', gap: 8 },
    quickChip: { flex: 1, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    quickChipActive: { backgroundColor: colors.accent },
    quickChipText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
    quickChipTextActive: { color: '#ffffff' },
    calendarWrap: { marginTop: 2 },

    inputWrap: { gap: 6, padding: 14, borderRadius: 20, backgroundColor: chip },
    textArea: { minHeight: 104, padding: 0, fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textPrimary },
    counter: { alignSelf: 'flex-end', fontSize: 11.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },

    requiredBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.dangerBg },
    requiredBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.danger },
    attachHint: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
    attachButton: {
      alignItems: 'center', gap: 4, paddingVertical: 22, borderRadius: 20,
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.borderStrong, backgroundColor: 'transparent',
    },
    attachButtonRequired: { borderColor: colors.danger },
    attachIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4, backgroundColor: colors.accentSoft },
    attachButtonText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
    attachButtonSub: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
    attachmentCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, backgroundColor: chip },
    attachmentThumb: { width: 52, height: 52, borderRadius: 16 },
    attachmentPdf: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    attachmentInfo: { flex: 1, gap: 2 },
    attachmentName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    attachmentKind: { fontSize: 12, fontWeight: '500', color: colors.textMuted },

    footer: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 20, paddingTop: 12,
      borderTopWidth: 1, borderTopColor: line, backgroundColor: screenBg,
    },
    summary: { flex: 1, gap: 2 },
    summaryTitle: { fontSize: fontSize.sm + 1, fontWeight: '800', color: colors.textPrimary },
    summarySub: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    submit: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 132, height: 52, paddingHorizontal: 24, borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.26, shadowRadius: 16, elevation: 4,
    },
    submitDisabled: { opacity: 0.55 },
    submitText: { fontSize: fontSize.base, fontWeight: '700', color: '#ffffff' },

    // Pilih jenis (lembar bawah)
    menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    menuSheet: { maxHeight: '78%', paddingHorizontal: 20, paddingTop: 12, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: isDark ? colors.bg : '#ffffff' },
    menuHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14, backgroundColor: colors.borderStrong },
    menuTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, marginBottom: 8, color: colors.textPrimary },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20 },
    menuItemActive: { backgroundColor: colors.accentSoft },
  });
}
