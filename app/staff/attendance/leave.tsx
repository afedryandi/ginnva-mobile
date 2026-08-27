import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Modal, TextInput, Alert, Image, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { Button } from '@/components/ui/Button';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface LeaveRequestRecord {
  id: number;
  request_number: string;
  type: 'izin' | 'sakit' | 'cuti';
  start_date: string;
  end_date: string;
  reason: string;
  document_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
}

const TYPE_LABEL: Record<LeaveRequestRecord['type'], string> = {
  izin: 'Izin',
  sakit: 'Sakit',
  cuti: 'Cuti',
};

const STATUS_META: Record<LeaveRequestRecord['status'], { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu Persetujuan', color: 'warning', bg: 'warningBg' },
  approved: { label: 'Disetujui', color: 'success', bg: 'successBg' },
  rejected: { label: 'Ditolak', color: 'danger', bg: 'dangerBg' },
  cancelled: { label: 'Dibatalkan Sendiri', color: 'textMuted', bg: 'surface' },
};

// Sama persis LeaveRequest::MAX_DURATION_DAYS di backend — dipakai buat
// validasi cepat sisi app sebelum submit, BUKAN pengganti validasi
// server (backend tetap sumber kebenaran akhir).
const MAX_DURATION_DAYS = 30;

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function isBeforeDay(a: Date, b: Date): boolean {
  return toDateInputValue(a) < toDateInputValue(b);
}

