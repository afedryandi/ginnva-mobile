import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { ApiError, staffApiFetch } from '@/lib/staff-api';
import { shrinkForUpload } from '@/lib/image-compress';
import { useAppTheme } from '@/lib/theme-context';

interface HandoverData {
  handover: {
    care_instructions_given: boolean;
    wet_signature_required: boolean;
    wet_signature_received: boolean;
    final_photo_url: string | null;
    photo_consent?: boolean;
    notes: string | null;
    recorded_by: string | null;
    handed_over_at: string | null;
  } | null;
  wet_signature_required: boolean;
  can_record: boolean;
  cannot_record_reason: string | null;
  required: boolean;
}

interface Props {
  visible: boolean;
  bookingId: number;
  onClose: () => void;
  // Dipanggil setelah serah terima tersimpan, supaya layar induk bisa memuat ulang.
  onRecorded?: () => void;
  // Bila diisi, ringkasan serah terima yang sudah tercatat menampilkan tombol "Selesaikan Booking".
  onProceed?: () => void;
}

/**
 * Serah terima unit (Fase 3B): petunjuk perawatan sudah disampaikan, tanda tangan BASAH (di kertas) sudah diterima — wajib
 * untuk PPF/kaca film, opsional untuk layanan ringan — dan foto akhir opsional. Dicatat sekali per booking.
 */
