import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, FlatList, Pressable, StyleSheet,
  Platform, Image, ActivityIndicator, Modal, Linking, useWindowDimensions, Alert, Keyboard, AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { SheetModal, SheetButton, SheetTextInput } from '@/components/ui/SheetModal';
import { AutoGrowTextInput } from '@/components/ui/AutoGrowTextInput';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { maybePromptAppReview } from '@/lib/app-review';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';
import { useAppTheme } from '@/lib/theme-context';

interface StoreInfo {
  id: number;
  name: string;
  google_place_id: string | null;
}

type Sentiment = 'positive' | 'neutral' | 'negative';

// Dipakai bareng oleh modal review (pilihan sentimen) & kartu ringkasan
// "Ulasan kamu" setelah submit — sebelumnya array ini cuma inline di
// dalam modal, sekarang diekstrak supaya bisa dipakai ulang. Lihat audit
// modul Review Toko 2026-08-27.
const SENTIMENT_META: Record<Sentiment, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  positive: { label: 'Puas', icon: 'happy-outline' },
  neutral: { label: 'Biasa Saja', icon: 'remove-circle-outline' },
  negative: { label: 'Kurang Puas', icon: 'sad-outline' },
};

const REVIEW_COMMENT_MAX_LENGTH = 2000;

// Sama persis dengan StoreReview::TAGS di backend — kalau berubah di
// sana, samakan juga di sini.
// SEBELUMNYA tidak ada 'polarity' — semua 8 tag (4 positif + 4 negatif)
// tampil bercampur apa pun sentimen yang dipilih ("Puas" tetap
// menampilkan opsi "Pelayanan Kurang Ramah", dst), membingungkan.
// Sekarang difilter di render: sentimen positif cuma tampilkan tag
// positif, negatif cuma tag negatif, netral tampilkan semua (tidak
// condong ke salah satu). Ditemukan & diperbaiki 2026-08-28.
const REVIEW_TAGS: { key: string; label: string; polarity: 'positive' | 'negative' }[] = [
  { key: 'pelayanan_ramah', label: 'Pelayanan Ramah', polarity: 'positive' },
  { key: 'hasil_rapi', label: 'Hasil Rapi & Memuaskan', polarity: 'positive' },
  { key: 'harga_worth_it', label: 'Harga Sepadan (Worth It)', polarity: 'positive' },
  { key: 'proses_cepat', label: 'Proses Cepat', polarity: 'positive' },
  { key: 'pelayanan_kurang', label: 'Pelayanan Kurang Ramah', polarity: 'negative' },
  { key: 'hasil_kurang_rapi', label: 'Hasil Kurang Rapi', polarity: 'negative' },
  { key: 'harga_kurang_sesuai', label: 'Harga Kurang Sesuai', polarity: 'negative' },
  { key: 'proses_lambat', label: 'Proses Lambat', polarity: 'negative' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

// Riwayat status booking (audit modul Booking Instalasi 2026-09-25, gap
// "standar enterprise") — SEBELUMNYA customer cuma dapat push notif
// SEKALI saat status berubah (lihat BookingObserver::updated() di
// backend), tidak ada cara melihat ulang kapan pending→confirmed
// terjadi kalau notifnya terlewat/dimatikan. Datanya dibaca dari
// activity_log yang sudah lama tercatat, cuma baru sekarang
// disurfacekan lewat endpoint messages ini (lihat
// BookingMessageController::statusHistory() di backend).
const STATUS_HISTORY_META: Record<BookingStatus, { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  pending: { label: 'Menunggu Konfirmasi', icon: 'time-outline' },
  confirmed: { label: 'Dikonfirmasi Toko', icon: 'checkmark-circle-outline' },
  completed: { label: 'Selesai', icon: 'flag-outline' },
  cancelled: { label: 'Dibatalkan', icon: 'close-circle-outline' },
};

interface BookingMessage {
  id: number;
  sender_type: 'customer' | 'admin' | 'system';
  sender_name: string | null;
  type: 'text' | 'photo' | 'stage';
  body: string | null;
  stage: string | null;
  stage_label: string | null;
  photo_urls: string[];
  created_at: string;
}

type StageItem = { key: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] };

const KACA_FILM_STAGES: StageItem[] = [
  { key: 'kf_cleaning', label: 'Pembersihan', icon: 'water-outline' },
  { key: 'kf_heating', label: 'Pemanasan', icon: 'thermometer-outline' },
  { key: 'kf_installation', label: 'Instalasi Kaca Film', icon: 'build-outline' },
];
const PPF_STAGES: StageItem[] = [
  { key: 'ppf_washing', label: 'Proses Cuci', icon: 'water-outline' },
  { key: 'ppf_detailing', label: 'Detailing', icon: 'sparkles-outline' },
  { key: 'ppf_installation', label: 'Pemasangan PPF', icon: 'build-outline' },
];
const SHARED_STAGES: StageItem[] = [
  { key: 'qc', label: 'Quality Check', icon: 'shield-checkmark-outline' },
  { key: 'completed', label: 'Serah Terima Unit', icon: 'flag-outline' },
];

const POLL_INTERVAL_MS = 5000;

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateString: string): string {
  const d = new Date(dateString);
  const date = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `${date}, ${formatTime(dateString)}`;
}