export default function StaffLeaveRequestScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [requests, setRequests] = useState<LeaveRequestRecord[]>([]);
  const [cutiQuota, setCutiQuota] = useState(0);
  const [cutiUsed, setCutiUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [type, setType] = useState<LeaveRequestRecord['type']>('izin');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [reason, setReason] = useState('');
  const [document, setDocument] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadRequests = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ leave_requests: LeaveRequestRecord[]; cuti_quota: number; cuti_used: number }>('/api/staff/leave-requests');
      setRequests(res.leave_requests);
      setCutiQuota(res.cuti_quota);
      setCutiUsed(res.cuti_used);
    } catch {
      setError('Gagal memuat riwayat izin. Periksa koneksi internet Anda.');
    }
  }, []);

  const handleCancel = useCallback((request: LeaveRequestRecord) => {
    Alert.alert('Batalkan Pengajuan', `Batalkan pengajuan ${TYPE_LABEL[request.type]} ${formatDate(request.start_date)}–${formatDate(request.end_date)}?`, [
      { text: 'Tidak', style: 'cancel' },
      {
        text: 'Ya, Batalkan', style: 'destructive', onPress: async () => {
          setCancellingId(request.id);
          try {
            await staffApiFetch(`/api/staff/leave-requests/${request.id}/cancel`, { method: 'POST' });
            loadRequests();
          } catch (err) {
            Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
          } finally {
            setCancellingId(null);
          }
        },
      },
    ]);
  }, [loadRequests]);

  useEffect(() => {
    setLoading(true);
    loadRequests().finally(() => setLoading(false));
  }, [loadRequests]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRequests();
    setRefreshing(false);
  }, [loadRequests]);

  // endDate tidak boleh sebelum startDate — kalau staff geser "Dari
  // Tanggal" melewati "Sampai Tanggal" yang sudah dipilih, ikutkan maju
  // supaya tidak perlu 2 langkah manual tiap kali.
  useEffect(() => {
    if (isBeforeDay(endDate, startDate)) {
      setEndDate(startDate);
    }
  }, [startDate, endDate]);

  const stepStartDate = (delta: number) => {
    const next = addDays(startDate, delta);
    if (delta < 0 && isBeforeDay(next, new Date())) return;
    setStartDate(next);
  };

  const stepEndDate = (delta: number) => {
    const next = addDays(endDate, delta);
    if (delta < 0 && isBeforeDay(next, startDate)) return;
    setEndDate(next);
  };

  const openModal = () => {
    setType('izin');
    setStartDate(new Date());
    setEndDate(new Date());
    setReason('');
    setDocument(null);
    setModalVisible(true);
  };

  // Sama pola dengan lampiran foto booking (app/staff/bookings/[id].tsx)
  // — Photo Picker Android tidak butuh izin runtime, iOS tetap perlu.
  const pickDocument = useCallback(async () => {
    if (Platform.OS === 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Izin Galeri Diperlukan', 'Aktifkan izin galeri di pengaturan HP untuk melampirkan foto.');
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.length) return;
    setDocument(result.assets[0]);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!reason.trim()) {
      Alert.alert('Alasan Wajib Diisi', 'Tuliskan alasan pengajuan izin/cuti ini.');
      return;
    }
    if (endDate < startDate) {
      Alert.alert('Tanggal Tidak Valid', '"Sampai Tanggal" tidak boleh sebelum "Dari Tanggal".');
      return;
    }

    const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (dayCount > MAX_DURATION_DAYS) {
      Alert.alert('Durasi Terlalu Panjang', `Durasi pengajuan maksimal ${MAX_DURATION_DAYS} hari. Hubungi admin untuk kasus khusus di luar itu.`);
      return;
    }

    setSubmitting(true);
    try {
      // Multipart CUMA kalau ada lampiran — form JSON biasa tetap dipakai
      // saat tidak ada dokumen, supaya tidak mengubah kebiasaan lama tanpa
      // perlu (staffApiFetch otomatis lepas header Content-Type kalau body
      // instanceof FormData, lihat lib/staff-api.ts).
      let body: FormData | string;
      if (document) {
        const form = new FormData();
        form.append('type', type);
        form.append('start_date', toDateInputValue(startDate));
        form.append('end_date', toDateInputValue(endDate));
        form.append('reason', reason.trim());
        form.append('document', {
          uri: document.uri,
          name: document.fileName || 'lampiran.jpg',
          type: document.mimeType || 'image/jpeg',
        } as unknown as Blob);
        body = form;
      } else {
        body = JSON.stringify({
          type,
          start_date: toDateInputValue(startDate),
          end_date: toDateInputValue(endDate),
          reason: reason.trim(),
        });
      }

      await staffApiFetch('/api/staff/leave-requests', { method: 'POST', body });
      setModalVisible(false);
      Alert.alert('Berhasil', 'Pengajuan izin/cuti terkirim, menunggu persetujuan admin.');
      loadRequests();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }, [type, startDate, endDate, reason, document, loadRequests]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Izin & Cuti</Text>
        <Pressable onPress={openModal} style={styles.sideButton}>
          <Ionicons name="add-circle" size={26} color={colors.accent} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View>
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}
              {cutiQuota > 0 ? (
                <View style={styles.quotaBox}>
                  <Ionicons name="calendar-clear-outline" size={16} color={colors.accent} />
                  <Text style={styles.quotaText}>
                    Sisa jatah Cuti tahun ini: <Text style={styles.quotaTextBold}>{cutiQuota - cutiUsed} hari</Text> (dari {cutiQuota} hari)
                  </Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>Belum ada pengajuan izin/cuti.</Text>
              <Button label="Ajukan Izin/Cuti" onPress={openModal} style={styles.emptyButton} />
            </View>
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            return (
              <View style={styles.card}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardType}>{TYPE_LABEL[item.type]}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: colors[meta.bg] }]}>
                    <Text style={[styles.statusBadgeText, { color: colors[meta.color] }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.cardDates}>
                  {formatDate(item.start_date)} – {formatDate(item.end_date)}
                </Text>
                <Text style={styles.cardReason} numberOfLines={3}>{item.reason}</Text>
                {item.document_url ? (
                  <Pressable onPress={() => Linking.openURL(item.document_url!)} style={styles.attachmentLink}>
                    <Ionicons name="attach-outline" size={14} color={colors.accent} />
                    <Text style={styles.attachmentLinkText}>Lihat lampiran</Text>
                  </Pressable>
                ) : null}
                {item.status === 'rejected' && item.review_note ? (
                  <View style={styles.reviewNoteBox}>
                    <Text style={styles.reviewNoteLabel}>Alasan ditolak:</Text>
                    <Text style={styles.reviewNoteText}>{item.review_note}</Text>
                  </View>
                ) : null}
                {item.reviewer_name && (item.status === 'approved' || item.status === 'rejected') ? (
                  <Text style={styles.reviewerText}>
                    Ditinjau oleh {item.reviewer_name}
                    {item.reviewed_at ? ` · ${formatDate(item.reviewed_at)}` : ''}
                  </Text>
                ) : null}
                <View style={styles.cardBottomRow}>
                  <Text style={styles.cardNumber}>{item.request_number}</Text>
                  {item.status === 'pending' ? (
                    <Pressable
                      style={styles.cancelButton}
                      onPress={() => handleCancel(item)}
                      disabled={cancellingId === item.id}
                    >
                      {cancellingId === item.id ? (
                        <ActivityIndicator size="small" color={colors.danger} />
                      ) : (
                        <Text style={styles.cancelButtonText}>Batalkan</Text>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Ajukan Izin/Cuti</Text>
              <Pressable onPress={() => setModalVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Jenis</Text>
            <View style={styles.typeRow}>
              {(Object.keys(TYPE_LABEL) as LeaveRequestRecord['type'][]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeChip, type === t && styles.typeChipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{TYPE_LABEL[t]}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.fieldLabel}>Dari Tanggal</Text>
                <View style={styles.dateStepper}>
                  <Pressable style={styles.dateStepButton} onPress={() => stepStartDate(-1)} hitSlop={8}>
                    <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
                  </Pressable>
                  <Text style={styles.dateStepperText}>{formatDate(toDateInputValue(startDate))}</Text>
                  <Pressable style={styles.dateStepButton} onPress={() => stepStartDate(1)} hitSlop={8}>
                    <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Text style={styles.fieldLabel}>Sampai Tanggal</Text>
                <View style={styles.dateStepper}>
                  <Pressable style={styles.dateStepButton} onPress={() => stepEndDate(-1)} hitSlop={8}>
                    <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
                  </Pressable>
                  <Text style={styles.dateStepperText}>{formatDate(toDateInputValue(endDate))}</Text>
                  <Pressable style={styles.dateStepButton} onPress={() => stepEndDate(1)} hitSlop={8}>
                    <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
                  </Pressable>
                </View>
              </View>
            </View>

            <Text style={styles.fieldLabel}>Alasan</Text>
            <TextInput
              style={styles.textArea}
              value={reason}
              onChangeText={setReason}
              placeholder="Tuliskan alasan pengajuan..."
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={4}
            />

            <Text style={styles.fieldLabel}>Lampiran (opsional)</Text>
            {document ? (
              <View style={styles.attachmentPreview}>
                <Image source={{ uri: document.uri }} style={styles.attachmentThumb} />
                <Text style={styles.attachmentName} numberOfLines={1}>{document.fileName || 'Foto terlampir'}</Text>
                <Pressable onPress={() => setDocument(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={20} color={colors.danger} />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.attachButton} onPress={pickDocument}>
                <Ionicons name="camera-outline" size={18} color={colors.accent} />
                <Text style={styles.attachButtonText}>
                  {type === 'sakit' ? 'Lampirkan Foto Surat Dokter' : 'Lampirkan Foto Pendukung'}
                </Text>
              </Pressable>
            )}

            <Button label="Kirim Pengajuan" onPress={handleSubmit} loading={submitting} style={styles.submitButton} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg,
    },
    sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
    listContent: { padding: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },
    quotaBox: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md,
    },
    quotaText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary },
    quotaTextBold: { fontWeight: '700', color: colors.textPrimary },
    card: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, marginBottom: spacing.sm,
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
    cardType: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
    statusBadgeText: { fontSize: fontSize.xs, fontWeight: '700' },
    cardDates: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: 4, fontVariant: ['tabular-nums'] },
    cardReason: { fontSize: fontSize.sm, color: colors.textPrimary, marginBottom: spacing.xs },
    attachmentLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
    attachmentLinkText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.accent },
    reviewerText: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    reviewNoteBox: { backgroundColor: colors.dangerBg, borderRadius: radius.sm, padding: spacing.xs, marginBottom: spacing.xs },
    reviewNoteLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.danger },
    reviewNoteText: { fontSize: fontSize.xs, color: colors.danger },
    cardBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardNumber: { fontSize: 10, color: colors.textMuted },
    cancelButton: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
    cancelButtonText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.danger },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted },
    emptyButton: { marginTop: spacing.sm, paddingHorizontal: spacing.xl },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
      padding: spacing.lg, paddingBottom: spacing.xl,
    },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
    modalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
    fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.sm },
    typeRow: { flexDirection: 'row', gap: spacing.sm },
    typeChip: {
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    typeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    typeChipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
    typeChipTextActive: { color: '#ffffff' },
    dateRow: { flexDirection: 'row', gap: spacing.md },
    dateField: { flex: 1 },
    dateStepper: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.xs, paddingVertical: spacing.xs,
    },
    dateStepButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    dateStepperText: { flex: 1, textAlign: 'center', fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    textArea: {
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: fontSize.sm, color: colors.textPrimary,
      minHeight: 90, textAlignVertical: 'top',
    },
    attachButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
      backgroundColor: colors.accentSoft, borderRadius: radius.md, paddingVertical: spacing.sm,
    },
    attachButtonText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.accent },
    attachmentPreview: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      padding: spacing.xs,
    },
    attachmentThumb: { width: 40, height: 40, borderRadius: radius.sm },
    attachmentName: { flex: 1, fontSize: fontSize.xs, color: colors.textPrimary },
    submitButton: { marginTop: spacing.lg },
  });
}
