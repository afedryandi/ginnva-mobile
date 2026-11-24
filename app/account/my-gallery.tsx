import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  SectionList,
  StyleSheet,
  Pressable,
  Modal,
  useWindowDimensions,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
// SDK 54 mengganti API expo-file-system jadi class-based (File/Directory) —
// pakai submodule /legacy supaya API downloadAsync()/cacheDirectory lama
// (lebih ringkas untuk kasus sederhana ini) tetap didukung resmi.
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';

// Galeri PERSONAL — beda dari galeri publik (app/case/index.tsx) yang
// isinya kurasi admin untuk showcase umum. Ini murni foto yang benar-benar
// dikirim admin toko ke booking milik customer sendiri, dikelompokkan per
// booking (jenis layanan + toko + tanggal, sesuai data yang ada).

interface Photo {
  id: number;
  url: string;
  stage_label: string | null;
  created_at: string;
}

interface GallerySection {
  // booking_id/booking_number/preferred_date bisa null untuk section
  // "Galeri Pilihan" (foto showcase yang di-upload staff dari Filament,
  // tidak terikat booking tertentu — lihat CustomerGalleryPhotoResource).
  booking_id: number | null;
  booking_number: string | null;
  service_type: string;
  store_name: string | null;
  preferred_date: string | null;
  photos: Photo[];
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export default function MyGalleryScreen() {
  const { theme, colors } = useAppTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isPortrait = screenHeight >= screenWidth;
  const thumbSize = Math.floor((screenWidth - 48 - 12) / 2);
  const styles = useMemo(
    () => createStyles(colors, thumbSize),
    [colors, thumbSize]
  );

  const [sections, setSections] = useState<GallerySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  // Beberapa foto galeri diambil dalam posisi HP portrait padahal objeknya
  // landscape (mis. bodi mobil) — tombol flip ini biarkan customer memutar
  // tampilan foto tanpa perlu edit file aslinya. Cuma relevan kalau HP-nya
  // SENDIRI masih portrait — begitu device benar-benar diputar landscape,
  // OS sudah merotasi layar, jadi flip manual ini disembunyikan & direset
  // supaya tidak dobel-rotate.
  const [viewerRotated, setViewerRotated] = useState(false);
  useEffect(() => {
    if (!isPortrait) setViewerRotated(false);
  }, [isPortrait]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleDownload = async (photo: Photo) => {
    if (downloadingId !== null) return;
    setDownloadingId(photo.id);
    try {
      // writeOnly: true — layar ini murni MENYIMPAN foto ke galeri, tidak
      // pernah membaca/browse foto lain milik user. Kebijakan izin Foto &
      // Video Google Play mewajibkan app yang target Android 13+ (API 33+)
      // pakai pemilih bawaan sistem alih-alih minta READ_MEDIA_IMAGES/
      // READ_MEDIA_VIDEO kalau fungsinya bisa dipenuhi tanpa akses baca
      // penuh — writeOnly menghindari kedua izin itu sama sekali,
      // cukup izin tulis (WRITE_EXTERNAL_STORAGE) di versi Android lama.
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        hapticError();
        // Kalau sebelumnya sudah pernah ditolak (khususnya di iOS),
        // requestPermissionsAsync() TIDAK akan memunculkan dialog sistem
        // lagi — cuma langsung balas 'denied'. Tanpa tombol pintasan ini,
        // user tidak akan pernah bisa mengaktifkan izinnya lewat app,
        // harus tahu sendiri caranya buka Settings secara manual.
        Alert.alert(
          'Butuh Izin',
          'Aktifkan izin akses galeri di Pengaturan untuk menyimpan foto.',
          [
            { text: 'Batal', style: 'cancel' },
            { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      const ext = photo.url.split('.').pop()?.split('?')[0] || 'jpg';
      const localUri = `${FileSystem.cacheDirectory}ginnva-gallery-${photo.id}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(photo.url, localUri);
      await MediaLibrary.saveToLibraryAsync(uri);

      hapticSuccess();
      Alert.alert('Berhasil', 'Foto disimpan ke galeri perangkatmu.');
    } catch {
      hapticError();
      Alert.alert('Gagal', 'Foto gagal disimpan. Periksa koneksi internetmu.');
    } finally {
      setDownloadingId(null);
    }
  };

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    apiFetch<{ data: GallerySection[] }>('/api/customer/my-gallery')
      .then((res) => setSections(res.data))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Gagal memuat galerimu.');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle} numberOfLines={1}>Galeri Mobil Saya</Text>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => load()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centerState}>
          <View style={styles.centerIcon}>
            <Ionicons name="images-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.centerStateTitle}>Belum ada foto</Text>
          <Text style={styles.centerStateText}>
            Foto progress instalasi mobilmu akan muncul di sini setelah admin toko mengirimkannya.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections.map((s) => ({ ...s, data: [s.photos] }))}
          keyExtractor={(_, idx) => String(idx)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          renderSectionHeader={({ section }) => {
            const date = formatDate(section.preferred_date);
            // "Galeri Pilihan" (showcase, tidak terikat booking) bisa tidak punya toko/tanggal/nomor booking sama sekali:
            // chip yang kosong tidak ditampilkan.
            const chips = [
              section.store_name ? { icon: 'storefront-outline' as const, text: section.store_name } : null,
              date ? { icon: 'calendar-outline' as const, text: date } : null,
              section.booking_number ? { icon: 'receipt-outline' as const, text: section.booking_number } : null,
            ].filter((c): c is { icon: 'storefront-outline' | 'calendar-outline' | 'receipt-outline'; text: string } => c !== null);

            return (
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle} numberOfLines={2}>{section.service_type}</Text>
                  <View style={styles.countPill}>
                    <Ionicons name="images-outline" size={13} color={colors.accent} />
                    <Text style={styles.countText}>{section.photos.length}</Text>
                  </View>
                </View>
                {chips.length > 0 ? (
                  <View style={styles.chips}>
                    {chips.map((chip) => (
                      <View key={chip.text} style={styles.chip}>
                        <Ionicons name={chip.icon} size={13} color={colors.textSecondary} />
                        <Text style={styles.chipText} numberOfLines={1}>{chip.text}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          }}
          renderItem={({ item: photos }) => (
            <View style={styles.photoGrid}>
              {photos.map((photo) => (
                <PressableScale
                  key={photo.id}
                  style={styles.thumbWrap}
                  scaleTo={0.98}
                  onPress={() => { setSelectedPhoto(photo); setViewerRotated(false); }}
                  accessibilityRole="button"
                  accessibilityLabel={photo.stage_label ? `Foto ${photo.stage_label}` : 'Foto'}
                >
                  <Image source={{ uri: photo.url }} style={styles.thumb} contentFit="cover" />
                  {photo.stage_label ? (
                    <View style={styles.thumbBadge}>
                      <Text style={styles.thumbBadgeText} numberOfLines={1}>{photo.stage_label}</Text>
                    </View>
                  ) : null}
                  <Pressable
                    style={styles.thumbDownloadBtn}
                    onPress={(e) => { e.stopPropagation(); handleDownload(photo); }}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="Simpan foto ke galeri"
                  >
                    {downloadingId === photo.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="download-outline" size={16} color="#ffffff" />
                    )}
                  </Pressable>
                </PressableScale>
              ))}
            </View>
          )}
        />
      )}

      {/* Lightbox */}
      <Modal
        visible={selectedPhoto !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setSelectedPhoto(null)}>
          {selectedPhoto && (
            <Image
              source={{ uri: selectedPhoto.url }}
              style={
                viewerRotated
                  ? { width: screenHeight * 0.8, height: screenWidth * 0.9, transform: [{ rotate: '90deg' }] }
                  : styles.viewerImage
              }
              contentFit="contain"
            />
          )}
          {selectedPhoto?.stage_label ? (
            <View style={styles.viewerCaption}>
              <Text style={styles.viewerCaptionText}>{selectedPhoto.stage_label}</Text>
            </View>
          ) : null}
          <Pressable
            style={styles.viewerDownloadBtn}
            onPress={() => selectedPhoto && handleDownload(selectedPhoto)}
            disabled={downloadingId !== null}
            accessibilityRole="button"
            accessibilityLabel="Simpan foto ke galeri"
          >
            {downloadingId === selectedPhoto?.id ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons name="download-outline" size={22} color="#ffffff" />
            )}
          </Pressable>
          {isPortrait && (
            <Pressable
              style={styles.viewerRotateBtn}
              onPress={() => setViewerRotated((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Putar tampilan foto"
            >
              <Ionicons name="phone-landscape-outline" size={22} color="#ffffff" />
            </Pressable>
          )}
          <Pressable style={styles.viewerCloseBtn} onPress={() => setSelectedPhoto(null)} accessibilityRole="button" accessibilityLabel="Tutup foto">
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, thumbSize: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingBottom: 72 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    centerStateTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    centerStateText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56 },

    sectionHeader: { gap: 10, paddingTop: 18, paddingBottom: 12 },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    sectionTitle: { flex: 1, fontSize: 20, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    countPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.accentSoft },
    countText: { fontSize: 12, fontWeight: '800', color: colors.accent },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.surfaceElevated },
    chipText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary },

    // Foto dalam dua kolom: lebih besar dan lapang dibanding tiga kolom sebelumnya.
    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
    thumbWrap: { width: thumbSize, height: thumbSize * 0.82, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.surfaceElevated },
    thumb: { width: '100%', height: '100%' },
    // Label tahap berupa pil gelap tembus pandang di pojok kiri bawah (putih tetap: duduk di atas foto).
    thumbBadge: { position: 'absolute', left: 10, bottom: 10, maxWidth: '75%', height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
    thumbBadgeText: { fontSize: 11, fontWeight: '800', color: '#ffffff' },
    thumbDownloadBtn: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },

    viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
    viewerImage: { width: '100%', height: '80%' },
    viewerCaption: { position: 'absolute', bottom: 56, alignSelf: 'center', height: 36, paddingHorizontal: 18, borderRadius: 18, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
    viewerCaptionText: { fontSize: 14, fontWeight: '800', color: '#ffffff' },
    viewerCloseBtn: { position: 'absolute', top: 48, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    viewerRotateBtn: { position: 'absolute', top: 48, right: 72, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    viewerDownloadBtn: { position: 'absolute', top: 48, right: 124, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  });
}