// ─── Component ───────────────────────────────────────────────────────────────
// Customer lihat progress instalasi mobilnya di sini + bisa chat dengan
// admin toko. Update tahap & foto hanya bisa dikirim admin (lihat
// app/staff/bookings/[id].tsx) — customer di sini read-only untuk progress,
// hanya bisa kirim pesan teks.
export default function CustomerBookingChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [statusHistory, setStatusHistory] = useState<{ status: BookingStatus; changed_at: string }[]>([]);
  const [statusHistoryExpanded, setStatusHistoryExpanded] = useState(false);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [bookingStatus, setBookingStatus] = useState<BookingStatus | null>(null);
  // Gagal memuat PERTAMA kali (status belum pernah diketahui): tampilkan error
  // + coba lagi, bukan notice "menunggu konfirmasi" yang menyesatkan.
  const [loadFailed, setLoadFailed] = useState(false);
  const [secondaryStage, setSecondaryStage] = useState<string | null>(null);
  const [productKacaFilm, setProductKacaFilm] = useState(false);
  const [productPpf, setProductPpf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  // KeyboardAvoidingView bawaan RN tidak reliable di Android untuk
  // layar ini — sama bug dengan app/staff/bookings/[id].tsx, lihat
  // catatan di sana. Pola manual ini sudah terbukti jalan di
  // components/ui/PickerModal.tsx. Ditemukan & diperbaiki 2026-08-28.
  // Pengangkatan di atas keyboard dihitung dari seberapa banyak jendela sudah dikecilkan sistem (lihat lib/use-keyboard-lift.ts), supaya tidak
  // terangkat dua kali: kolom pesan tidak melayang jauh di atas keyboard di perangkat yang jendelanya sudah mengecil sendiri.
  const { lift: chatLift, onBoxLayout: onChatBoxLayout } = useKeyboardLift();
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  // Beberapa foto tahap diambil staff dalam posisi HP portrait padahal
  // objeknya landscape (mis. bodi mobil) — tombol flip ini biarkan customer
  // memutar tampilan foto di lightbox tanpa perlu edit file aslinya.
  const [viewerRotated, setViewerRotated] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isPortrait = screenHeight >= screenWidth;
  // Begitu device beneran diputar landscape, OS sudah merotasi layar —
  // reset flip manual supaya tidak dobel-rotate (sama seperti
  // app/account/my-gallery.tsx).
  useEffect(() => {
    if (!isPortrait) setViewerRotated(false);
  }, [isPortrait]);
  const [store, setStore] = useState<StoreInfo | null>(null);
  // Default tertutup — kalau semua track (Kaca Film + PPF + Tahap Akhir)
  // langsung tampil, kartu progress jadi terlalu tinggi dan menutupi
  // kolom chat di layar kecil.
  const [stageCardExpanded, setStageCardExpanded] = useState(false);

  // Review internal (hybrid: sentimen + tag + komentar opsional) —
  // TERPISAH dari review Google Maps. Google cuma diajak kalau sentimen
  // positif (lihat handleSubmitReview), supaya tidak menyembunyikan
  // keluhan tapi juga tidak aktif dorong publish keluhan ke publik.
  const [hasReview, setHasReview] = useState(false);
  // Ringkasan ulasan yang sudah dikirim — SEBELUMNYA cuma boolean
  // hasReview yang dipakai buat sembunyikan banner total, customer tidak
  // bisa lihat ulang apa yang mereka kirim dari dalam app. Lihat audit
  // modul Review Toko 2026-08-27.
  const [review, setReview] = useState<{ sentiment: Sentiment; comment: string | null; created_at: string } | null>(null);
  // Dismiss lokal per-sesi (bukan disimpan ke backend) — supaya customer
  // yang belum siap kasih review tidak terjebak melihat banner yang sama
  // setiap kali buka chat ini, tanpa harus benar-benar submit review cuma
  // untuk menghilangkannya. Muncul lagi kalau screen dibuka ulang dari
  // awal (mis. keluar-masuk app) — solusi ringan, bukan "jangan tampilkan
  // lagi selamanya" yang butuh kolom/flag tersendiri di backend.
  const [reviewBannerDismissed, setReviewBannerDismissed] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewSentiment, setReviewSentiment] = useState<Sentiment | null>(null);
  const [reviewTags, setReviewTags] = useState<string[]>([]);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // Polling incremental (?after_id=); penuh tiap ~1 menit. Tanpa argumen = penuh.
  const lastMessageIdRef = useRef(0);
  const pollTickRef = useRef(0);
  const fetchSeqRef = useRef(0);

  const fetchMessages = useCallback((incremental: boolean = false) => {
    const seq = ++fetchSeqRef.current;
    const afterId = incremental === true && lastMessageIdRef.current > 0 ? lastMessageIdRef.current : 0;
    return apiFetch<{
      data: {
        status: BookingStatus;
        status_history: { status: BookingStatus; changed_at: string }[];
        current_stage: string | null;
        secondary_stage: string | null;
        product_kaca_film: boolean;
        product_ppf: boolean;
        messages: BookingMessage[];
        store: StoreInfo | null;
        has_review: boolean;
        review: { sentiment: Sentiment; comment: string | null; created_at: string } | null;
      };
    }>(`/api/customer/bookings/${bookingId}/messages${afterId ? `?after_id=${afterId}` : ''}`)
      .then((res) => {
        if (seq !== fetchSeqRef.current) return;
        const incoming = res.data.messages;
        if (afterId) {
          if (incoming.length > 0) {
            setMessages((prev) => {
              const known = new Set(prev.map((m) => m.id));
              return [...prev, ...incoming.filter((m) => !known.has(m.id))];
            });
          }
        } else {
          setMessages(incoming);
          lastMessageIdRef.current = 0;
        }
        for (const m of incoming) {
          if (m.id > lastMessageIdRef.current) lastMessageIdRef.current = m.id;
        }
        setStatusHistory(res.data.status_history ?? []);
        setCurrentStage(res.data.current_stage);
        setBookingStatus(res.data.status);
        setSecondaryStage(res.data.secondary_stage);
        setProductKacaFilm(res.data.product_kaca_film);
        setProductPpf(res.data.product_ppf);
        setStore(res.data.store);
        setHasReview(res.data.has_review);
        setReview(res.data.review);
        setLoadFailed(false);
      })
      .catch(() => { setLoadFailed(true); /* polling akan coba lagi */ });
  }, [bookingId]);

  const handleReview = () => {
    if (!store?.google_place_id) return;
    Linking.openURL(`https://search.google.com/local/writereview?placeid=${store.google_place_id}`);
  };

  const toggleReviewTag = (key: string) => {
    setReviewTags((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  };

  const resetReviewForm = () => {
    setReviewSentiment(null);
    setReviewTags([]);
    setReviewComment('');
  };

  const handleSubmitReview = () => {
    if (!reviewSentiment || submittingReview) return;

    setSubmittingReview(true);
    apiFetch<{ data: { suggest_google_review: boolean } }>(`/api/customer/bookings/${bookingId}/review`, {
      method: 'POST',
      body: JSON.stringify({ sentiment: reviewSentiment, tags: reviewTags, comment: reviewComment.trim() || null }),
    })
      .then((res) => {
        setReviewModalOpen(false);
        setHasReview(true);
        setReview({ sentiment: reviewSentiment, comment: reviewComment.trim() || null, created_at: new Date().toISOString() });
        resetReviewForm();

        if (res.data.suggest_google_review && store?.google_place_id) {
          Alert.alert(
            'Terima kasih!',
            `Mau bagikan juga pengalamanmu di Google untuk ${store.name}? Ulasan apa pun, positif maupun masukan, sangat membantu.`,
            [
              { text: 'Nanti Saja', style: 'cancel' },
              { text: 'Beri Ulasan Google', onPress: handleReview },
            ],
          );
        } else {
          Alert.alert('Terima kasih!', 'Ulasanmu sudah kami terima dan akan jadi masukan buat kami.');
        }
      })
      .catch((err) => {
        const message = err instanceof ApiError ? err.message : 'Gagal mengirim ulasan. Coba lagi.';
        Alert.alert('Gagal', message);
      })
      .finally(() => setSubmittingReview(false));
  };

  useEffect(() => {
    fetchMessages().finally(() => setLoading(false));
    // Polling dijeda saat app di background (diperbaiki 2026-10-02) --
    // sebelumnya jalan terus tiap 5 detik walau layar tidak terlihat.
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!interval) {
        interval = setInterval(() => {
          pollTickRef.current += 1;
          fetchMessages(pollTickRef.current % 12 !== 0);
        }, POLL_INTERVAL_MS);
      }
    };
    const stop = () => { if (interval) { clearInterval(interval); interval = null; } };
    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { fetchMessages(); start(); } else { stop(); }
    });
    return () => { stop(); sub.remove(); };
  }, [fetchMessages]);

  // Momen kepuasan tertinggi: booking baru saja mencapai tahap "Selesai".
  // maybePromptAppReview() sendiri yang jaga supaya ini hanya benar-benar
  // muncul sekali seumur akun.
  useEffect(() => {
    if (currentStage === 'completed') {
      maybePromptAppReview();
    }
  }, [currentStage]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setInput('');
    apiFetch(`/api/customer/bookings/${bookingId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: trimmed }),
    })
      .then(() => fetchMessages())
      .then(() => setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100))
      .catch((err) => {
        // Kembalikan teks ke input supaya tidak hilang (diperbaiki
        // 2026-10-02) -- sebelumnya input dikosongkan dan kegagalan
        // tidak ditangani sama sekali.
        setInput(trimmed);
        Alert.alert('Pesan Gagal Terkirim', err instanceof Error ? err.message : 'Periksa koneksi internetmu, lalu coba lagi.');
      })
      .finally(() => setSending(false));
  };

  // Kepala: sorotan merah lembut, tombol kembali bulat, dan judul besar (sama dengan layar lain yang sudah didesain ulang).
  const HeaderBar = () => (
    <>
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />
      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle} numberOfLines={1}>Progress Instalasi</Text>
      </View>
    </>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const bothProducts = productKacaFilm && productPpf;
  const kacaFilmColumnValue = currentStage;
  const ppfColumnValue = bothProducts ? secondaryStage : currentStage;

  const stageLabelOf = (trackStages: StageItem[], columnValue: string | null) =>
    trackStages.find((s) => s.key === columnValue)?.label ?? null;

  const stageSummaryLabel = (() => {
    if (currentStage === 'qc' || currentStage === 'completed') {
      return stageLabelOf(SHARED_STAGES, currentStage) ?? '-';
    }
    if (bothProducts) {
      const kfDone = kacaFilmColumnValue === KACA_FILM_STAGES[KACA_FILM_STAGES.length - 1].key;
      const ppfDone = ppfColumnValue === PPF_STAGES[PPF_STAGES.length - 1].key;
      if (kfDone && ppfDone) return 'Menunggu Quality Check';
      const parts: string[] = [];
      if (!kfDone) parts.push(`Kaca Film: ${stageLabelOf(KACA_FILM_STAGES, kacaFilmColumnValue) ?? '-'}`);
      if (!ppfDone) parts.push(`PPF: ${stageLabelOf(PPF_STAGES, ppfColumnValue) ?? '-'}`);
      return parts.join('  ·  ') || '-';
    }
    if (productKacaFilm) return stageLabelOf(KACA_FILM_STAGES, kacaFilmColumnValue) ?? '-';
    if (productPpf) return stageLabelOf(PPF_STAGES, ppfColumnValue) ?? '-';
    return stageLabelOf(SHARED_STAGES, currentStage) ?? '-';
  })();

  const renderTrack = (trackStages: StageItem[], columnValue: string | null, label: string | null) => {
    const idx = trackStages.findIndex((s) => s.key === columnValue);
    return (
      <View key={label ?? 'shared'}>
        {label && <Text style={styles.stageTrackLabel}>{label}</Text>}
        <View style={styles.stageTrackWrap}>
          <View style={[styles.stageLineTrack, { left: `${50 / trackStages.length}%`, right: `${50 / trackStages.length}%` }]} pointerEvents="none">
            <View style={styles.stageLineBg} />
            <View
              style={[
                styles.stageLineFg,
                { width: `${(Math.max(idx, 0) / (trackStages.length - 1)) * 100}%` },
              ]}
            />
          </View>
          <View style={styles.stageDotsRow}>
            {trackStages.map((s, i) => {
              const isDone = i <= idx;
              const isCurrent = i === idx;
              return (
                <View key={s.key} style={styles.stageStep}>
                  <View style={[styles.stageDot, isDone && styles.stageDotActive]}>
                    <Ionicons name={s.icon} size={14} color={isDone ? '#ffffff' : colors.textMuted} />
                  </View>
                  <Text style={[styles.stageLabel, isCurrent && styles.stageLabelActive]}>{s.label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar />

      {currentStage === 'completed' && !hasReview && !reviewBannerDismissed && (
        <Pressable style={styles.reviewBanner} onPress={() => setReviewModalOpen(true)}>
          <Ionicons name="star" size={20} color={colors.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewBannerTitle}>Instalasi selesai! Puas dengan layanan kami?</Text>
            <Text style={styles.reviewBannerSubtitle}>Beri ulasan untuk {store?.name ?? 'toko'}</Text>
          </View>
          <Pressable
            hitSlop={10}
            onPress={(e) => { e.stopPropagation(); setReviewBannerDismissed(true); }}
            accessibilityRole="button"
            accessibilityLabel="Tutup ajakan ulasan"
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </Pressable>
      )}

      {/* Ringkasan ulasan yang sudah dikirim — SEBELUMNYA banner cuma
          disembunyikan total setelah submit, customer tidak bisa lihat
          ulang apa yang mereka kirim tanpa buka Filament (yang mereka
          tak punya akses). Lihat audit modul Review Toko 2026-08-27. */}
      {currentStage === 'completed' && hasReview && review && (
        <View style={styles.reviewSummaryCard}>
          <Ionicons name={SENTIMENT_META[review.sentiment].icon} size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewSummaryTitle}>
              Ulasanmu: {SENTIMENT_META[review.sentiment].label}
            </Text>
            {review.comment ? (
              <Text style={styles.reviewSummaryComment} numberOfLines={2}>{review.comment}</Text>
            ) : null}
          </View>
        </View>
      )}

      {statusHistory.length > 0 && (
        <View style={styles.stageCard}>
          <Pressable
            style={styles.stageSummaryRow}
            onPress={() => setStatusHistoryExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Riwayat status booking"
            accessibilityState={{ expanded: statusHistoryExpanded }}
          >
            <View style={styles.stageSummaryIcon}><Ionicons name="receipt-outline" size={16} color={colors.accent} /></View>
            <Text style={styles.stageSummaryText} numberOfLines={1}>
              Riwayat Status Booking
            </Text>
            <Ionicons
              name={statusHistoryExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
          {statusHistoryExpanded && (
            <View style={styles.stageCardBody}>
              {statusHistory.map((entry, i) => {
                const meta = STATUS_HISTORY_META[entry.status];
                return (
                  <View key={`${entry.status}-${entry.changed_at}-${i}`} style={styles.statusHistoryRow}>
                    <Ionicons name={meta.icon} size={16} color={colors.accent} />
                    <Text style={styles.statusHistoryLabel}>{meta.label}</Text>
                    <Text style={styles.statusHistoryTime}>{formatDateTime(entry.changed_at)}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {loadFailed && bookingStatus === null && (
        <View style={styles.pendingNotice}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.pendingNoticeText}>Tidak bisa memuat status booking. Periksa koneksi internetmu.</Text>
          <Pressable onPress={() => { fetchMessages(); }} accessibilityRole="button" accessibilityLabel="Coba lagi memuat">
            <Text style={[styles.pendingNoticeText, { color: colors.accent, fontWeight: '600' }]}>Coba lagi</Text>
          </Pressable>
        </View>
      )}

      {!(loadFailed && bookingStatus === null) && !currentStage && !secondaryStage && (
        <View style={styles.pendingNotice}>
          <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.pendingNoticeText}>
            {bookingStatus === 'cancelled'
              ? 'Booking ini sudah dibatalkan.'
              : bookingStatus === 'confirmed'
                ? 'Bookingmu sudah dikonfirmasi. Progress instalasi akan muncul di sini begitu pengerjaan dimulai.'
                : 'Bookingmu sedang menunggu konfirmasi toko. Progress instalasi akan muncul di sini begitu toko mengonfirmasi jadwalmu.'}
          </Text>
        </View>
      )}

      {(currentStage || secondaryStage) && (
        <View style={styles.stageCard}>
          <Pressable
            style={styles.stageSummaryRow}
            onPress={() => setStageCardExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Ringkasan tahap pengerjaan"
            accessibilityState={{ expanded: stageCardExpanded }}
          >
            <View style={styles.stageSummaryIcon}><Ionicons name="flag-outline" size={16} color={colors.accent} /></View>
            <Text style={styles.stageSummaryText} numberOfLines={1}>{stageSummaryLabel}</Text>
            <Ionicons
              name={stageCardExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
          {stageCardExpanded && (
            <View style={styles.stageCardBody}>
              {productKacaFilm && renderTrack(KACA_FILM_STAGES, kacaFilmColumnValue, bothProducts ? 'Kaca Film' : null)}
              {productPpf && renderTrack(PPF_STAGES, ppfColumnValue, bothProducts ? 'PPF' : null)}
              {renderTrack(SHARED_STAGES, currentStage, (productKacaFilm || productPpf) ? 'Tahap Akhir' : null)}
            </View>
          )}
        </View>
      )}

      <View style={styles.flex} onLayout={onChatBoxLayout}>
      <View style={[styles.flex, { marginBottom: chatLift }]}>
        <FlatList
          ref={listRef}
          // Sama bug dengan layar chat staff — tanpa style={flex:1} list
          // menyusut mengikuti kontennya sendiri, kolom input jadi
          // "naik" nempel di bawah pesan terakhir alih-alih di bawah
          // layar begitu pesannya sedikit. Ditemukan & diperbaiki
          // 2026-08-28.
          style={styles.flex}
          data={[...messages].reverse()}
          keyExtractor={(item) => String(item.id)}
          inverted
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onPhotoPress={(url) => { setViewerImage(url); setViewerRotated(false); }}
              styles={styles}
              colors={colors}
            />
          )}
        />

        {/* +spacing.sm ekstra — sama alasan dengan layar chat staff. */}
        {bookingStatus !== 'cancelled' && (
        <View style={[styles.inputBar, { paddingBottom: (insets.bottom > 0 ? insets.bottom : spacing.sm) + spacing.sm }]}>
          <AutoGrowTextInput
            style={styles.input}
            minHeight={48}
            maxHeight={110}
            placeholder="Ketik pesan ke toko..."
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
          />
          <Pressable style={styles.sendBtn} onPress={handleSend} disabled={sending || !input.trim()} accessibilityRole="button" accessibilityLabel="Kirim pesan" accessibilityState={{ disabled: sending || !input.trim(), busy: sending }}>
            {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="send" size={18} color="#ffffff" />}
          </Pressable>
        </View>
        )}
      </View>
      </View>

      {/* Lightbox — tap foto untuk lihat ukuran penuh */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerImage(null)}>
          {viewerImage && (
            <Image
              source={{ uri: viewerImage }}
              style={
                viewerRotated
                  ? { width: screenHeight * 0.8, height: screenWidth * 0.9, transform: [{ rotate: '90deg' }] }
                  : styles.viewerImage
              }
              resizeMode="contain"
            />
          )}
          {isPortrait && (
            <Pressable
              style={styles.viewerRotateBtn}
              onPress={() => setViewerRotated((v) => !v)}
            >
              <Ionicons name="phone-landscape-outline" size={22} color="#ffffff" />
            </Pressable>
          )}
          <Pressable style={styles.viewerCloseBtn} onPress={() => setViewerImage(null)} accessibilityRole="button" accessibilityLabel="Tutup foto">
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Review internal — sentimen + tag aspek + komentar opsional. Memakai SheetModal bersama (lihat components/ui/SheetModal.tsx). */}
      <SheetModal
        visible={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        icon="star-outline"
        title="Bagaimana pengalamanmu?"
        subtitle={store?.name ? `Ceritakan pengalamanmu di ${store.name}.` : 'Ceritakan pengalamanmu.'}
        actions={
          reviewSentiment ? (
            <SheetButton label="Kirim Ulasan" variant="primary" onPress={handleSubmitReview} loading={submittingReview} />
          ) : (
            <SheetButton label="Nanti Saja" onPress={() => setReviewModalOpen(false)} />
          )
        }
      >
        <View style={styles.reviewSentimentRow}>
          {(Object.entries(SENTIMENT_META) as [Sentiment, typeof SENTIMENT_META[Sentiment]][]).map(([key, opt]) => {
            const active = reviewSentiment === key;
            return (
              <PressableScale
                key={key}
                style={[styles.reviewSentimentBtn, active && styles.reviewSentimentBtnActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setReviewSentiment(key);
                  // Reset tag yang sudah dipilih — kalau tidak, tag
                  // dari polaritas sebelumnya (mis. "Proses Lambat"
                  // waktu masih pilih "Kurang Puas") tetap tersimpan
                  // di state & ikut terkirim diam-diam walau sudah
                  // tidak terlihat lagi setelah ganti ke "Puas".
                  setReviewTags([]);
                }}
              >
                <Ionicons name={opt.icon} size={32} color={active ? '#ffffff' : colors.accent} />
                <Text style={[styles.reviewSentimentLabel, active && styles.reviewSentimentLabelActive]}>{opt.label}</Text>
              </PressableScale>
            );
          })}
        </View>

        {reviewSentiment ? (
          <>
            <View style={{ gap: 10 }}>
              <Text style={styles.reviewSectionLabel}>Apa yang paling terasa? <Text style={styles.reviewOptional}>(opsional)</Text></Text>
              <View style={styles.reviewTagsWrap}>
                {REVIEW_TAGS.filter((tag) => reviewSentiment === 'neutral' || tag.polarity === reviewSentiment).map((tag) => {
                  const active = reviewTags.includes(tag.key);
                  return (
                    <PressableScale
                      key={tag.key}
                      style={[styles.reviewTagChip, active && styles.reviewTagChipActive]}
                      onPress={() => toggleReviewTag(tag.key)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                    >
                      {active ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
                      <Text style={[styles.reviewTagChipText, active && styles.reviewTagChipTextActive]}>{tag.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
            </View>

            {/* Backend membatasi komentar max:2000 (StoreReviewController::store()); hitungan karakter menampilkannya. */}
            <SheetTextInput
              label="Komentar tambahan (opsional)"
              placeholder="Ceritakan pengalamanmu lebih lanjut..."
              value={reviewComment}
              onChangeText={setReviewComment}
              maxLength={REVIEW_COMMENT_MAX_LENGTH}
              multiline
            />
          </>
        ) : null}
      </SheetModal>
    </SafeAreaView>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onPhotoPress,
  styles,
  colors,
}: {
  message: BookingMessage;
  onPhotoPress: (url: string) => void;
  styles: ReturnType<typeof createStyles>;
  colors: typeof darkColors;
}) {
  const isCustomer = message.sender_type === 'customer';

  // Update tahap sekarang tampil sebagai kartu milestone (bukan pill kecil
  // mengambang) — supaya progress instalasi terasa seperti pencapaian
  // nyata, konsisten dengan kartu progress di atas kolom chat, bukan
  // menyatu jadi pesan chat biasa yang gampang kelewat di scroll.
  if (message.type === 'stage') {
    return (
      <View style={styles.stageCardWrap}>
        <View style={styles.stageCardMsg}>
          <View style={styles.stageCardHeader}>
            <View style={styles.stageCardIconWrap}>
              <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
            </View>
            <View style={styles.stageCardHeaderText}>
              <Text style={styles.stageCardEyebrow}>Tahap Selesai</Text>
              <Text style={styles.stageCardTitle}>{message.stage_label}</Text>
            </View>
            <Text style={styles.stageCardTime}>{formatDateTime(message.created_at)}</Text>
          </View>
          {message.photo_urls.length > 0 && (
            <PhotoGrid photoUrls={message.photo_urls} onPhotoPress={onPhotoPress} styles={styles} inCard />
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleWrap, isCustomer ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
      {!isCustomer && message.sender_name && <Text style={styles.senderLabel}>{message.sender_name}</Text>}
      <View style={[styles.bubble, isCustomer ? styles.bubbleCustomerSelf : styles.bubbleAdmin]}>
        {message.photo_urls.length > 0 && (
          <PhotoGrid photoUrls={message.photo_urls} onPhotoPress={onPhotoPress} styles={styles} />
        )}
        {message.body && (
          <Text style={[styles.bubbleText, isCustomer && styles.bubbleTextSelf]}>{message.body}</Text>
        )}
      </View>
      <Text style={styles.messageTime}>{formatTime(message.created_at)}</Text>
    </View>
  );
}

// Grid kecil untuk beberapa foto dalam 1 pesan — 1 foto tetap tampil besar
// seperti sebelumnya, 2+ foto disusun 2 kolom supaya tidak makan tempat.
function PhotoGrid({
  photoUrls,
  onPhotoPress,
  styles,
  inCard,
}: {
  photoUrls: string[];
  onPhotoPress: (url: string) => void;
  styles: ReturnType<typeof createStyles>;
  inCard?: boolean;
}) {
  const singlePhotoStyle = inCard ? styles.stagePhoto : styles.bubblePhoto;
  const gridStyle = inCard ? styles.photoGridInCard : styles.photoGrid;

  if (photoUrls.length === 1) {
    return (
      <Pressable onPress={() => onPhotoPress(photoUrls[0])}>
        <Image source={{ uri: photoUrls[0] }} style={singlePhotoStyle} />
      </Pressable>
    );
  }

  const itemStyle = inCard ? styles.photoGridItemInCard : styles.photoGridItem;

  return (
    <View style={gridStyle}>
      {photoUrls.map((url) => (
        <Pressable key={url} onPress={() => onPhotoPress(url)} style={inCard ? styles.photoGridItemWrap : undefined}>
          <Image source={{ uri: url }} style={itemStyle} />
        </Pressable>
      ))}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    // Kartu-kartu di atas percakapan: sudut besar, tanpa bingkai, berjarak dari tepi layar.
    reviewBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, marginBottom: 10, padding: 14, borderRadius: 22, backgroundColor: colors.accentSoft },
    reviewBannerTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    reviewBannerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

    reviewSummaryCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: 24, marginBottom: 10, padding: 14, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    reviewSummaryTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    reviewSummaryComment: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 2 },

    // Isi lembar ulasan (kerangka lembar ada di SheetModal).
    reviewSentimentRow: { flexDirection: 'row', gap: 10 },
    reviewSentimentBtn: { flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: 24, gap: 8, backgroundColor: colors.surfaceElevated },
    reviewSentimentBtnActive: { backgroundColor: colors.accent },
    reviewSentimentLabel: { fontSize: 13, color: colors.textPrimary, fontWeight: '700' },
    reviewSentimentLabelActive: { color: '#ffffff', fontWeight: '800' },
    reviewSectionLabel: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    reviewOptional: { fontWeight: '500', color: colors.textMuted },
    reviewTagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    reviewTagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.surfaceElevated },
    reviewTagChipActive: { backgroundColor: colors.accent },
    reviewTagChipText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    reviewTagChipTextActive: { color: '#ffffff', fontWeight: '800' },

    pendingNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 24, marginBottom: 10, padding: 14, borderRadius: 20, backgroundColor: colors.surfaceElevated },
    pendingNoticeText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.textSecondary },

    stageCard: { marginHorizontal: 24, marginBottom: 10, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 22, backgroundColor: colors.surfaceElevated },
    stageSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
    stageSummaryIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    stageSummaryText: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    stageCardBody: { gap: 16, paddingTop: 6, paddingBottom: 12 },
    statusHistoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    statusHistoryLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    statusHistoryTime: { fontSize: 12, color: colors.textMuted },
    stageTrackWrap: { position: 'relative' },
    stageTrackLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
    // Garis dirender terpisah dari titik, absolut di belakangnya, supaya posisi titik dan label tidak bergeser oleh perhitungan garis.
    // Inset kiri-kanan dihitung per jumlah tahap (lihat renderTrack).
    stageLineTrack: { position: 'absolute', top: 13, height: 3 },
    stageLineBg: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: colors.borderStrong },
    stageLineFg: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: colors.accent },
    stageDotsRow: { flexDirection: 'row' },
    stageStep: { flex: 1, alignItems: 'center' },
    stageDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    stageDotActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    stageLabel: { fontSize: 12, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
    stageLabelActive: { color: colors.accent, fontWeight: '800' },

    messageList: { paddingHorizontal: 24, paddingVertical: 16, gap: 14 },

    // alignItems per sisi WAJIB diisi eksplisit: default RN 'stretch' membuat child (gelembung, nama pengirim, jam) menyesuaikan lebar
    // sibling terlebar (nama pengirim), sama bug yang sudah diperbaiki di layar chat staff.
    bubbleWrap: { maxWidth: '80%', gap: 4 },
    bubbleWrapLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
    bubbleWrapRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    senderLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginLeft: 8 },
    bubble: { borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, overflow: 'hidden' },
    bubbleAdmin: { backgroundColor: colors.surfaceElevated, borderBottomLeftRadius: 6 },
    bubbleCustomerSelf: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
    bubbleText: { fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
    bubbleTextSelf: { color: '#ffffff' },
    bubblePhoto: { width: 200, height: 150, borderRadius: 14, marginBottom: 6 },
    messageTime: { fontSize: 11, color: colors.textMuted, marginHorizontal: 6 },

    // Kartu tahap selesai: ikon, judul, waktu, dan foto dalam satu kartu supaya mudah dipindai saat menggulir.
    stageCardWrap: { marginVertical: 4 },
    stageCardMsg: { padding: 14, gap: 12, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    stageCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    stageCardIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    stageCardHeaderText: { flex: 1 },
    stageCardEyebrow: { fontSize: 11, fontWeight: '800', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.8 },
    stageCardTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
    stageCardTime: { fontSize: 12, color: colors.textMuted },
    stagePhoto: { width: '100%', height: 190, borderRadius: 18 },

    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, width: 200, marginBottom: 6 },
    photoGridInCard: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    photoGridItem: { width: 98, height: 98, borderRadius: 12 },
    // Beda dari grid di gelembung (lebar tetap 200): kartu tahap selebar layar, jadi item grid memakai flexBasis persen (3 per baris).
    photoGridItemWrap: { flexBasis: '31%', flexGrow: 1 },
    photoGridItemInCard: { width: '100%', aspectRatio: 1, borderRadius: 14 },

    viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
    viewerImage: { width: '100%', height: '80%' },
    viewerCloseBtn: { position: 'absolute', top: 48, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    viewerRotateBtn: { position: 'absolute', top: 48, right: 72, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

    inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 24, paddingTop: 10, backgroundColor: colors.bg },
    input: { flex: 1, minHeight: 48, maxHeight: 110, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 13, textAlignVertical: 'center', fontSize: 15, color: colors.textPrimary, backgroundColor: colors.surfaceElevated },
    sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  });
}
