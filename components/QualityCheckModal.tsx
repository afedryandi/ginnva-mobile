import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { ApiError, staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface QcItem {
  id: number;
  label: string;
  is_required: boolean;
}

interface QcService {
  key: string;
  label: string;
  items: QcItem[];
}

interface QcData {
  services: QcService[];
  latest: {
    passed: boolean;
    inspector: string | null;
    notes: string | null;
    created_at: string | null;
    failed_items: { label: string; note: string | null }[];
  } | null;
  ready_at: string | null;
  can_inspect: boolean;
  cannot_inspect_reason: string | null;
  required: boolean;
}

interface Props {
  visible: boolean;
  bookingId: number;
  onClose: () => void;
  // Dipanggil setelah hasil tersimpan (lulus atau tidak), supaya layar induk bisa memuat ulang.
  onSubmitted?: (passed: boolean) => void;
}

type Answer = { passed: boolean | null; note: string };

/**
 * Quality Check (Fase 3A): daftar periksa per layanan. Pemeriksa (Leader/Store Manager, bukan pengerja unit) menandai tiap
 * butir lulus atau tidak; butir yang tidak lulus wajib diberi catatan perbaikan. Akun yang tidak boleh memeriksa melihat
 * hasil terakhir dan alasannya, tanpa tombol kirim.
 */
export default function QualityCheckModal({ visible, bookingId, onClose, onSubmitted }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [data, setData] = useState<QcData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<{ data: QcData }>(`/api/staff/bookings/${bookingId}/qc`);
      setData(res.data);
      setAnswers({});
      setNotes('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak bisa memuat daftar periksa. Periksa koneksi internet.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const items = data?.services.flatMap((s) => s.items) ?? [];
  const unanswered = items.filter((i) => answers[i.id]?.passed == null).length;
  const needsNote = items.filter((i) => answers[i.id]?.passed === false && !answers[i.id]?.note.trim()).length;
  const canSubmit = !!data?.can_inspect && items.length > 0 && unanswered === 0 && needsNote === 0 && !submitting;

  const setAnswer = (id: number, patch: Partial<Answer>) =>
    setAnswers((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { passed: null, note: '' }), ...patch } }));

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await staffApiFetch<{ message: string; data: { passed: boolean } }>(`/api/staff/bookings/${bookingId}/qc`, {
        method: 'POST',
        body: JSON.stringify({
          results: items.map((i) => ({ item_id: i.id, passed: answers[i.id].passed, note: answers[i.id].note.trim() || null })),
          notes: notes.trim() || null,
        }),
      });
      Alert.alert(res.data.passed ? 'Lulus' : 'Belum lulus', res.message);
      onSubmitted?.(res.data.passed);
      onClose();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menyimpan hasil. Periksa koneksi internet.');
    } finally {
      setSubmitting(false);
    }
  };

  const answered = items.length - unanswered;
  const progress = items.length > 0 ? answered / items.length : 0;
  const footerHint =
    unanswered > 0
      ? `${unanswered} butir belum dijawab`
      : needsNote > 0
        ? `${needsNote} butir tidak lulus belum ada catatan`
        : 'Semua butir sudah dijawab';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Tutup">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.title}>Quality Check</Text>
          </View>

          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
          ) : error ? (
            <View style={styles.center}>
              <View style={styles.errorIcon}><Ionicons name="cloud-offline-outline" size={36} color={colors.danger} /></View>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                <Text style={styles.retryText}>Coba lagi</Text>
              </Pressable>
            </View>
          ) : data ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {data.latest && (
                <View style={styles.card}>
                  <View style={styles.resultRow}>
                    <View style={[styles.resultIcon, { backgroundColor: data.latest.passed ? colors.success : colors.danger }]}>
                      <Ionicons name={data.latest.passed ? 'checkmark' : 'close'} size={20} color="#ffffff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle}>{data.latest.passed ? 'Pemeriksaan terakhir lulus' : 'Pemeriksaan terakhir belum lulus'}</Text>
                      {!!data.latest.inspector && <Text style={styles.byline}>Oleh {data.latest.inspector}</Text>}
                    </View>
                  </View>
                  {data.latest.failed_items.map((f, i) => (
                    <Text key={i} style={styles.failedItem}>{f.label}{f.note ? ` · ${f.note}` : ''}</Text>
                  ))}
                </View>
              )}

              {/* Alasan "belum bisa ditandai" (tahap produk belum selesai) tidak ditampilkan; alasan peran akun tetap. */}
              {!data.can_inspect && !!data.cannot_inspect_reason && !data.cannot_inspect_reason.includes('belum bisa ditandai') && (
                <View style={styles.card}>
                  <Text style={styles.muted}>{data.cannot_inspect_reason}</Text>
                </View>
              )}

              {data.services.length === 0 && (
                <View style={styles.card}>
                  <Text style={styles.muted}>Belum ada checklist untuk layanan booking ini. Minta admin mengisinya di menu Checklist QC.</Text>
                </View>
              )}

              {data.can_inspect && items.length > 0 && (
                <View style={styles.progressWrap}>
                  <Text style={styles.progressText}>{answered} dari {items.length} butir</Text>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                  </View>
                </View>
              )}

              {data.services.map((service) => (
                <View key={service.key}>
                  <Text style={styles.sectionTitle}>{service.label}</Text>
                  <View style={styles.card}>
                    {service.items.map((item, idx) => {
                      const a = answers[item.id];
                      const last = idx === service.items.length - 1;
                      return (
                        <View key={item.id} style={[styles.item, !last && styles.itemDivider]}>
                          <Text style={styles.itemLabel}>{item.label}{item.is_required ? '' : ' (tidak wajib)'}</Text>
                          {data.can_inspect && (
                            <>
                              <View style={styles.choiceRow}>
                                <Pressable
                                  onPress={() => setAnswer(item.id, { passed: true })}
                                  style={[styles.choice, a?.passed === true && { backgroundColor: colors.success }]}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: a?.passed === true }}
                                >
                                  <Ionicons name="checkmark" size={17} color={a?.passed === true ? '#ffffff' : colors.textMuted} />
                                  <Text style={[styles.choiceText, a?.passed === true && styles.choiceTextOn]}>Lulus</Text>
                                </Pressable>
                                <Pressable
                                  onPress={() => setAnswer(item.id, { passed: false })}
                                  style={[styles.choice, a?.passed === false && { backgroundColor: colors.danger }]}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: a?.passed === false }}
                                >
                                  <Ionicons name="close" size={17} color={a?.passed === false ? '#ffffff' : colors.textMuted} />
                                  <Text style={[styles.choiceText, a?.passed === false && styles.choiceTextOn]}>Tidak lulus</Text>
                                </Pressable>
                              </View>
                              {a?.passed === false && (
                                <TextInput
                                  style={styles.input}
                                  placeholder="Apa yang perlu diperbaiki?"
                                  placeholderTextColor={colors.textMuted}
                                  value={a.note}
                                  onChangeText={(t) => setAnswer(item.id, { note: t })}
                                  maxLength={255}
                                />
                              )}
                            </>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}

              {data.can_inspect && items.length > 0 && (
                <View>
                  <Text style={styles.sectionTitle}>Catatan</Text>
                  <TextInput
                    style={[styles.input, styles.notesInput]}
                    placeholder="Catatan umum pemeriksaan"
                    placeholderTextColor={colors.textMuted}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    textAlignVertical="top"
                    maxLength={1000}
                  />
                </View>
              )}
            </ScrollView>
          ) : null}

          {data?.can_inspect && items.length > 0 && (
            <View style={styles.footer}>
              <Text style={[styles.footerHint, canSubmit && { color: accentText }]}>{footerHint}</Text>
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={[styles.submit, !canSubmit && { opacity: 0.4 }]}
                accessibilityRole="button"
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Kirim Hasil QC</Text>}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: typeof darkColors, isDark: boolean) => {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    title: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 12 },
    errorIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerBg },
    errorText: { fontSize: fontSize.sm + 1, fontWeight: '500', lineHeight: 22, textAlign: 'center', color: colors.textSecondary },
    retry: { height: 46, paddingHorizontal: spacing.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    retryText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: '#ffffff' },
    body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 18 },
    card: { borderRadius: 26, paddingHorizontal: 18, paddingVertical: 6, backgroundColor: card, ...shadow },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    resultIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    resultTitle: { fontSize: 15.5, fontWeight: '800', color: colors.textPrimary },
    byline: { marginTop: 2, fontSize: 13, fontWeight: '500', color: colors.textMuted },
    failedItem: { paddingBottom: 12, fontSize: 13.5, lineHeight: 20, color: colors.textSecondary },
    muted: { paddingVertical: 12, fontSize: 13.5, lineHeight: 20, fontWeight: '500', color: colors.textMuted },
    progressWrap: { gap: 8 },
    progressText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: chip },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    sectionTitle: { marginBottom: 10, marginLeft: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    item: { gap: 12, paddingVertical: 16 },
    itemDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
    itemLabel: { fontSize: 15, fontWeight: '700', lineHeight: 21, color: colors.textPrimary },
    choiceRow: { flexDirection: 'row', gap: 10 },
    choice: { flex: 1, height: 46, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    choiceText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
    choiceTextOn: { color: '#ffffff' },
    input: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, backgroundColor: chip, fontSize: fontSize.sm + 1, color: colors.textPrimary },
    notesInput: { minHeight: 104, lineHeight: 22, backgroundColor: card },
    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 10, backgroundColor: screenBg },
    footerHint: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.textMuted },
    submit: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent },
    submitText: { color: '#ffffff', fontWeight: '800', fontSize: fontSize.base },
  });
};
