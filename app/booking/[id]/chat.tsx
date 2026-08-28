import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet,
  Platform, Image, ActivityIndicator, Modal, Linking, useWindowDimensions, Alert, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { maybePromptAppReview } from '@/lib/app-review';
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
const REVIEW_TAGS: { key: string; label: string }[] = [
  { key: 'pelayanan_ramah', label: 'Pelayanan Ramah' },
  { key: 'hasil_rapi', label: 'Hasil Rapi & Memuaskan' },
  { key: 'harga_worth_it', label: 'Harga Sepadan (Worth It)' },
  { key: 'proses_cepat', label: 'Proses Cepat' },
  { key: 'pelayanan_kurang', label: 'Pelayanan Kurang Ramah' },
  { key: 'hasil_kurang_rapi', label: 'Hasil Kurang Rapi' },
  { key: 'harga_kurang_sesuai', label: 'Harga Kurang Sesuai' },
  { key: 'proses_lambat', label: 'Proses Lambat' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

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
  const [currentStage, setCurrentStage] = useState<string | null>(null);
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
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

  const fetchMessages = useCallback(() => {
    return apiFetch<{
      data: {
        current_stage: string | null;
        secondary_stage: string | null;
        product_kaca_film: boolean;
        product_ppf: boolean;
        messages: BookingMessage[];
        store: StoreInfo | null;
        has_review: boolean;
        review: { sentiment: Sentiment; comment: string | null; created_at: string } | null;
      };
    }>(`/api/customer/bookings/${bookingId}/messages`)
      .then((res) => {
        setMessages(res.data.messages);
        setCurrentStage(res.data.current_stage);
        setSecondaryStage(res.data.secondary_stage);
        setProductKacaFilm(res.data.product_kaca_film);
        setProductPpf(res.data.product_ppf);
        setStore(res.data.store);
        setHasReview(res.data.has_review);
        setReview(res.data.review);
      })
      .catch(() => { /* silent, polling akan coba lagi */ });
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
            `Senang mendengarnya! Mau bagikan juga pengalamanmu di Google untuk ${store.name}?`,
            [
              { text: 'Nanti Saja', style: 'cancel' },
              { text: 'Beri Ulasan Google', onPress: handleReview },
            ],
          );
        } else {
          Alert.alert('Terima kasih!', 'Ulasan kamu sudah kami terima dan akan jadi masukan buat kami.');
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
    const interval = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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
      .finally(() => setSending(false));
  };

  const HeaderBar = () => (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sideButton} />
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>Progress Instalasi</Text>
      <View style={styles.sideButton} />
    </View>
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
          <View style={styles.stageLineTrack} pointerEvents="none">
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
                    <Ionicons name={s.icon} size={12} color={isDone ? '#ffffff' : colors.textMuted} />
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
              Ulasan kamu: {SENTIMENT_META[review.sentiment].label}
            </Text>
            {review.comment ? (
              <Text style={styles.reviewSummaryComment} numberOfLines={2}>{review.comment}</Text>
            ) : null}
          </View>
        </View>
      )}

      {!currentStage && (
        <View style={styles.pendingNotice}>
          <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.pendingNoticeText}>
            Booking Anda sedang menunggu konfirmasi toko. Progress instalasi akan muncul di sini begitu toko mengonfirmasi jadwal Anda.
          </Text>
        </View>
      )}

      {currentStage && (
        <View style={styles.stageCard}>
          <Pressable
            style={styles.stageSummaryRow}
            onPress={() => setStageCardExpanded((v) => !v)}
          >
            <Ionicons name="flag-outline" size={14} color={colors.accent} />
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

      <View style={[styles.flex, { marginBottom: keyboardHeight }]}>
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
        <View style={[styles.inputBar, { paddingBottom: (insets.bottom > 0 ? insets.bottom : spacing.sm) + spacing.sm }]}>
          <TextInput
            style={styles.input}
            placeholder="Ketik pesan ke toko..."
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
          />
          <Pressable style={styles.sendBtn} onPress={handleSend} disabled={sending || !input.trim()}>
            {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="send" size={18} color="#ffffff" />}
          </Pressable>
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
          <Pressable style={styles.viewerCloseBtn} onPress={() => setViewerImage(null)}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Review internal — sentimen + tag aspek + komentar opsional. */}
      <Modal
        visible={reviewModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewModalOpen(false)}
      >
        <View style={styles.reviewModalBackdrop}>
          <View style={styles.reviewModalCard}>
            <View style={styles.reviewModalHeader}>
              <Text style={styles.reviewModalTitle}>Bagaimana pengalamanmu?</Text>
              <Pressable onPress={() => setReviewModalOpen(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.reviewSentimentRow}>
              {(Object.entries(SENTIMENT_META) as [Sentiment, typeof SENTIMENT_META[Sentiment]][]).map(([key, opt]) => {
                const active = reviewSentiment === key;
                return (
                  <Pressable
                    key={key}
                    style={[styles.reviewSentimentBtn, active && styles.reviewSentimentBtnActive]}
                    onPress={() => setReviewSentiment(key)}
                  >
                    <Ionicons name={opt.icon} size={26} color={active ? '#ffffff' : colors.textPrimary} />
                    <Text style={[styles.reviewSentimentLabel, active && styles.reviewSentimentLabelActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {reviewSentiment && (
              <>
                <Text style={styles.reviewSectionLabel}>Apa yang paling terasa? (opsional)</Text>
                <View style={styles.reviewTagsWrap}>
                  {REVIEW_TAGS.map((tag) => {
                    const active = reviewTags.includes(tag.key);
                    return (
                      <Pressable
                        key={tag.key}
                        style={[styles.reviewTagChip, active && styles.reviewTagChipActive]}
                        onPress={() => toggleReviewTag(tag.key)}
                      >
                        <Text style={[styles.reviewTagChipText, active && styles.reviewTagChipTextActive]}>
                          {tag.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.reviewSectionLabelRow}>
                  <Text style={styles.reviewSectionLabel}>Komentar tambahan (opsional)</Text>
                  {/* Sebelumnya tidak ada validasi panjang di client sama
                      sekali — baru gagal setelah request ke server kalau
                      user paste teks sangat panjang. Backend membatasi
                      max:2000 (lihat StoreReviewController::store()).
                      Lihat audit modul Review Toko 2026-08-27. */}
                  <Text style={styles.reviewCharCount}>
                    {reviewComment.length}/{REVIEW_COMMENT_MAX_LENGTH}
                  </Text>
                </View>
                <TextInput
                  style={styles.reviewCommentInput}
                  placeholder="Ceritakan pengalamanmu lebih lanjut..."
                  placeholderTextColor={colors.textMuted}
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  maxLength={REVIEW_COMMENT_MAX_LENGTH}
                  multiline
                  numberOfLines={3}
                />

                <Pressable
                  style={[styles.reviewSubmitBtn, submittingReview && styles.reviewSubmitBtnDisabled]}
                  onPress={handleSubmitReview}
                  disabled={submittingReview}
                >
                  {submittingReview ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.reviewSubmitBtnText}>Kirim Ulasan</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
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

  reviewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.accentSoft,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  reviewBannerTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  reviewBannerSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  reviewSummaryCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  reviewSummaryTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  reviewSummaryComment: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },

  reviewModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  reviewModalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  reviewModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  reviewModalTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  reviewSentimentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  reviewSentimentBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  reviewSentimentBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  reviewSentimentLabel: { fontSize: fontSize.xs, color: colors.textPrimary, fontWeight: '600' },
  reviewSentimentLabelActive: { color: '#ffffff' },
  reviewSectionLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  reviewSectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewCharCount: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  reviewTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  reviewTagChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill ?? 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewTagChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  reviewTagChipText: { fontSize: fontSize.xs, color: colors.textPrimary },
  reviewTagChipTextActive: { color: '#ffffff', fontWeight: '600' },
  reviewCommentInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  reviewSubmitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  reviewSubmitBtnDisabled: { opacity: 0.6 },
  reviewSubmitBtnText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },

  pendingNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pendingNoticeText: {
    flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17,
  },
  stageCard: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  stageSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 4,
  },
  stageSummaryText: { flex: 1, fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary },
  stageCardBody: { gap: spacing.sm, marginTop: spacing.xs },
  stageTrackWrap: { position: 'relative' },
  stageTrackLabel: {
    fontSize: 10, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  // Garis dirender terpisah dari dot, absolute di belakang — supaya
  // posisi dot/label (diatur murni oleh flex row + alignItems:center)
  // tidak pernah kegeser oleh perhitungan garis. Insetnya 10% kiri-kanan
  // karena tiap dot center ada di tengah segmen 1/5 lebar (5 tahap).
  stageLineTrack: {
    position: 'absolute', top: 10, left: '10%', right: '10%', height: 2,
  },
  stageLineBg: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colors.border },
  stageLineFg: { position: 'absolute', left: 0, height: 2, backgroundColor: colors.accent },
  stageDotsRow: { flexDirection: 'row' },
  stageStep: { flex: 1, alignItems: 'center' },
  stageDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stageDotActive: { backgroundColor: colors.accent },
  stageLabel: { fontSize: 9, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  stageLabelActive: { color: colors.accent, fontWeight: '700' },

  messageList: { padding: spacing.md, gap: spacing.md },

  bubbleWrap: { maxWidth: '78%', gap: 3 },
  bubbleWrapLeft: { alignSelf: 'flex-start' },
  bubbleWrapRight: { alignSelf: 'flex-end' },
  senderLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginLeft: 6 },
  bubble: {
    borderRadius: radius.lg, padding: spacing.sm, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3,
    elevation: 1,
  },
  bubbleAdmin: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleCustomerSelf: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20 },
  bubbleTextSelf: { color: '#ffffff' },
  bubblePhoto: { width: 200, height: 150, borderRadius: radius.sm, marginBottom: 6 },
  messageTime: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginRight: 4 },

  // Kartu milestone tahap — dulu pill kecil mengambang + foto terpisah,
  // sekarang 1 kartu utuh (ikon, judul tahap, waktu, foto) supaya progress
  // instalasi terasa seperti pencapaian, gampang dipindai saat scroll.
  stageCardWrap: { marginVertical: spacing.xs },
  stageCardMsg: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accent + '33',
    padding: spacing.sm, gap: spacing.xs,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3,
    elevation: 1,
  },
  stageCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stageCardIconWrap: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stageCardHeaderText: { flex: 1 },
  stageCardEyebrow: {
    fontSize: 9, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  stageCardTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginTop: 1 },
  stageCardTime: { fontSize: 10, color: colors.textMuted },
  stagePhoto: { width: '100%', height: 180, borderRadius: radius.md },

  photoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4,
    width: 200, marginBottom: 6,
  },
  photoGridInCard: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4,
  },
  photoGridItem: { width: 98, height: 98, borderRadius: radius.sm },
  // Beda dari grid di bubble (lebar tetap 200) — kartu tahap full-width,
  // jadi item grid pakai flexBasis persen supaya rapi mengisi lebar kartu
  // berapa pun jumlah fotonya (3 per baris).
  photoGridItemWrap: { flexBasis: '32%', flexGrow: 1 },
  photoGridItemInCard: { width: '100%', aspectRatio: 1, borderRadius: radius.sm },

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

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 100, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 8,
    fontSize: fontSize.sm, color: colors.textPrimary,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  });
}
