import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Pressable,
  Linking,
  Alert,
  useWindowDimensions,
  AppState,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, API_BASE_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import PromoConsentPrompt from '@/components/PromoConsentPrompt';
import {
  ShieldCheckIcon,
  StoreIcon,
  DashboardIcon,
  CarQuoteIcon,
  BrandTagIcon,
} from '@/components/QuickMenuIcons';

// Disembunyikan sementara per permintaan — set true lagi kalau fitur
// Berita mau ditampilkan lagi.
const SHOW_NEWS_SECTION = false;

// Portrait — sesuai referensi mini app Ginnva China (banner rasio ~3:4,
// bukan landscape 16:9 seperti sebelumnya). Rasio 1.25 cuma dipakai saat
// device dalam orientasi potret asli — di landscape/tablet (lebar > tinggi)
// itu bikin carousel lebih tinggi dari layar itu sendiri, jadi di-clamp ke
// separuh tinggi layar supaya konten di bawahnya tidak terdorong hilang.
function getCarouselHeight(width: number, height: number): number {
  const portraitHeight = Math.round(width * 1.25);
  return width > height ? Math.min(portraitHeight, Math.round(height * 0.5)) : portraitHeight;
}

const PRODUCT_CATEGORIES = [
  { key: 'kaca-film-mobil', label: 'Car Window Film' },
  { key: 'film-pelindung-cat', label: 'Paint Protection Film' },
  { key: 'film-pengubah-warna', label: 'Color Change Film' },
  { key: 'film-kaca-bangunan', label: 'Architectural Film' },
];

// 5 menu utama dari referensi mini app China (质保查询/门店查询/门店系统/
// 车型报价/品牌介绍) — ikon custom line-style, bukan Ionicons generik.
const QUICK_MENU = [
  { key: 'warranty', label: 'Cek Garansi', Icon: ShieldCheckIcon, route: '/warranty/check' },
  { key: 'stores', label: 'Cari Toko', Icon: StoreIcon, route: '/(tabs)/stores' },
  { key: 'dashboard', label: 'Booking Instalasi', Icon: DashboardIcon, route: '/booking' },
  { key: 'quotation', label: 'Ajukan Penawaran', Icon: CarQuoteIcon, route: '/quotation' },
  { key: 'brand', label: 'Tentang Brand', Icon: BrandTagIcon, route: '/brand' },
];

interface CarouselItem {
  id: number;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  link_url: string | null;
}

// "Seri Produk" — kartu dikurasi manual oleh admin lewat Filament
// (FeaturedProductResource), maks. 4 kartu, urutan sesuai sort_order.
interface FeaturedProductItem {
  id: number;
  title: string | null;
  subtitle: string | null;
  image: string | null;
  content_image: string | null;
  link_url: string | null;
}

// Slide carousel gabungan: 1 video hero (hardcode, sama seperti hero video
// di ginnva-web) + sisanya foto dari API /api/carousels (Filament admin).
type HeroSlide =
  | { kind: 'video'; id: number; videoUrl: string }
  | (CarouselItem & { kind: 'image' });

// Video di-hosting manual di server BACKEND (ginnva-api/public/video/),
// bukan di-bundle ke app — sengaja begitu supaya tidak kena limit ukuran
// file GitHub, dan bisa diganti kapan saja tanpa perlu rilis app baru.
// File NAMA BEDA dari ginnva-hero.mp4 yang dipakai ginnva-web (landscape)
// — punya mobile ini portrait, jadi wajib file terpisah supaya ganti
// video di satu platform tidak ikut mengubah video di platform lain.
const HERO_VIDEO_URL = `${API_BASE_URL}/video/ginnva-hero-mobile.mp4`;

interface GalleryPhoto {
  id: number;
  url: string;
  label: string;
  createdAt: string;
}

interface GallerySection {
  service_type: string;
  photos: { id: number; url: string; stage_label: string | null; created_at: string }[];
}

interface NewsItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image: string | null;
  published_at: string | null;
}

