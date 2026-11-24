import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
// SDK 54 memindahkan API lama expo-file-system ke submodul /legacy (downloadAsync, cacheDirectory), sama seperti layar galeri pelanggan.
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';
import { AppText as Text, AppTextInput } from '@/components/ui/AppText';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { shrinkForUpload } from '@/lib/image-compress';
import { ApiError, staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface IntakeData {
  angles: { key: string; label: string; photo_url: string | null }[];
  damages: { id: number; photo_url: string; note: string | null }[];
  complete: boolean;
  can_edit: boolean;
}

interface Props {
  visible: boolean;
  bookingId: number;
  onClose: () => void;
}

/**
 * Foto penerimaan kendaraan (Fase 3C): empat sudut baku (depan, belakang, kiri, kanan) plus foto kerusakan tambahan bila ada.
 * Bukti kondisi awal sebelum pengerjaan. Foto sudut yang sama menggantikan yang lama; foto kerusakan wajib diberi keterangan.
 * Tampilan dirancang ulang 2026-11-18: kartu putih membulat di atas latar abu-putih, kemajuan sudut berupa batang, dan ubin foto bersudut besar.
 */
export default function IntakePhotosModal({ visible, bookingId, onClose }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const [data, setData] = useState<IntakeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [damageNote, setDamageNote] = useState('');
  const insets = useSafeAreaInsets();
  // Foto yang sedang dibuka di penampil layar penuh (bisa diperbesar dan disimpan ke galeri).
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [savingViewer, setSavingViewer] = useState(false);

  // Simpan ke galeri: writeOnly, jadi hanya menulis dan tidak membaca foto lain milik pengguna (kebijakan Foto & Video Google Play).
  const saveViewerPhoto = async () => {
    if (!viewerUri || savingViewer) return;

    setSavingViewer(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert('Butuh Izin', 'Aktifkan izin akses galeri di Pengaturan untuk menyimpan foto.', [
          { text: 'Batal', style: 'cancel' },
          { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() },
        ]);

        return;
      }

      const ext = viewerUri.split('.').pop()?.split('?')[0] || 'jpg';
      const localUri = `${FileSystem.cacheDirectory}ginnva-intake-${Date.now()}.${ext.length <= 4 ? ext : 'jpg'}`;
      const { uri } = await FileSystem.downloadAsync(viewerUri, localUri);
      await MediaLibrary.saveToLibraryAsync(uri);

      Alert.alert('Berhasil', 'Foto disimpan ke galeri perangkat.');
    } catch {
      Alert.alert('Gagal', 'Foto gagal disimpan. Periksa koneksi internet.');
    } finally {
      setSavingViewer(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<{ data: IntakeData }>(`/api/staff/bookings/${bookingId}/intake-photos`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak bisa memuat foto penerimaan. Periksa koneksi internet Anda.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const capture = async (angle: string, note?: string) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Izin kamera diperlukan', 'Aktifkan izin kamera untuk memotret kendaraan.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setBusy(angle);
    try {
      // Foto dikecilkan dulu (sisi terpanjang 1600 px) supaya tidak melewati batas unggahan server dan cepat terkirim.
      const photo = await shrinkForUpload(result.assets[0], `${angle}.jpg`);
      const form = new FormData();
      form.append('angle', angle);
      if (note) form.append('note', note);
      form.append('photo', { uri: photo.uri, name: `${angle}.jpg`, type: 'image/jpeg' } as unknown as Blob);
      const res = await staffApiFetch<{ data: IntakeData }>(`/api/staff/bookings/${bookingId}/intake-photos`, { method: 'POST', body: form });
      setData(res.data);
      if (angle === 'kerusakan') setDamageNote('');
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa mengunggah foto. Periksa koneksi internet Anda.');
    } finally {
      setBusy(null);
    }
  };

  const removeDamage = (id: number) => {
    Alert.alert('Hapus foto kerusakan?', 'Foto ini akan dihapus dari booking.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await staffApiFetch<{ data: IntakeData }>(`/api/staff/bookings/${bookingId}/intake-photos/${id}`, { method: 'DELETE' });
            setData(res.data);
          } catch (err) {
            Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menghapus foto.');
          }
        },
      },
    ]);
  };

  const done = data ? data.angles.filter((a) => a.photo_url).length : 0;
  const total = data?.angles.length ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  // Dua ubin per baris dengan lebar sama (flex), bukan pembungkus berbasis persen yang bisa menyisakan satu kolom di sebagian layar.
  const rows = data ? [data.angles.slice(0, 2), data.angles.slice(2, 4)].filter((r) => r.length > 0) : [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Tutup" hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.title}>Foto Penerimaan</Text>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <View style={styles.center}>
            <View style={styles.errorIcon}>
              <Ionicons name="cloud-offline-outline" size={34} color={colors.danger} />
            </View>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>Coba lagi</Text>
            </Pressable>
          </View>
        ) : data ? (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Kemajuan sudut */}
            <View style={styles.card}>
              <View style={styles.progressTop}>
                <View style={styles.cardIcon}>
                  <Ionicons name="camera-outline" size={18} color={accentText} />
                </View>
                <Text style={styles.cardTitle}>Empat sudut kendaraan</Text>
                <View style={[styles.countPill, data.complete && styles.countPillDone]}>
                  <Text style={[styles.countText, data.complete && { color: colors.success }]}>{done}/{total}</Text>
                </View>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${percent}%` }, data.complete && { backgroundColor: colors.success }]} />
              </View>

              <View style={styles.grid}>
                {rows.map((row, ri) => (
                  <View key={`r${ri}`} style={styles.gridRow}>
                    {row.map((a) => (
                      <Pressable
                        key={a.key}
                        disabled={busy !== null || (!a.photo_url && !data.can_edit)}
                        onPress={() => (a.photo_url ? setViewerUri(a.photo_url) : capture(a.key))}
                        style={styles.tile}
                        accessibilityRole="button"
                        accessibilityLabel={a.photo_url ? `Buka foto sisi ${a.label}` : `Foto sisi ${a.label}`}
                      >
                        {a.photo_url ? (
                          <Image source={{ uri: a.photo_url }} style={styles.tileImage} resizeMode="cover" />
                        ) : (
                          <View style={[styles.tileImage, styles.tileEmpty]}>
                            <Ionicons name="camera-outline" size={30} color={colors.textMuted} />
                          </View>
                        )}
                        <View style={styles.tileLabelWrap}>
                          <Text style={styles.tileLabel}>{a.label}</Text>
                        </View>
                        {a.photo_url ? (
                          <View style={styles.tileCheck}>
                            <Ionicons name="checkmark" size={14} color="#ffffff" />
                          </View>
                        ) : null}
                        {a.photo_url && data.can_edit ? (
                          <Pressable
                            style={styles.tileRetake}
                            onPress={() => capture(a.key)}
                            disabled={busy !== null}
                            hitSlop={6}
                            accessibilityRole="button"
                            accessibilityLabel={`Potret ulang sisi ${a.label}`}
                          >
                            <Ionicons name="camera-reverse-outline" size={18} color="#ffffff" />
                          </Pressable>
                        ) : null}
                        {busy === a.key ? (
                          <View style={styles.tileBusy}>
                            <ActivityIndicator color="#ffffff" />
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            </View>

            {/* Kerusakan yang sudah ada */}
            <View style={styles.card}>
              <View style={styles.progressTop}>
                <View style={styles.cardIcon}>
                  <Ionicons name="alert-circle-outline" size={18} color={accentText} />
                </View>
                <Text style={styles.cardTitle}>Kerusakan yang sudah ada</Text>
              </View>

              {data.damages.length === 0 ? <Text style={styles.muted}>Belum ada kerusakan tercatat.</Text> : null}

              {data.damages.map((d) => (
                <View key={d.id} style={styles.damageRow}>
                  <Pressable onPress={() => setViewerUri(d.photo_url)} accessibilityRole="button" accessibilityLabel="Buka foto kerusakan">
                    <Image source={{ uri: d.photo_url }} style={styles.damageImage} resizeMode="cover" />
                  </Pressable>
                  <Text style={styles.damageNote}>{d.note}</Text>
                  {data.can_edit && (
                    <Pressable onPress={() => removeDamage(d.id)} style={styles.trashBtn} accessibilityRole="button" accessibilityLabel="Hapus foto kerusakan" hitSlop={8}>
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </Pressable>
                  )}
                </View>
              ))}

              {data.can_edit && (
                <>
                  <AppTextInput
                    style={styles.input}
                    placeholder="Bagian yang rusak, mis. baret pintu kiri depan"
                    placeholderTextColor={colors.textMuted}
                    value={damageNote}
                    onChangeText={setDamageNote}
                    maxLength={255}
                  />
                  <Pressable
                    onPress={() => capture('kerusakan', damageNote.trim())}
                    disabled={!damageNote.trim() || busy !== null}
                    style={[styles.addBtn, (!damageNote.trim() || busy !== null) && { opacity: 0.45 }]}
                    accessibilityRole="button"
                  >
                    {busy === 'kerusakan' ? <ActivityIndicator color="#ffffff" /> : (
                      <>
                        <Ionicons name="camera-outline" size={20} color="#ffffff" />
                        <Text style={styles.addBtnText}>Foto kerusakan</Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}
            </View>
          </ScrollView>
        ) : null}
      </SafeAreaView>

      {/* Penampil foto: cubit dua jari untuk memperbesar, ketuk dua kali untuk membesarkan atau mengembalikan, Simpan untuk mengunduh ke galeri. */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)} statusBarTranslucent>
        <View style={styles.viewerBackdrop}>
          {viewerUri ? (
            <View style={styles.viewerStage}>
              <PinchZoomImage uri={viewerUri} centered />
            </View>
          ) : null}
          <View style={[styles.viewerBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable style={styles.viewerBtn} onPress={() => setViewerUri(null)} accessibilityRole="button" accessibilityLabel="Tutup foto">
              <Ionicons name="close" size={24} color="#ffffff" />
            </Pressable>
            <Pressable style={[styles.viewerBtn, styles.viewerSave]} onPress={saveViewerPhoto} disabled={savingViewer} accessibilityRole="button" accessibilityLabel="Simpan foto ke galeri">
              {savingViewer ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="download-outline" size={22} color="#ffffff" />}
              <Text style={styles.viewerSaveText}>Simpan</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const createStyles = (colors: typeof darkColors, isDark: boolean) => {
  // Sama dengan halaman lain yang sudah dirombak: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    title: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 12 },
    errorIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerBg },
    errorText: { fontSize: fontSize.sm + 1, fontWeight: '500', lineHeight: 22, textAlign: 'center', color: colors.textSecondary },
    retry: { height: 46, paddingHorizontal: spacing.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    retryText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: '#ffffff' },

    body: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: spacing.xl, gap: 16 },
    card: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    progressTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardIcon: { width: 32, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    cardTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    countPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: chip },
    countPillDone: { backgroundColor: colors.successBg },
    countText: { fontSize: 12.5, fontWeight: '800', color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    track: { height: 8, borderRadius: 4, backgroundColor: chip, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    muted: { fontSize: 13, fontWeight: '500', color: colors.textMuted },

    grid: { gap: 12 },
    gridRow: { flexDirection: 'row', gap: 12 },
    tile: { flex: 1, aspectRatio: 1.15, borderRadius: 22, overflow: 'hidden', backgroundColor: chip },
    tileImage: { width: '100%', height: '100%' },
    tileEmpty: { alignItems: 'center', justifyContent: 'center' },
    tileLabelWrap: { position: 'absolute', left: 10, bottom: 10, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)' },
    tileLabel: { fontSize: 12.5, fontWeight: '700', color: '#ffffff' },
    tileRetake: { position: 'absolute', top: 10, right: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
    tileCheck: { position: 'absolute', top: 10, left: 10, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
    tileBusy: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },

    damageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20, backgroundColor: chip },
    damageImage: { width: 56, height: 56, borderRadius: 16 },
    damageNote: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '600', lineHeight: 20, color: colors.textPrimary },
    trashBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerBg },
    input: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, backgroundColor: chip, fontSize: fontSize.sm + 1, color: colors.textPrimary },
    viewerBackdrop: { flex: 1, backgroundColor: '#000000' },
    viewerStage: { flex: 1 },
    viewerBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
    viewerBtn: { height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)' },
    viewerSave: { paddingHorizontal: 16 },
    viewerSaveText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: '#ffffff' },
    addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.pill, backgroundColor: colors.accent },
    addBtnText: { fontSize: fontSize.sm + 1, fontWeight: '800', color: '#ffffff' },
  });
};
