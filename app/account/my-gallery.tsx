import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
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
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
// SDK 54 mengganti API expo-file-system jadi class-based (File/Directory) —
// pakai submodule /legacy supaya API downloadAsync()/cacheDirectory lama
// (lebih ringkas untuk kasus sederhana ini) tetap didukung resmi.
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
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
  const thumbSize = (screenWidth - spacing.md * 2 - spacing.sm * 2) / 3;
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
          'Izin Diperlukan',
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
      Alert.alert('Berhasil', 'Foto disimpan ke galeri perangkat Anda.');
    } catch {
      hapticError();
      Alert.alert('Gagal', 'Foto gagal disimpan. Periksa koneksi internet Anda.');
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
        setError(err instanceof ApiError ? err.message : 'Gagal memuat galeri Anda.');
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Galeri Mobil Saya</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => load()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="camera-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>
            Belum ada foto. Foto progress instalasi mobil Anda akan muncul di sini setelah admin toko mengirimkannya.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections.map((s) => ({ ...s, data: [s.photos] }))}
          keyExtractor={(_, idx) => String(idx)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          renderSectionHeader={({ section }) => {
            const subtitle = [section.store_name, formatDate(section.preferred_date), section.booking_number]
              .filter(Boolean)
              .join(' · ');
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.service_type}</Text>
                {/* "Galeri Pilihan" (showcase, tidak terikat booking) bisa
                    tidak punya store_name/tanggal/booking_number sama
                    sekali — Text kosong tetap memakan tinggi baris di RN,
                    jadi disembunyikan total kalau memang tidak ada isinya. */}
                {subtitle.length > 0 && (
                  <Text style={styles.sectionSubtitle}>{subtitle}</Text>
                )}
              </View>
            );
          }}
          renderItem={({ item: photos }) => (
            <View style={styles.photoGrid}>
              {photos.map((photo) => (
                <Pressable
                  key={photo.id}
                  style={styles.thumbWrap}
                  onPress={() => { setSelectedPhoto(photo); setViewerRotated(false); }}
                >
                  <Image source={{ uri: photo.url }} style={styles.thumb} contentFit="cover" />
                  {photo.stage_label && (
                    <View style={styles.thumbBadge}>
                      <Text style={styles.thumbBadgeText} numberOfLines={1}>{photo.stage_label}</Text>
                    </View>
                  )}
                  <Pressable
                    style={styles.thumbDownloadBtn}
                    onPress={(e) => { e.stopPropagation(); handleDownload(photo); }}
                    hitSlop={6}
                  >
                    {downloadingId === photo.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Ionicons name="download-outline" size={14} color="#ffffff" />
                    )}
                  </Pressable>
                </Pressable>
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
          <Pressable
            style={styles.viewerDownloadBtn}
            onPress={() => selectedPhoto && handleDownload(selectedPhoto)}
            disabled={downloadingId !== null}
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
            >
              <Ionicons name="phone-landscape-outline" size={22} color="#ffffff" />
            </Pressable>
          )}
          <Pressable style={styles.viewerCloseBtn} onPress={() => setSelectedPhoto(null)}>
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
  centerState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl,
  },
  centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryButton: {
    marginTop: spacing.xs, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '600' },

  listContent: { padding: spacing.md, gap: spacing.md },

  sectionHeader: {
    backgroundColor: colors.bg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary },
  sectionSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  thumbWrap: {
    width: thumbSize, height: thumbSize, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  thumb: { width: '100%', height: '100%' },
  thumbBadge: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 3,
  },
  thumbBadgeText: { fontSize: 9, fontWeight: '700', color: '#ffffff' },
  thumbDownloadBtn: {
    position: 'absolute', top: 4, right: 4,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },

  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '80%' },
  viewerCloseBtn: {
    position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  viewerRotateBtn: {
    position: 'absolute', top: 48, right: 68, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  viewerDownloadBtn: {
    position: 'absolute', top: 48, right: 116, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },
  });
}