// Bagian C, "Klaim Garansi & Maintenance PPF" (2026-10-01) -- diminta user
// tampil juga di beranda, bukan cuma push notification.
interface PendingMaintenanceSchedule {
  id: number;
  warranty_id: number;
  warranty_code: string;
  scheduled_date: string;
  status: 'pending' | 'confirmation_sent';
}

interface ActiveBooking {
  id: number;
  booking_number: string;
  service_type: string;
  current_stage: string | null;
  secondary_stage: string | null;
  product_kaca_film: boolean;
  product_ppf: boolean;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

const KACA_FILM_STAGES: { key: string; label: string }[] = [
  { key: 'kf_cleaning', label: 'Pembersihan' },
  { key: 'kf_heating', label: 'Pemanasan' },
  { key: 'kf_installation', label: 'Instalasi Kaca Film' },
];
const PPF_STAGES: { key: string; label: string }[] = [
  { key: 'ppf_washing', label: 'Proses Cuci' },
  { key: 'ppf_detailing', label: 'Detailing' },
  { key: 'ppf_installation', label: 'Pemasangan PPF' },
];
const SHARED_STAGES: { key: string; label: string }[] = [
  { key: 'qc', label: 'Quality Check' },
  { key: 'completed', label: 'Serah Terima Unit' },
];
const ALL_STAGE_LABELS: Record<string, string> = Object.fromEntries(
  [...KACA_FILM_STAGES, ...PPF_STAGES, ...SHARED_STAGES].map((s) => [s.key, s.label])
);

// Track yang sudah sampai tahap terakhirnya sendiri (mis. Kaca Film sampai
// "Instalasi Kaca Film") dianggap selesai di sisinya — tidak lagi ikut
// ditampilkan di ringkasan, supaya tidak seolah-olah masih "berjalan" di
// tahap itu selamanya sambil menunggu track satunya (PPF) selesai juga.
function stageSummaryLabel(booking: ActiveBooking): string {
  if (booking.current_stage === 'qc' || booking.current_stage === 'completed') {
    return ALL_STAGE_LABELS[booking.current_stage] ?? '-';
  }
  const bothProducts = booking.product_kaca_film && booking.product_ppf;
  if (bothProducts) {
    const kfDone = booking.current_stage === KACA_FILM_STAGES[KACA_FILM_STAGES.length - 1].key;
    const ppfDone = booking.secondary_stage === PPF_STAGES[PPF_STAGES.length - 1].key;
    if (kfDone && ppfDone) return 'Menunggu Quality Check';
    const parts: string[] = [];
    if (!kfDone) parts.push(`Kaca Film: ${ALL_STAGE_LABELS[booking.current_stage ?? ''] ?? '-'}`);
    if (!ppfDone) parts.push(`PPF: ${ALL_STAGE_LABELS[booking.secondary_stage ?? ''] ?? '-'}`);
    return parts.join('  ·  ') || '-';
  }
  return ALL_STAGE_LABELS[booking.current_stage ?? ''] ?? '-';
}

const FALLBACK_IMAGE = 'https://placehold.co/800x1000/161226/e8c078?text=Ginnva';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Komponen terpisah karena useVideoPlayer() adalah hook — tidak bisa
// dipanggil langsung di dalam .map() slide carousel.
function HeroVideoSlide({ style }: { style: object }) {
  const player = useVideoPlayer(HERO_VIDEO_URL, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // expo-video otomatis pause video saat app dibackground (mis. buka app
  // lain lewat Linking.openURL, seperti tombol "Buka Peta") — tanpa ini,
  // video nyangkut di frame terakhir dan tidak lanjut lagi saat app
  // kembali ke foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        player.play();
      }
    });
    return () => subscription.remove();
  }, [player]);

  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
    />
  );
}