export default function HandoverModal({ visible, bookingId, onClose, onRecorded, onProceed }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const chipColor = isDark ? colors.surfaceElevated : '#efeff4';

  const [data, setData] = useState<HandoverData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [care, setCare] = useState(false);
  const [signature, setSignature] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<{ data: HandoverData }>(`/api/staff/bookings/${bookingId}/handover`);
      setData(res.data);
      setCare(false);
      setSignature(false);
      setNotes('');
      setPhotoUri(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak bisa memuat data serah terima. Periksa koneksi internet.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Izin kamera diperlukan', 'Aktifkan izin kamera untuk memotret kondisi akhir kendaraan.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      // Foto serah terima dikecilkan sebelum dikirim (hemat memori, kuota, dan penyimpanan).
      const shrunk = await shrinkForUpload(result.assets[0], 'serah-terima.jpg');
      setPhotoUri(shrunk.uri);
    }
  };

  const needsSignature = !!data?.wet_signature_required;
  const canSubmit = !!data?.can_record && care && (!needsSignature || signature) && !submitting;

  const submit = async () => {
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('care_instructions_given', care ? '1' : '0');
      form.append('wet_signature_received', signature ? '1' : '0');
      form.append('photo_consent', photoConsent ? '1' : '0');
      if (notes.trim()) form.append('notes', notes.trim());
      if (photoUri) {
        form.append('photo', { uri: photoUri, name: 'serah-terima.jpg', type: 'image/jpeg' } as unknown as Blob);
      }
      await staffApiFetch(`/api/staff/bookings/${bookingId}/handover`, { method: 'POST', body: form });
      Alert.alert('Berhasil', 'Serah terima dicatat. Booking siap diselesaikan.');
      onRecorded?.();
      if (onProceed) {
        await load();
      } else {
        onClose();
      }
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menyimpan serah terima. Periksa koneksi internet.');
    } finally {
      setSubmitting(false);
    }
  };

  const done = data?.handover;

  const Toggle = ({ on, label, onPress, required }: { on: boolean; label: string; onPress: () => void; required?: boolean }) => (
    <Pressable
      onPress={onPress}
      style={[styles.toggle, on && styles.toggleOn]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <View style={[styles.toggleBox, on && styles.toggleBoxOn]}>
        {on ? <Ionicons name="checkmark" size={18} color="#ffffff" /> : null}
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
      {required ? (
        <View style={styles.requiredPill}><Text style={styles.requiredText}>WAJIB</Text></View>
      ) : null}
    </Pressable>
  );

  const StatusRow = ({ ok, label, last }: { ok: boolean; label: string; last?: boolean }) => (
    <View style={[styles.statusRow, !last && styles.statusDivider]}>
      <View style={[styles.statusIcon, { backgroundColor: ok ? colors.success : chipColor }]}>
        <Ionicons name={ok ? 'checkmark' : 'remove'} size={18} color={ok ? '#ffffff' : colors.textMuted} />
      </View>
      <Text style={styles.statusLabel}>{label}</Text>
    </View>
  );

  const footerHint = !care ? 'Centang petunjuk perawatan dulu' : needsSignature && !signature ? 'Tanda tangan basah wajib diterima' : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Pressable style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Tutup">
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.title}>Serah Terima Unit</Text>
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
              {done ? (
                <>
                  <View style={styles.doneHead}>
                    <View style={styles.doneIcon}><Ionicons name="checkmark" size={30} color="#ffffff" /></View>
                    <Text style={styles.doneTitle}>Serah terima tercatat</Text>
                    <Text style={styles.doneMeta}>
                      {[done.recorded_by, done.handed_over_at ? new Date(done.handed_over_at).toLocaleString('id-ID') : null].filter(Boolean).join(' · ')}
                    </Text>
                  </View>

                  <View style={styles.card}>
                    <StatusRow ok={done.care_instructions_given} label="Petunjuk perawatan disampaikan" />
                    <StatusRow ok={done.wet_signature_received} label="Tanda tangan basah diterima" />
                    <StatusRow ok={!!done.photo_consent} label="Izin foto untuk pemasaran" last />
                  </View>

                  {!!done.notes && (
                    <View>
                      <Text style={styles.sectionTitle}>Catatan</Text>
                      <View style={styles.card}><Text style={styles.noteText}>{done.notes}</Text></View>
                    </View>
                  )}
                  {!!done.final_photo_url && <Image source={{ uri: done.final_photo_url }} style={styles.photo} resizeMode="cover" />}
                </>
              ) : (
                <>
                  {!data.can_record && !!data.cannot_record_reason && (
                    <View style={styles.card}><Text style={styles.muted}>{data.cannot_record_reason}</Text></View>
                  )}

                  {data.can_record && (
                    <>
                      <View style={{ gap: 10 }}>
                        <Toggle on={care} label="Petunjuk perawatan sudah disampaikan kepada pelanggan" onPress={() => setCare((v) => !v)} />
                        <Toggle
                          on={signature}
                          label="Tanda tangan basah serah terima sudah diterima"
                          required={needsSignature}
                          onPress={() => setSignature((v) => !v)}
                        />
                        <Toggle
                          on={photoConsent}
                          label="Pelanggan mengizinkan foto hasil pekerjaan dipakai untuk galeri dan media sosial Ginnva"
                          onPress={() => setPhotoConsent((v) => !v)}
                        />
                      </View>

                      <View>
                        <Text style={styles.sectionTitle}>Foto kondisi akhir</Text>
                        {photoUri ? <Image source={{ uri: photoUri }} style={[styles.photo, { marginBottom: 10 }]} resizeMode="cover" /> : null}
                        <Pressable onPress={pickPhoto} style={styles.photoBtn} accessibilityRole="button">
                          <Ionicons name="camera-outline" size={20} color={colors.textPrimary} />
                          <Text style={styles.photoBtnText}>{photoUri ? 'Ganti foto' : 'Ambil foto'}</Text>
                        </Pressable>
                      </View>

                      <View>
                        <Text style={styles.sectionTitle}>Catatan</Text>
                        <TextInput
                          style={styles.input}
                          placeholder="Catatan serah terima"
                          placeholderTextColor={colors.textMuted}
                          value={notes}
                          onChangeText={setNotes}
                          multiline
                          textAlignVertical="top"
                          maxLength={1000}
                        />
                      </View>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          ) : null}

          {data?.can_record && !done && (
            <View style={styles.footer}>
              {footerHint ? <Text style={styles.footerHint}>{footerHint}</Text> : null}
              <Pressable onPress={submit} disabled={!canSubmit} style={[styles.submit, !canSubmit && { opacity: 0.4 }]} accessibilityRole="button">
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Catat Serah Terima</Text>}
              </Pressable>
            </View>
          )}

          {!!done && !!onProceed && (
            <View style={styles.footer}>
              <Pressable onPress={onProceed} style={styles.submit} accessibilityRole="button">
                <Text style={styles.submitText}>Selesaikan Booking</Text>
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
    body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 32, gap: 22 },
    card: { borderRadius: 26, paddingHorizontal: 18, paddingVertical: 6, backgroundColor: card, ...shadow },
    sectionTitle: { marginBottom: 10, marginLeft: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    muted: { paddingVertical: 12, fontSize: 13.5, lineHeight: 20, fontWeight: '500', color: colors.textMuted },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1.5, borderColor: 'transparent', ...shadow },
    toggleOn: { borderColor: colors.accent },
    toggleBox: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    toggleBoxOn: { backgroundColor: colors.accent },
    toggleLabel: { flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 21, color: colors.textPrimary },
    requiredPill: { paddingHorizontal: 8, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerBg },
    requiredText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, color: colors.danger },
    photo: { width: '100%', height: 220, borderRadius: 26, backgroundColor: chip },
    photoBtn: { height: 52, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    photoBtnText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
    input: { minHeight: 104, padding: 16, borderRadius: 22, backgroundColor: card, fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textPrimary, ...shadow },
    doneHead: { alignItems: 'center', gap: 6, paddingTop: 8 },
    doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
    doneTitle: { marginTop: 6, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    doneMeta: { fontSize: 13, fontWeight: '500', color: colors.textMuted, textAlign: 'center' },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
    statusDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
    statusIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    statusLabel: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.textPrimary },
    noteText: { paddingVertical: 12, fontSize: 14, lineHeight: 21, color: colors.textPrimary },
    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 10, backgroundColor: screenBg },
    footerHint: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.textMuted },
    submit: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent },
    submitText: { color: '#ffffff', fontWeight: '800', fontSize: fontSize.base },
  });
};