export default function HomeScreen() {
  const { isLoggedIn } = useAuth();
  // Beranda SENGAJA selalu dark, terlepas dari setting tema global user
  // (lihat lib/theme-context.tsx) — referensi desain mini app Ginnva China.
  const colors = darkColors;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const carouselHeight = useMemo(
    () => getCarouselHeight(screenWidth, screenHeight),
    [screenWidth, screenHeight]
  );
  const styles = useMemo(
    () => createStyles(colors, screenWidth, carouselHeight),
    [colors, screenWidth, carouselHeight]
  );
  const insets = useSafeAreaInsets();
  const [carousels, setCarousels] = useState<CarouselItem[]>([]);
  const [featuredProducts, setFeaturedProducts] = useState<FeaturedProductItem[]>([]);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [pendingMaintenance, setPendingMaintenance] = useState<PendingMaintenanceSchedule[]>([]);
  // Galeri hanya relevan setelah admin toko MENERIMA booking (status
  // berubah dari 'pending' ke 'confirmed'/'completed') — sebelum itu
  // belum ada proses instalasi yang bisa difoto sama sekali.
  const [hasConfirmedBooking, setHasConfirmedBooking] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  // Diukur dari layout nyata brandHeader (bukan angka tetap) — supaya baris
  // kategori tetap menempel rapi di bawahnya walau tingginya berubah (mis.
  // font scaling accessibility bikin tagline "House" butuh lebih banyak
  // ruang, atau logo/tagline bertambah baris).
  const [brandHeaderHeight, setBrandHeaderHeight] = useState(44);
  const carouselRef = useRef<ScrollView>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchUnread = useCallback(async () => {
    if (!isLoggedIn) { setUnreadCount(0); return; }
    try {
      const res = await apiFetch<{ unread_count: number }>('/api/customer/notifications');
      setUnreadCount(res.unread_count);
    } catch { /* silent */ }
  }, [isLoggedIn]);

  const fetchActiveBooking = useCallback(async () => {
    if (!isLoggedIn) { setActiveBooking(null); setHasConfirmedBooking(false); return; }
    try {
      const res = await apiFetch<{ data: ActiveBooking[] }>('/api/customer/bookings');
      // Booking yang sedang berjalan = sudah punya tahap tapi belum
      // "selesai" — supaya kartu ini hilang otomatis begitu instalasi
      // kelar, tidak nyangkut selamanya di beranda.
      const active = res.data.find((b) => b.status === 'confirmed' && b.current_stage && b.current_stage !== 'completed');
      setActiveBooking(active ?? null);
      setHasConfirmedBooking(res.data.some((b) => b.status === 'confirmed' || b.status === 'completed'));
    } catch { /* silent */ }
  }, [isLoggedIn]);

  const fetchPendingMaintenance = useCallback(async () => {
    if (!isLoggedIn) { setPendingMaintenance([]); return; }
    try {
      const res = await apiFetch<{ data: PendingMaintenanceSchedule[] }>('/api/customer/maintenance-schedules/pending');
      setPendingMaintenance(res.data);
    } catch { /* silent */ }
  }, [isLoggedIn]);

  const fetchGalleryPhotos = useCallback(async () => {
    // Tidak lagi digerbang oleh hasConfirmedBooking — galeri "showcase"
    // (upload staff dari Filament, lihat CustomerGalleryPhotoResource)
    // tidak terikat status booking sama sekali, jadi tetap perlu dicoba
    // dimuat selama customer login, terlepas dari status booking-nya.
    if (!isLoggedIn) { setGalleryPhotos([]); return; }
    try {
      const res = await apiFetch<{ data: GallerySection[] }>('/api/customer/my-gallery');
      // Ratakan semua foto dari semua booking + galeri showcase jadi satu
      // list, terbaru dulu (pakai created_at, bukan id — id bisa berasal
      // dari 2 tabel beda skala) — beranda cuma perlu cuplikan, detail
      // lengkap ada di "Galeri Mobil Saya" (account/my-gallery.tsx).
      const flattened: GalleryPhoto[] = res.data
        .flatMap((section) =>
          section.photos.map((p) => ({
            id: p.id,
            url: p.url,
            label: p.stage_label ?? section.service_type,
            createdAt: p.created_at,
          }))
        )
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 6);
      setGalleryPhotos(flattened);
    } catch { /* silent */ }
  }, [isLoggedIn]);

  const loadAll = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    Promise.all([
      apiFetch<{ data: CarouselItem[] }>('/api/carousels')
        .then((res) => setCarousels(res.data))
        .catch(() => {}),
      apiFetch<{ data: FeaturedProductItem[] }>('/api/featured-products')
        .then((res) => setFeaturedProducts(res.data))
        .catch(() => {}),
      apiFetch<{ data: NewsItem[] }>('/api/news', { skipAuth: true })
        .then((res) => setNews(res.data.slice(0, 3)))
        .catch(() => {}),
      fetchActiveBooking(),
      fetchGalleryPhotos(),
      fetchUnread(),
      fetchPendingMaintenance(),
    ]).finally(() => setRefreshing(false));
  };

  // Slide pertama SELALU video hero (sama seperti hero video di ginnva-web),
  // sisanya foto dari API /api/carousels.
  const heroSlides: HeroSlide[] = useMemo(
    () => [
      { kind: 'video', id: -1, videoUrl: HERO_VIDEO_URL },
      ...carousels.map((c) => ({ ...c, kind: 'image' as const })),
    ],
    [carousels]
  );

  // Auto-scroll carousel setiap 4 detik
  useEffect(() => {
    if (heroSlides.length < 2) return;
    autoScrollTimer.current = setInterval(() => {
      setActiveSlide((prev) => {
        const next = (prev + 1) % heroSlides.length;
        // Loncat balik dari slide TERAKHIR ke PERTAMA harus instan (tanpa
        // animasi) — ScrollView.scrollTo menganimasikan secara linear
        // berdasarkan offset X, jadi animated:true di titik wrap-around ini
        // akan terlihat scroll MUNDUR melewati semua slide di antaranya,
        // bukan transisi mulus. Ditemukan saat audit modul Banner/Carousel.
        const isWrappingToStart = next === 0 && prev !== 0;
        carouselRef.current?.scrollTo({ x: next * screenWidth, animated: !isWrappingToStart });
        return next;
      });
    }, 4000);
    return () => {
      if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
    };
  }, [heroSlides.length, screenWidth]);

  const onCarouselScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setActiveSlide(index);
  };

  const handleCarouselTap = async (item: HeroSlide) => {
    if (item.kind !== 'image' || !item.link_url) return;

    // Hitung ketukan banner (Marketing/Konten Fase 5); gagal tidak boleh menghalangi membuka link.
    apiFetch(`/api/carousels/${item.id}/click`, { method: 'POST' }).catch(() => {});

    // SEBELUMNYA tidak ada penanganan error sama sekali — kalau link_url
    // gagal dibuka (format tidak valid, tidak ada app yang bisa handle,
    // dsb), promise rejection dari Linking.openURL() dibiarkan tidak
    // tertangani: customer tidak dapat feedback apa pun, cuma banner yang
    // seolah tidak merespons. Ditemukan saat audit modul Banner/Carousel.
    try {
      const canOpen = await Linking.canOpenURL(item.link_url);
      if (!canOpen) {
        Alert.alert('Tidak Bisa Membuka Link', 'Link pada banner ini tidak valid atau tidak didukung.');
        return;
      }
      await Linking.openURL(item.link_url);
    } catch {
      Alert.alert('Gagal Membuka Link', 'Terjadi kesalahan saat membuka link banner ini.');
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  // Refresh badge notifikasi tiap kali Beranda kembali fokus (mis. customer
  // baca notifikasi lalu balik ke tab ini) — tanpa ini, angka unread bisa
  // basi sampai user narik pull-to-refresh manual.
  useFocusEffect(
    useCallback(() => {
      fetchUnread();
    }, [fetchUnread])
  );

  useEffect(() => {
    fetchActiveBooking();
  }, [fetchActiveBooking]);

  useEffect(() => {
    fetchGalleryPhotos();
  }, [fetchGalleryPhotos]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
      <StatusBar style="light" />
      <PromoConsentPrompt />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={loadAll}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        }
      >
        {/* ===== Hero: carousel + header brand overlay (transparan,
            menimpa carousel) ===== */}
        <View style={styles.heroWrapper}>
          {/* ===== Carousel Banner (portrait) — slide 1 video hero, sisanya foto ===== */}
          {heroSlides.length > 0 && (
            <View style={styles.carouselWrapper}>
              <ScrollView
                ref={carouselRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onCarouselScroll}
                scrollEventThrottle={16}
              >
                {heroSlides.map((item) => (
                  <Pressable
                    key={item.kind === 'video' ? 'hero-video' : item.id}

                    style={styles.carouselSlide}
                    onPress={() => handleCarouselTap(item)}
                  >
                    {item.kind === 'video' ? (
                      <HeroVideoSlide style={styles.carouselImage} />
                    ) : (
                      <Image
                        source={{ uri: item.image || FALLBACK_IMAGE }}
                        style={styles.carouselImage}
                        contentFit="cover"
                      />
                    )}
                    <LinearGradient
                      colors={['rgba(11,11,22,0.55)', 'transparent', 'rgba(11,11,22,0.15)', 'rgba(11,11,22,0.92)']}
                      locations={[0, 0.22, 0.5, 1]}
                      style={styles.carouselGradient}
                    />
                    {item.kind === 'image' && (item.title || item.subtitle) && (
                      <View style={styles.carouselOverlay}>
                        {item.title && (
                          <Text style={styles.carouselTitle} numberOfLines={2}>
                            {item.title}
                          </Text>
                        )}
                        {item.subtitle && (
                          <Text style={styles.carouselSubtitle} numberOfLines={2}>
                            {item.subtitle}
                          </Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
              {heroSlides.length > 1 && (
                <View style={styles.dotsRow}>
                  {heroSlides.map((_, i) => (
                    <View
                    key={i}
                    style={[styles.dot, i === activeSlide && styles.dotActive]}
                  />
                ))}
              </View>
            )}
          </View>
          )}

          {/* ===== Header brand — overlay transparan menimpa carousel ===== */}
          <View
            style={[styles.brandHeader, { paddingTop: insets.top + spacing.sm }]}
            onLayout={(e) => setBrandHeaderHeight(e.nativeEvent.layout.height)}
          >
            <View style={styles.brandTextRow}>
              <Image
                source={require('@/assets/images/ginnva-logo-red.webp')}
                style={styles.brandLogo}
                contentFit="contain"
              />
              <Text style={styles.brandTagline}>House</Text>
            </View>
            <Pressable

              style={styles.notifBtn}
              accessibilityLabel="Notifikasi"
              onPress={() => {
                // /account/notifications tidak punya guard sendiri (beda dari
                // booking/index.tsx) — kalau guest tap ini tanpa dialihkan,
                // fetch-nya akan gagal 401 dan mereka lihat error teknis
                // yang tidak menjelaskan bahwa mereka perlu login dulu.
                if (!isLoggedIn) {
                  router.push('/auth/login' as never);
                  return;
                }
                router.push('/account/notifications' as never);
              }}
            >
              <Ionicons name="notifications-outline" size={22} color="#ffffff" />
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* ===== Kategori produk — overlay transparan, di bawah header ===== */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
            style={[styles.categoryRowAbsolute, { top: brandHeaderHeight }]}
          >
            {PRODUCT_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.key}

                style={styles.categoryChip}
                onPress={() => router.push(`/products/${cat.key}` as never)}
              >
                <Text style={styles.categoryChipText}>{cat.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* ===== Banner Konfirmasi Maintenance PPF (Bagian C, 2026-10-01) =====
            Diminta user tampil juga di beranda, bukan cuma push notification.
            Cuma yang statusnya 'confirmation_sent' yang ditampilkan di sini --
            'pending' belum masuk window pengingat, belum relevan ditonjolkan
            di beranda. */}
        {pendingMaintenance.filter((m) => m.status === 'confirmation_sent').map((m) => (
          <PressableScale
            key={m.id}
            style={styles.maintenanceBanner}
            onPress={() => router.push(`/account/warranty-detail?id=${m.warranty_id}` as never)}
            accessibilityRole="button"
          >
            <View style={styles.maintenanceIcon}>
              <Ionicons name="calendar-outline" size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.maintenanceBannerTitle}>Konfirmasi Maintenance PPF</Text>
              <Text style={styles.maintenanceBannerText}>
                {m.warranty_code} — jadwal {new Date(m.scheduled_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </PressableScale>
        ))}

        {/* ===== Kartu Progress Instalasi Aktif ===== */}
        {activeBooking && (
          <PressableScale
            style={styles.progressCard}
            onPress={() => router.push(`/booking/${activeBooking.id}/chat` as never)}
            accessibilityRole="button"
            accessibilityLabel="Buka progress instalasi"
          >
            <View style={styles.progressCardHeader}>
              <View style={styles.progressIconWrap}>
                <Ionicons name="construct-outline" size={22} color="#ffffff" />
              </View>
              <View style={styles.progressHeaderText}>
                <Text style={styles.progressCardTitle}>Progress Instalasi</Text>
                <Text style={styles.progressCardSubtitle} numberOfLines={1}>{activeBooking.service_type}</Text>
              </View>
              <View style={styles.progressArrow}>
                <Ionicons name="arrow-forward" size={16} color={colors.accent} />
              </View>
            </View>

            <View style={styles.progressStageBox}>
              <Text style={styles.progressStageCaption}>Tahap saat ini</Text>
              <Text style={styles.progressStageLabel}>{stageSummaryLabel(activeBooking)}</Text>
            </View>

            {(() => {
              const bothProducts = activeBooking.product_kaca_film && activeBooking.product_ppf;
              const tracks: { stages: { key: string; label: string }[]; columnValue: string | null; label: string | null }[] = [];
              if (activeBooking.product_kaca_film) {
                tracks.push({ stages: KACA_FILM_STAGES, columnValue: activeBooking.current_stage, label: bothProducts ? 'Kaca Film' : null });
              }
              if (activeBooking.product_ppf) {
                tracks.push({
                  stages: PPF_STAGES,
                  columnValue: bothProducts ? activeBooking.secondary_stage : activeBooking.current_stage,
                  label: bothProducts ? 'PPF' : null,
                });
              }
              tracks.push({ stages: SHARED_STAGES, columnValue: activeBooking.current_stage, label: (activeBooking.product_kaca_film || activeBooking.product_ppf) ? 'Tahap Akhir' : null });

              return tracks.map((track, ti) => (
                <View key={ti} style={styles.progressTrack}>
                  {track.label && <Text style={styles.progressTrackLabel}>{track.label}</Text>}
                  <View style={styles.progressBarRow}>
                    {track.stages.map((s, idx) => {
                      const currentIdx = track.stages.findIndex((x) => x.key === track.columnValue);
                      const isDone = idx <= currentIdx;
                      return (
                        <View key={s.key} style={styles.progressBarSegmentWrap}>
                          <View style={[styles.progressBarSegment, isDone && styles.progressBarSegmentActive]} />
                        </View>
                      );
                    })}
                  </View>
                </View>
              ));
            })()}
          </PressableScale>
        )}


        {/* ===== Menu utama (5 ikon custom) ===== */}
        <View style={styles.quickMenuGrid}>
          {QUICK_MENU.map((menu) => {
            const { Icon } = menu;
            return (
              <PressableScale
                key={menu.key}
                style={styles.quickMenuItem}
                onPress={() => router.push(menu.route as never)}
                accessibilityRole="button"
                accessibilityLabel={menu.label}
              >
                <View style={styles.quickMenuIconWrap}>
                  <Icon size={28} color={colors.textPrimary} accentColor={colors.accent} />
                </View>
                <Text style={styles.quickMenuLabel}>{menu.label}</Text>
              </PressableScale>
            );
          })}
        </View>

        {/* ===== Seri Produk (Top 4, dikurasi manual admin) ===== */}
        {featuredProducts.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Seri Produk</Text>
              <Pressable onPress={() => router.push('/seri-produk' as never)}>
                <Text style={styles.sectionMore}>Lihat Semua</Text>
              </Pressable>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredProductRow}
            >
              {featuredProducts.map((item) => {
                const openFull = () => router.push({
                  pathname: '/seri-produk/view',
                  params: {
                    image: item.content_image ?? item.image ?? '',
                    title: item.title ?? '',
                    subtitle: item.subtitle ?? '',
                    // Sama seperti seri-produk/index.tsx — lihat catatan di sana.
                    link_url: item.link_url ?? '',
                  },
                } as never);
                return (
                  <PressableScale key={item.id} style={styles.featuredProductCard} onPress={openFull} accessibilityRole="button">
                    {item.image && (
                      <Image
                        source={{ uri: item.image }}
                        style={styles.featuredProductImage}
                        contentFit="cover"
                      />
                    )}
                    <View style={styles.featuredProductInfo}>
                      {item.title && <Text style={styles.featuredProductTitle} numberOfLines={1}>{item.title}</Text>}
                      {item.subtitle && <Text style={styles.featuredProductSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
                      <Pressable style={styles.featuredProductBtn} onPress={openFull}>
                        <Text style={styles.featuredProductBtnText}>Selengkapnya</Text>
                        <Ionicons name="arrow-forward" size={14} color="#ffffff" />
                      </Pressable>
                    </View>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* ===== Galeri Mobil Saya =====
            Section ini SENGAJA disembunyikan total (bukan cuma kosong)
            kalau belum ada booking yang diterima admin toko — sebelum
            booking dikonfirmasi, belum ada proses instalasi yang relevan
            untuk ditampilkan sama sekali. */}
        {hasConfirmedBooking && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Galeri Mobil Saya</Text>
              <Pressable onPress={() => router.push('/account/my-gallery' as never)}>
                <Text style={styles.sectionMore}>Lihat Semua</Text>
              </Pressable>
            </View>

            {galleryPhotos.length === 0 ? (
              <View style={styles.comingSoonBox}>
                <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
                <Text style={styles.comingSoonTitle}>Belum Ada Foto</Text>
                <Text style={styles.comingSoonText}>Foto progress instalasi mobilmu akan muncul di sini setelah admin toko mengirimkannya.</Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.caseRow}
              >
                {galleryPhotos.map((photo) => (
                  <PressableScale key={photo.id} style={styles.caseCard} onPress={() => router.push('/account/my-gallery' as never)} accessibilityRole="button">
                    <Image
                      source={{ uri: photo.url }}
                      style={styles.caseImage}
                      contentFit="cover"
                    />
                    <Text style={styles.caseTitle} numberOfLines={2}>
                      {photo.label}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>
            )}
          </>
        )}

        {/* ===== Berita Terbaru — disembunyikan sementara per permintaan,
            fetch & data tetap jalan supaya gampang diaktifkan lagi ===== */}
        {SHOW_NEWS_SECTION && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Berita Terbaru</Text>
              <Pressable onPress={() => router.push('/news' as never)}>
                <Text style={styles.sectionMore}>Lihat Semua</Text>
              </Pressable>
            </View>

            {news.length === 0 ? (
              <View style={styles.comingSoonBox}>
                <Ionicons name="newspaper-outline" size={26} color={colors.textMuted} />
                <Text style={styles.comingSoonTitle}>Segera Hadir</Text>
                <Text style={styles.comingSoonText}>Berita dan info terbaru akan muncul di sini.</Text>
              </View>
            ) : (
              <View style={styles.newsList}>
                {news.map((item) => (
                  <Pressable
                    key={item.id}

                    style={styles.newsCard}
                    onPress={() => router.push(`/news/${item.slug}` as never)}
                  >
                    <Image
                      source={{ uri: item.cover_image || FALLBACK_IMAGE }}
                      style={styles.newsImage}
                      contentFit="cover"
                    />
                    <View style={styles.newsBody}>
                      {item.published_at && (
                        <Text style={styles.newsDate}>{formatDate(item.published_at)}</Text>
                      )}
                      <Text style={styles.newsTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, screenWidth: number, carouselHeight: number) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroWrapper: {
    position: 'relative',
  },
  brandHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    paddingHorizontal: 24,
    paddingBottom: spacing.sm,
  },
  brandTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  brandLogo: {
    width: 110,
    height: 28,
  },
  brandTagline: {
    fontSize: fontSize.lg,
    // SENGAJA hardcode putih (bukan colors.textPrimary) — teks ini
    // menimpa foto carousel, jadi harus tetap putih di kedua tema.
    color: '#ffffff',
    marginTop: 2,
  },
  notifBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
    lineHeight: 12,
  },
  carouselWrapper: {
    marginBottom: 20,
    position: 'relative',
    overflow: 'hidden',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  carouselSlide: {
    width: screenWidth,
    height: carouselHeight,
  },
  carouselImage: {
    width: screenWidth,
    height: carouselHeight,
    backgroundColor: colors.surface,
  },
  carouselGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  carouselOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  carouselTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: '#ffffff',
  },
  carouselSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 6,
  },
  dotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  dotActive: {
    width: 22,
    backgroundColor: '#ffffff',
  },
  categoryRowAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  categoryRow: {
    paddingHorizontal: 24,
    gap: 8,
  },
  categoryChip: {
    height: 38,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 19,
  },
  categoryChipText: {
    fontSize: 13,
    // SENGAJA hardcode putih — chip ini menimpa foto carousel.
    color: '#ffffff',
    fontWeight: '700',
  },
  quickMenuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  quickMenuItem: {
    width: '20%',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: 8,
  },
  quickMenuIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickMenuLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.textPrimary,
  },
  sectionMore: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.accent,
  },
  featuredProductRow: {
    paddingHorizontal: 24,
    gap: 14,
  },
  featuredProductCard: {
    // Landscape (rasio 3:2) tapi tidak full-width — full-width kemarin
    // kartunya jadi terlalu besar/tinggi.
    width: screenWidth * 0.64,
    borderRadius: 28,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  featuredProductImage: {
    width: '100%',
    // Rasio ~3:2 mengikuti gambar referensi (banner landscape, bukan
    // potret/persegi seperti sebelumnya).
    aspectRatio: 3 / 2,
    backgroundColor: colors.bg,
  },
  featuredProductInfo: {
    padding: 16,
    gap: 2,
  },
  featuredProductTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.textPrimary,
  },
  featuredProductSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  featuredProductBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accent,
  },
  featuredProductBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
  },
  caseRow: {
    paddingHorizontal: 24,
    gap: 14,
  },
  caseCard: {
    width: 190,
  },
  caseImage: {
    width: 190,
    height: 130,
    borderRadius: 24,
    backgroundColor: colors.surfaceElevated,
    marginBottom: 10,
  },
  caseTitle: {
    fontSize: 14,
    lineHeight: 19,
    color: colors.textPrimary,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  comingSoonBox: {
    marginHorizontal: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: 28,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceElevated,
  },
  comingSoonTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  comingSoonText: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  newsList: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  newsCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  newsImage: {
    width: 90,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  newsBody: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  newsDate: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  newsTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  // Bagian C, "Klaim Garansi & Maintenance PPF" (2026-10-01).
  maintenanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 24,
    marginBottom: spacing.md,
    padding: 16,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
  },
  maintenanceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  maintenanceBannerTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  maintenanceBannerText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 2 },
  progressCard: {
    marginHorizontal: 24,
    marginBottom: spacing.md,
    padding: 20,
    gap: 16,
    borderRadius: 28,
    backgroundColor: colors.surfaceElevated,
  },
  progressCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  progressIconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  progressHeaderText: { flex: 1, gap: 2 },
  progressCardTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
  progressCardSubtitle: { fontSize: 13, color: colors.textSecondary },
  progressArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  progressStageBox: { gap: 2, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.bg },
  progressStageCaption: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  progressStageLabel: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: colors.textPrimary },
  progressTrack: { gap: 8 },
  progressTrackLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
  progressBarRow: { flexDirection: 'row', gap: 5 },
  progressBarSegmentWrap: { flex: 1 },
  progressBarSegment: { height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  progressBarSegmentActive: { backgroundColor: colors.accent },
  });
}