import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet, ScrollView,
  Platform, Image, ActivityIndicator, Alert, Modal, Linking, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError as StaffApiError } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useAppTheme } from '@/lib/theme-context';

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

interface StaffOption {
  id: number;
  name: string;
  // Cuma terisi untuk installer yang punya baris di roster Teknisi (lihat
  // TechnicianResource) — direksi (watchers) tidak punya level. Backend
  // sudah menyembunyikan installer 'pending_review'/'inactive' dari
  // daftar ini sama sekali, jadi apa yang tampil di sini selalu boleh
  // ditugaskan. Lihat audit modul Teknisi 2026-08-27.
  level?: 'intermediate' | 'advanced' | 'mentor' | null;
}

const TECHNICIAN_LEVEL_LABEL: Record<string, string> = {
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  mentor: 'Mentor',
};

interface BookingDetail {
  installers: StaffOption[];
  watchers: StaffOption[];
}

type StageItem = { key: string; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] };

// Kaca Film & PPF punya 3 tahap awal sendiri-sendiri (beda nama/urutan),
// baru menyatu di 2 tahap akhir bersama (SHARED_STAGES) — booking yang
// pesan KEDUANYA jalan paralel (Kaca Film di `current_stage`, PPF di
// `secondary_stage`); yang cuma 1 produk tetap pakai `current_stage` saja
// persis seperti sebelumnya. Lihat getTrackColumn().
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

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function StaffBookingChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = Number(id);
  const { staff } = useStaffAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Installer cuma boleh chat teks — foto & update tahap wewenang Store
  // Manager/Direksi (lihat validasi yang sama di backend).
  const canManageProgress = staff?.role !== 'installer';

  const [messages, setMessages] = useState<BookingMessage[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  // Cuma terisi untuk track PPF, dan cuma dipakai kalau booking-nya punya
  // KEDUA produk (progress paralel) — lihat getTrackColumn().
  const [secondaryStage, setSecondaryStage] = useState<string | null>(null);
  const [productKacaFilm, setProductKacaFilm] = useState(false);
  const [productPpf, setProductPpf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  // Strip progress default tertutup (cuma ringkasan 1 baris) — kalau
  // langsung tampil semua track (Kaca Film + PPF + Tahap Akhir) terlalu
  // tinggi dan menutupi kolom chat di layar kecil.
  const [stageStripExpanded, setStageStripExpanded] = useState(false);
  // Tahap yang baru saja "Ditandai" di sesi picker yang sedang terbuka —
  // dipakai untuk kunci tombol "Tandai" tahap itu & buka tombol kamera-nya,
  // supaya alurnya: Tandai dulu (kirim pesan tahap) → baru boleh susulkan
  // foto (tanpa bikin pesan tahap dobel).
  const [markedStage, setMarkedStage] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<'pending' | 'confirmed' | 'completed' | 'cancelled' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmDurationDays, setConfirmDurationDays] = useState('1');
  // Kapasitas tim instalasi bisa BEDA-BEDA tiap tanggal (mis. 1 tim masih
  // ngerjain mobil dari hari sebelumnya, atau izin) — 1 baris per tanggal,
  // termasuk baris hari libur (non-editable, cuma penanda) supaya staff
  // tahu kenapa ada lompatan tanggal — bukan 1 angka global. Dimuat dari
  // GET .../capacity-preview, default per tanggal dari setting toko
  // tapi tetap bisa diedit staff sebelum submit.
  const [capacityRows, setCapacityRows] = useState<
    ({ date: string; closed: true } | { date: string; closed: false; used: number; capacity: string })[]
  >([]);
  const [loadingCapacity, setLoadingCapacity] = useState(false);
  // Durasi yang dipakai saat capacityRows terakhir dimuat — dibandingkan
  // saat submit supaya kalau staff ubah durasi tanpa sempat reload
  // otomatis (mis. race jaringan lambat), submit ditolak DI SISI APP dulu
  // (bukan diam-diam kirim kapasitas yang belum pernah staff lihat/setujui
  // untuk tanggal tambahan).
  const [capacityLoadedForDuration, setCapacityLoadedForDuration] = useState<number | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  // KeyboardAvoidingView bawaan RN TERNYATA tidak reliable di Android
  // untuk layar ini — behavior="height" bisa macet di tinggi lama
  // setelah keyboard sempat muncul/hilang akibat interaksi lain (mis.
  // update tahap), meninggalkan ruang kosong di bawah kolom input;
  // behavior={undefined} malah bikin keyboard nutupin kolom input
  // sepenuhnya. Pola ini SUDAH TERBUKTI jalan di components/ui/
  // PickerModal.tsx (fix 2026-08-27) — lacak tinggi keyboard manual,
  // dorong kolom input naik sejumlah itu sendiri, tidak bergantung
  // behavior bawaan sama sekali. Ditemukan & diperbaiki 2026-08-28.
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

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [installerOptions, setInstallerOptions] = useState<StaffOption[]>([]);
  const [direksiOptions, setDireksiOptions] = useState<StaffOption[]>([]);
  const [selectedInstallerIds, setSelectedInstallerIds] = useState<number[]>([]);
  const [selectedWatcherIds, setSelectedWatcherIds] = useState<number[]>([]);

  const openAssignModal = async () => {
    setAssignModalOpen(true);
    setAssignLoading(true);
    try {
      const [assignable, detail] = await Promise.all([
        staffApiFetch<{ data: { installers: StaffOption[]; direksi: StaffOption[] } }>(
          `/api/staff/bookings/${bookingId}/assignable-staff`
        ),
        staffApiFetch<{ data: BookingDetail }>(`/api/staff/bookings/${bookingId}`),
      ]);
      setInstallerOptions(assignable.data.installers);
      setDireksiOptions(assignable.data.direksi);
      setSelectedInstallerIds(detail.data.installers.map((i) => i.id));
      setSelectedWatcherIds(detail.data.watchers.map((w) => w.id));
    } catch (err) {
      const message = err instanceof StaffApiError
        ? err.message
        : 'Tidak bisa memuat data assignment. Coba lagi.';
      Alert.alert('Gagal Memuat', message);
      setAssignModalOpen(false);
    } finally {
      setAssignLoading(false);
    }
  };

  const toggleInstaller = (userId: number) => {
    setSelectedInstallerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const toggleWatcher = (userId: number) => {
    setSelectedWatcherIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSaveAssignment = async () => {
    setAssignSaving(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/installers`, {
        method: 'PUT',
        body: JSON.stringify({ installer_user_ids: selectedInstallerIds }),
      });
      await staffApiFetch(`/api/staff/bookings/${bookingId}/watchers`, {
        method: 'PUT',
        body: JSON.stringify({ watcher_user_ids: selectedWatcherIds }),
      });
      setAssignModalOpen(false);
      Alert.alert('Berhasil', 'Assignment booking berhasil disimpan.');
    } catch (err) {
      const message = err instanceof StaffApiError ? err.message : 'Tidak bisa menyimpan assignment. Periksa koneksi internet Anda.';
      Alert.alert('Gagal', message);
    } finally {
      setAssignSaving(false);
    }
  };

  const hasLoadedRef = useRef(false);

  // Status booking dimuat terpisah dari fetchMessages() (endpoint
  // /messages tidak mengembalikan status) — cukup sekali saat layar
  // dibuka, bukan ikut di-poll setiap 5 detik seperti chat, supaya tidak
  // menambah beban request tiap poll padahal status jarang berubah saat
  // layar chat sedang dibuka.
  const fetchBookingStatus = useCallback(() => {
    return staffApiFetch<{ data: { status: typeof bookingStatus } }>(`/api/staff/bookings/${bookingId}`)
      .then((res) => setBookingStatus(res.data.status))
      .catch(() => {
        // Diam-diam gagal saja — tombol "Konfirmasi Booking" cuma tidak
        // muncul, chat tetap bisa dipakai seperti biasa (fetchMessages
        // yang menangani error load utama).
      });
  }, [bookingId]);

  const loadCapacityPreview = async (durationDays: number) => {
    setLoadingCapacity(true);
    try {
      const res = await staffApiFetch<{
        data: (
          | { date: string; closed: true }
          | { date: string; closed: false; used: number; default_capacity: number }
        )[];
      }>(`/api/staff/bookings/${bookingId}/capacity-preview?duration_days=${durationDays}`);
      setCapacityRows(res.data.map((row) => (
        row.closed
          ? { date: row.date, closed: true }
          : { date: row.date, closed: false, used: row.used, capacity: String(row.default_capacity) }
      )));
      setCapacityLoadedForDuration(durationDays);
    } catch (err) {
      const message = err instanceof StaffApiError ? err.message : 'Tidak bisa memuat data kapasitas.';
      Alert.alert('Gagal', message);
    } finally {
      setLoadingCapacity(false);
    }
  };

  // Durasi WAJIB diisi staff tiap kali approve. Default ditebak dari
  // produk booking-nya (PPF 3 hari, lainnya 1 hari) supaya staff biasanya
  // tinggal konfirmasi tanpa perlu ubah — daftar tanggal kerja & kapasitas
  // default per tanggal langsung dimuat dari backend begitu modal dibuka.
  const openConfirmModal = () => {
    const duration = productPpf ? 3 : 1;
    setConfirmDurationDays(String(duration));
    setConfirmModalOpen(true);
    loadCapacityPreview(duration);
  };

  // Staff ganti angka durasi di modal — reload OTOMATIS begitu field-nya
  // kehilangan fokus (bukan tombol manual terpisah, supaya perilakunya
  // sama dengan Filament yang auto-refresh) tanpa spam request tiap
  // ketikan digit.
  const onDurationBlur = () => {
    const durationDays = parseInt(confirmDurationDays, 10);
    if (!durationDays || durationDays < 1 || durationDays === capacityLoadedForDuration) {
      return;
    }
    loadCapacityPreview(durationDays);
  };

  const updateCapacityRow = (date: string, value: string) => {
    setCapacityRows((prev) => prev.map((row) => (row.date === date && !row.closed ? { ...row, capacity: value } : row)));
  };

  const submitConfirmBooking = async () => {
    const durationDays = parseInt(confirmDurationDays, 10);

    if (!durationDays || durationDays < 1) {
      Alert.alert('Data tidak valid', 'Lama pengerjaan minimal 1 hari.');
      return;
    }

    // Jaring pengaman — kalau durasi berubah tapi daftar tanggal belum
    // sempat dimuat ulang (mis. lupa geser fokus, atau koneksi lambat),
    // JANGAN kirim kapasitas yang belum pernah staff lihat untuk tanggal
    // yang berubah. Muat ulang dulu, minta staff cek lagi baru submit.
    if (durationDays !== capacityLoadedForDuration) {
      Alert.alert(
        'Tanggal belum diperbarui',
        'Lama pengerjaan berubah — memuat ulang daftar tanggal & kapasitas dulu. Silakan cek lagi lalu tekan Konfirmasi sekali lagi.'
      );
      loadCapacityPreview(durationDays);
      return;
    }

    const workingRows = capacityRows.filter((row): row is { date: string; closed: false; used: number; capacity: string } => !row.closed);
    if (workingRows.length === 0) {
      Alert.alert('Data tidak valid', 'Belum ada tanggal kerja termuat.');
      return;
    }

    const capacities = workingRows.map((row) => ({ date: row.date, capacity: parseInt(row.capacity, 10) }));
    if (capacities.some((c) => !c.capacity || c.capacity < 1)) {
      Alert.alert('Data tidak valid', 'Kapasitas tiap tanggal minimal 1.');
      return;
    }

    setConfirming(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ duration_days: durationDays, capacities }),
      });
      setBookingStatus('confirmed');
      setConfirmModalOpen(false);
      Alert.alert('Berhasil', 'Booking dikonfirmasi.');
    } catch (err) {
      // Pesan dari backend sudah spesifik (mis. tanggal mana yang penuh)
      // — ditampilkan apa adanya, bukan pesan generik.
      const message = err instanceof StaffApiError
        ? err.message
        : 'Tidak bisa mengkonfirmasi booking. Periksa koneksi internet Anda.';
      Alert.alert('Gagal', message);
    } finally {
      setConfirming(false);
    }
  };

  const fetchMessages = useCallback(() => {
    return staffApiFetch<{
      data: {
        current_stage: string | null;
        secondary_stage: string | null;
        product_kaca_film: boolean;
        product_ppf: boolean;
        messages: BookingMessage[];
      };
    }>(`/api/staff/bookings/${bookingId}/messages`)
      .then((res) => {
        setMessages(res.data.messages);
        setCurrentStage(res.data.current_stage);
        setSecondaryStage(res.data.secondary_stage);
        setProductKacaFilm(res.data.product_kaca_film);
        setProductPpf(res.data.product_ppf);
        setLoadError(null);
        hasLoadedRef.current = true;
      })
      .catch((err) => {
        // Poll berikutnya (5 detik lagi) akan coba lagi otomatis — tapi
        // kegagalan LOAD PERTAMA sengaja tidak lagi ditelan diam-diam:
        // sebelumnya layar chat cuma tampak kosong tanpa pesan apa pun,
        // staff tidak tahu itu gagal muat atau memang belum ada chat sama
        // sekali. Kegagalan poll berikutnya (saat messages sudah pernah
        // termuat) tetap tidak perlu mengganggu chat yang sedang dibaca.
        if (!hasLoadedRef.current) {
          setLoadError(
            err instanceof StaffApiError ? err.message : 'Gagal memuat chat booking.'
          );
        }
      });
  }, [bookingId]);

  useEffect(() => {
    fetchBookingStatus();
    fetchMessages().finally(() => setLoading(false));
    const interval = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMessages, fetchBookingStatus]);

  const sendMessage = async (payload: FormData): Promise<boolean> => {
    setSending(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/messages`, {
        method: 'POST',
        body: payload,
      });
      await fetchMessages();
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
      return true;
    } catch (err) {
      // Tampilkan pesan asli dari backend (validasi/otorisasi) kalau ada —
      // sebelumnya semua error (termasuk 403/422) ditutupi pesan generik
      // "periksa koneksi internet", jadi staff tidak pernah tahu penyebab
      // aslinya kalau memang bukan soal jaringan.
      const message = err instanceof StaffApiError
        ? err.message
        : 'Periksa koneksi internet Anda dan coba lagi.';
      Alert.alert('Gagal Mengirim', message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleSendText = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const form = new FormData();
    form.append('type', 'text');
    form.append('body', trimmed);
    setInput('');
    // Kalau gagal kirim, kembalikan teks yang sudah diketik ke input —
    // sebelumnya teks hilang begitu saja setelah alert error, staff harus
    // mengetik ulang seluruh pesan.
    const ok = await sendMessage(form);
    if (!ok) setInput(trimmed);
  };

  const handlePickPhoto = async (stageForPhoto?: string) => {
    // Minta izin galeri secara eksplisit HANYA di iOS. Di Android,
    // launchImageLibraryAsync() di bawah otomatis pakai Photo Picker
    // bawaan sistem (Android 13+) yang TIDAK butuh izin apa pun —
    // memanggil requestMediaLibraryPermissionsAsync() di Android malah
    // memaksa app minta izin lawas READ_MEDIA_IMAGES/READ_MEDIA_VIDEO
    // yang justru dilarang kebijakan Google Play kalau Photo Picker
    // sudah cukup untuk fungsi ini (lihat catatan Play Console).
    if (Platform.OS === 'ios') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          Alert.alert(
            'Izin Ditolak Permanen',
            'Aktifkan izin akses galeri lewat Pengaturan untuk mengirim foto.',
            [
              { text: 'Batal', style: 'cancel' },
              { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() },
            ]
          );
        } else {
          Alert.alert('Izin Diperlukan', 'Aktifkan izin akses galeri untuk mengirim foto.');
        }
        return;
      }
    }

    // allowsMultipleSelection — 1 tahap boleh disertai beberapa foto
    // sekaligus (mis. beberapa sudut mobil), tidak perlu kirim satu-satu.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets?.length) return;

    const form = new FormData();
    form.append('type', 'photo');
    if (stageForPhoto) form.append('stage', stageForPhoto);
    result.assets.forEach((asset, i) => {
      form.append('photos[]', {
        uri: asset.uri,
        name: asset.fileName || `photo-${i}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      } as any);
    });

    if (!stageForPhoto) {
      setStagePickerOpen(false);
    }
    // Picker sengaja TIDAK ditutup untuk foto susulan tahap, biar staff
    // langsung lihat ikon kameranya terkunci lalu lanjut ke tahap berikutnya.
    sendMessage(form);
  };

  const handlePickStage = (stage: string, withPhoto: boolean) => {
    // Tahap "Selesai" = booking benar-benar selesai & customer sudah bayar
    // di toko — SELALU lewat modal (baik tombol teks maupun kamera),
    // BUKAN langsung kirim pesan tahap seperti biasa. Kalau tombol kamera
    // yang dipisah dibiarkan lolos ke handlePickPhoto(), endpoint
    // /complete tidak pernah kepanggil — kode referral/voucher tidak
    // pernah diproses sama sekali (poin tidak keluar tanpa error apapun).
    if (stage === 'completed') {
      if (currentStage === 'completed') return; // sudah selesai, tidak bisa diulang
      setStagePickerOpen(false);
      setCompleteModalOpen(true);
      return;
    }

    if (withPhoto) {
      // Susulan foto SETELAH tahap ditandai — kirim sebagai foto biasa
      // (tanpa pill "Tahap: X" dobel di chat). Boleh berkali-kali selama
      // masih di tahap yang sama (tandai belum pindah ke tahap berikutnya).
      handlePickPhoto(stage);
      return;
    }

    const form = new FormData();
    form.append('type', 'stage');
    form.append('stage', stage);
    setMarkedStage(stage);
    sendMessage(form);
  };

  // Booking dengan KEDUA produk → Kaca Film & PPF jalan paralel (Kaca Film
  // di currentStage, PPF di secondaryStage). Cuma 1 produk → track itu
  // tetap pakai currentStage persis seperti sebelumnya (tidak ada
  // perubahan perilaku untuk booking 1 produk).
  const bothProducts = productKacaFilm && productPpf;
  const kacaFilmColumnValue = currentStage;
  const ppfColumnValue = bothProducts ? secondaryStage : currentStage;

  const stageLabelOf = (trackStages: StageItem[], columnValue: string | null) =>
    trackStages.find((s) => s.key === columnValue)?.label ?? null;

  // Ringkasan 1 baris untuk header strip yang tertutup — kalau kedua
  // produk ada, gabungkan label tahap Kaca Film & PPF; kalau cuma 1
  // produk (atau sudah masuk tahap akhir bersama), tampilkan satu label.
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

  const renderStageDots = (trackStages: StageItem[], columnValue: string | null) => {
    const idx = trackStages.findIndex((s) => s.key === columnValue);
    return trackStages.map((s, i) => {
      const isDone = i <= idx;
      return (
        <React.Fragment key={s.key}>
          <View style={[styles.stageDot, isDone && styles.stageDotActive]}>
            <Ionicons name={s.icon} size={12} color={isDone ? '#ffffff' : colors.textMuted} />
          </View>
          {i < trackStages.length - 1 && (
            <View style={[styles.stageLine, isDone && i < idx && styles.stageLineActive]} />
          )}
        </React.Fragment>
      );
    });
  };

  const renderStagePickerRows = (trackStages: StageItem[], columnValue: string | null) => {
    const isMarkedInTrack = markedStage !== null && trackStages.some((s) => s.key === markedStage);
    const effectiveStage = isMarkedInTrack ? markedStage : columnValue;
    const effectiveIdx = trackStages.findIndex((s) => s.key === effectiveStage);

    return trackStages.map((s, idx) => {
      const isCompletedRow = s.key === 'completed';
      // "Selesai" HARUS lewat QC dulu — booking ini punya konsekuensi nyata
      // begitu ditandai (memicu poin referral/voucher/notifikasi "selesai"
      // ke customer lewat /complete), jadi tidak boleh sama permisifnya
      // dengan tahap internal lain yang memang boleh ditandai maju bebas.
      const tandaiDisabled = isCompletedRow
        ? currentStage !== 'qc'
        : idx <= effectiveIdx;
      const cameraDisabled = isCompletedRow
        ? currentStage !== 'qc'
        : idx !== effectiveIdx;
      return (
        <View key={s.key} style={styles.stagePickerRow}>
          <Ionicons name={s.icon} size={16} color={colors.textPrimary} />
          <Text style={styles.stagePickerLabel}>{s.label}</Text>
          <Pressable
            style={[styles.stagePickerBtn, tandaiDisabled && styles.stagePickerBtnDisabled]}
            onPress={() => handlePickStage(s.key, false)}
            disabled={tandaiDisabled}
          >
            <Text style={styles.stagePickerBtnText}>Tandai</Text>
          </Pressable>
          <Pressable
            style={[
              styles.stagePickerBtn,
              styles.stagePickerBtnPhoto,
              cameraDisabled && styles.stagePickerBtnDisabled,
            ]}
            onPress={() => handlePickStage(s.key, true)}
            disabled={cameraDisabled}
          >
            <Ionicons name="camera-outline" size={14} color={cameraDisabled ? colors.textMuted : colors.accent} />
          </Pressable>
        </View>
      );
    });
  };

  const handleCompleteBooking = async () => {
    setCompleting(true);
    try {
      const res = await staffApiFetch<{ message: string }>(`/api/staff/bookings/${bookingId}/complete`, {
        method: 'POST',
      });

      // Tetap kirim pesan tahap "Selesai" seperti biasa supaya muncul di
      // chat/timeline booking untuk customer.
      const form = new FormData();
      form.append('type', 'stage');
      form.append('stage', 'completed');
      await sendMessage(form);

      setCompleteModalOpen(false);
      if (res.message) Alert.alert('Berhasil', res.message);
    } catch (err) {
      const message = err instanceof StaffApiError ? err.message : 'Tidak bisa menyelesaikan booking. Periksa koneksi internet Anda.';
      Alert.alert('Gagal', message);
    } finally {
      setCompleting(false);
    }
  };

  const openCancelModal = () => {
    setCancelReason('');
    setCancelModalOpen(true);
  };

  const submitCancelBooking = async () => {
    setCancelling(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      setBookingStatus('cancelled');
      setCancelModalOpen(false);
      Alert.alert('Berhasil', 'Booking dibatalkan.');
    } catch (err) {
      const message = err instanceof StaffApiError
        ? err.message
        : 'Tidak bisa membatalkan booking. Periksa koneksi internet Anda.';
      Alert.alert('Gagal', message);
    } finally {
      setCancelling(false);
    }
  };

  const handleSendMaintenanceReminder = () => {
    Alert.alert(
      'Kirim Pengingat Maintenance',
      'Kirim pengingat servis berkala ke customer lewat WhatsApp/Push/Email?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Kirim',
          onPress: async () => {
            setSendingReminder(true);
            try {
              const res = await staffApiFetch<{ message: string }>(
                `/api/staff/bookings/${bookingId}/maintenance-reminder`,
                { method: 'POST' }
              );
              Alert.alert('Berhasil', res.message);
            } catch (err) {
              const message = err instanceof StaffApiError
                ? err.message
                : 'Tidak bisa mengirim pengingat. Periksa koneksi internet Anda.';
              Alert.alert('Gagal', message);
            } finally {
              setSendingReminder(false);
            }
          },
        },
      ]
    );
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
      <Text style={styles.headerTitle} numberOfLines={1}>Chat & Progress</Text>
      {canManageProgress ? (
        <View style={{ flexDirection: 'row' }}>
          {currentStage === 'completed' && (
            <Pressable
              onPress={handleSendMaintenanceReminder}
              style={styles.sideButton}
              disabled={sendingReminder}
            >
              {sendingReminder ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.accent} />
              )}
            </Pressable>
          )}
          {(bookingStatus === 'pending' || bookingStatus === 'confirmed') && (
            <Pressable onPress={openCancelModal} style={styles.sideButton}>
              <Ionicons name="close-circle-outline" size={22} color={colors.danger} />
            </Pressable>
          )}
          <Pressable onPress={openAssignModal} style={styles.sideButton}>
            <Ionicons name="people-outline" size={22} color={colors.accent} />
          </Pressable>
          <Pressable
            onPress={() => {
              setStagePickerOpen((v) => !v);
              setMarkedStage(null);
            }}
            style={styles.sideButton}
          >
            <Ionicons name="flag-outline" size={22} color={colors.accent} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.sideButton} />
      )}
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

  if (loadError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <HeaderBar />
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.loadErrorText}>{loadError}</Text>
          <Pressable style={styles.retryBtn} onPress={fetchMessages}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar />

      {canManageProgress && bookingStatus === 'pending' && (
        <View style={styles.pendingBanner}>
          <View style={styles.pendingBannerText}>
            <Ionicons name="time-outline" size={16} color={colors.warning} />
            <Text style={styles.pendingBannerLabel}>Booking ini masih menunggu konfirmasi</Text>
          </View>
          <Pressable
            style={styles.pendingBannerBtn}
            onPress={openConfirmModal}
          >
            <Text style={styles.pendingBannerBtnText}>Konfirmasi Booking</Text>
          </Pressable>
        </View>
      )}

      {currentStage && (
        <View style={styles.stageStripWrap}>
          <Pressable
            style={styles.stageSummaryRow}
            onPress={() => setStageStripExpanded((v) => !v)}
          >
            <Ionicons name="flag-outline" size={14} color={colors.accent} />
            <Text style={styles.stageSummaryText} numberOfLines={1}>{stageSummaryLabel}</Text>
            <Ionicons
              name={stageStripExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>
          {stageStripExpanded && (
            <>
              {productKacaFilm && (
                <View style={styles.stageStripRow}>
                  {bothProducts && <Text style={styles.stageStripLabel}>Kaca Film</Text>}
                  <View style={styles.stageStrip}>{renderStageDots(KACA_FILM_STAGES, kacaFilmColumnValue)}</View>
                </View>
              )}
              {productPpf && (
                <View style={styles.stageStripRow}>
                  {bothProducts && <Text style={styles.stageStripLabel}>PPF</Text>}
                  <View style={styles.stageStrip}>{renderStageDots(PPF_STAGES, ppfColumnValue)}</View>
                </View>
              )}
              <View style={styles.stageStripRow}>
                {(productKacaFilm || productPpf) && <Text style={styles.stageStripLabel}>Tahap Akhir</Text>}
                <View style={styles.stageStrip}>{renderStageDots(SHARED_STAGES, currentStage)}</View>
              </View>
            </>
          )}
        </View>
      )}

      {canManageProgress && stagePickerOpen && (
        <View style={styles.stagePicker}>
          <Text style={styles.stagePickerTitle}>Update Tahap</Text>
          {markedStage && (
            <Text style={styles.stagePickerHint}>
              Tahap ditandai. Lampirkan foto (opsional, bisa berkali-kali) lewat ikon kamera di bawah.
            </Text>
          )}

          {productKacaFilm && (
            <>
              {bothProducts && <Text style={styles.stagePickerGroupLabel}>Kaca Film</Text>}
              {renderStagePickerRows(KACA_FILM_STAGES, kacaFilmColumnValue)}
            </>
          )}

          {productPpf && (
            <>
              {bothProducts && <Text style={styles.stagePickerGroupLabel}>PPF</Text>}
              {renderStagePickerRows(PPF_STAGES, ppfColumnValue)}
            </>
          )}

          {(productKacaFilm || productPpf) && (
            <Text style={styles.stagePickerGroupLabel}>Tahap Akhir</Text>
          )}
          {renderStagePickerRows(SHARED_STAGES, currentStage)}
        </View>
      )}

      <View style={[styles.flex, { marginBottom: keyboardHeight }]}>
        <FlatList
          ref={listRef}
          // SEBELUMNYA tidak ada style={flex:1} di sini — list menyusut
          // mengikuti tinggi kontennya sendiri (kayak ScrollView tanpa
          // flex), bukan mengisi sisa ruang di KeyboardAvoidingView.
          // Akibatnya kolom input "naik" nempel tepat di bawah pesan
          // terakhir, bukan di bawah layar, begitu pesannya sedikit.
          // Ditemukan & diperbaiki 2026-08-28.
          style={styles.flex}
          data={[...messages].reverse()}
          keyExtractor={(item) => String(item.id)}
          inverted
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => <MessageBubble message={item} onPhotoPress={setViewerImage} styles={styles} />}
        />

        {/* +spacing.sm ekstra di kedua kondisi — SEBELUMNYA di HP dengan
            navigasi 3-tombol (insets.bottom = 0), kolom input cuma
            dikasih jarak spacing.sm dari tepi layar, jadi kelihatan
            terlalu mepet ke navigation bar Android. Ditemukan &
            diperbaiki 2026-08-28. */}
        <View style={[styles.inputBar, { paddingBottom: (insets.bottom > 0 ? insets.bottom : spacing.sm) + spacing.sm }]}>
          {canManageProgress && (
            <Pressable style={styles.attachBtn} onPress={() => handlePickPhoto()} disabled={sending}>
              <Ionicons name="camera-outline" size={22} color={colors.accent} />
            </Pressable>
          )}
          <TextInput
            style={styles.input}
            placeholder="Ketik pesan..."
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
          />
          <Pressable style={styles.sendBtn} onPress={handleSendText} disabled={sending || !input.trim()}>
            {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="send" size={18} color="#ffffff" />}
          </Pressable>
        </View>
      </View>

      {/* Lightbox — tap foto untuk lihat ukuran penuh */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerImage(null)}>
          {viewerImage && <Image source={{ uri: viewerImage }} style={styles.viewerImage} resizeMode="contain" />}
          <Pressable style={styles.viewerCloseBtn} onPress={() => setViewerImage(null)}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Selesaikan booking — murni konfirmasi, tidak ada input apa pun.
          Nominal transaksi, kode referral partner, & voucher SUDAH TIDAK
          diinput di sini lagi — semua diproses staff terpisah lewat
          Filament (aksi "Proses Referral" di BookingResource untuk
          nominal+referral, VoucherResource untuk assign kode voucher
          fisik), tidak lagi berhubungan dengan penyelesaian booking di
          mobile app. */}
      <Modal visible={completeModalOpen} transparent animationType="fade" onRequestClose={() => setCompleteModalOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Selesaikan Booking</Text>
            <Text style={styles.completeSubtitle}>
              Tandai booking ini sebagai selesai? Poin referral partner & voucher diproses terpisah lewat Filament.
            </Text>

            <View style={styles.completeActions}>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnCancel]}
                onPress={() => setCompleteModalOpen(false)}
                disabled={completing}
              >
                <Text style={styles.completeBtnCancelText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnConfirm]}
                onPress={handleCompleteBooking}
                disabled={completing}
              >
                {completing ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.completeBtnConfirmText}>Selesaikan</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Konfirmasi/approve booking — staff WAJIB isi lama pengerjaan &
          kapasitas instalasi hari itu tiap kali approve (bukan setting
          tetap toko), dicek ke backend lewat POST .../confirm. */}
      <Modal visible={confirmModalOpen} transparent animationType="fade" onRequestClose={() => setConfirmModalOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Konfirmasi Booking</Text>
            <Text style={styles.completeSubtitle}>
              Kapasitas tim bisa beda tiap tanggal (mis. 1 tim masih ngerjain mobil dari hari sebelumnya) — sesuaikan per baris kalau perlu. Sistem cek slot sebelum booking dikonfirmasi.
            </Text>

            <View style={styles.confirmFieldRow}>
              <Text style={styles.confirmFieldLabel}>Lama Pengerjaan (hari)</Text>
              <TextInput
                style={styles.confirmFieldInput}
                keyboardType="number-pad"
                value={confirmDurationDays}
                onChangeText={setConfirmDurationDays}
                onEndEditing={onDurationBlur}
                placeholder="1"
                placeholderTextColor={colors.textMuted}
              />
              {parseInt(confirmDurationDays, 10) !== capacityLoadedForDuration && !loadingCapacity && (
                <Text style={styles.capacityStaleHint}>Daftar tanggal di bawah belum sesuai durasi ini — akan dimuat ulang otomatis.</Text>
              )}
            </View>

            <View style={styles.confirmFieldRow}>
              <Text style={styles.confirmFieldLabel}>Kapasitas Instalasi per Tanggal</Text>

              {loadingCapacity ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: spacing.sm }} />
              ) : capacityRows.length === 0 ? (
                <Text style={styles.capacityEmptyText}>Belum ada tanggal termuat.</Text>
              ) : (
                <ScrollView style={styles.capacityScroll} nestedScrollEnabled>
                  {capacityRows.map((row) => (
                    row.closed ? (
                      <View key={row.date} style={styles.capacityRowClosed}>
                        <Text style={styles.capacityRowClosedText}>{formatDate(row.date)} — Toko libur</Text>
                      </View>
                    ) : (
                      <View key={row.date} style={styles.capacityRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.capacityRowDate}>{formatDate(row.date)}</Text>
                          <Text style={styles.capacityRowUsed}>{row.used} booking confirmed</Text>
                        </View>
                        <TextInput
                          style={styles.capacityRowInput}
                          keyboardType="number-pad"
                          value={row.capacity}
                          onChangeText={(v) => updateCapacityRow(row.date, v)}
                        />
                      </View>
                    )
                  ))}
                </ScrollView>
              )}
            </View>

            <View style={styles.completeActions}>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnCancel]}
                onPress={() => setConfirmModalOpen(false)}
                disabled={confirming}
              >
                <Text style={styles.completeBtnCancelText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnConfirm]}
                onPress={submitConfirmBooking}
                disabled={confirming}
              >
                {confirming ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.completeBtnConfirmText}>Konfirmasi</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Batalkan booking (pending/confirmed) — alasan opsional, dikirim
          ke customer via push notification (BookingObserver::updated()). */}
      <Modal visible={cancelModalOpen} transparent animationType="fade" onRequestClose={() => setCancelModalOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Batalkan Booking</Text>
            <Text style={styles.completeSubtitle}>
              Customer akan mendapat notifikasi bahwa booking-nya dibatalkan. Tindakan ini tidak bisa dibatalkan balik dari sini.
            </Text>

            <View style={styles.confirmFieldRow}>
              <Text style={styles.confirmFieldLabel}>Alasan (opsional)</Text>
              <TextInput
                style={[styles.confirmFieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
                multiline
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Mis. customer minta reschedule, salah input, dll."
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.completeActions}>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnCancel]}
                onPress={() => setCancelModalOpen(false)}
                disabled={cancelling}
              >
                <Text style={styles.completeBtnCancelText}>Tutup</Text>
              </Pressable>
              <Pressable
                style={[styles.completeBtn, { backgroundColor: colors.danger }]}
                onPress={submitCancelBooking}
                disabled={cancelling}
              >
                {cancelling ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.completeBtnConfirmText}>Batalkan Booking</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Assign installer & direksi pemantau chat booking ini. */}
      <Modal visible={assignModalOpen} transparent animationType="fade" onRequestClose={() => setAssignModalOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Assignment Booking</Text>
            <Text style={styles.completeSubtitle}>
              Tunjuk installer (bisa lebih dari satu) yang mengerjakan instalasi ini, dan direksi yang perlu memantau chat & progress-nya.
            </Text>

            {assignLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
            ) : (
              <>
                <Text style={styles.completeLabel}>Installer (bisa lebih dari satu)</Text>
                <View style={styles.assignOptionList}>
                  {installerOptions.map((opt) => {
                    const checked = selectedInstallerIds.includes(opt.id);
                    return (
                      <Pressable
                        key={opt.id}
                        style={[styles.assignOptionRow, checked && styles.assignOptionRowActive]}
                        onPress={() => toggleInstaller(opt.id)}
                      >
                        <Ionicons
                          name={checked ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={checked ? colors.accent : colors.textMuted}
                        />
                        <Text style={styles.assignOptionText}>
                          {opt.name}
                          {opt.level ? ` (${TECHNICIAN_LEVEL_LABEL[opt.level] ?? opt.level})` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {installerOptions.length === 0 && (
                    <Text style={styles.assignEmptyText}>Belum ada akun installer di toko ini.</Text>
                  )}
                </View>

                <Text style={styles.completeLabel}>Direksi Pemantau (bisa lebih dari satu)</Text>
                <View style={styles.assignOptionList}>
                  {direksiOptions.map((opt) => {
                    const checked = selectedWatcherIds.includes(opt.id);
                    return (
                      <Pressable
                        key={opt.id}
                        style={[styles.assignOptionRow, checked && styles.assignOptionRowActive]}
                        onPress={() => toggleWatcher(opt.id)}
                      >
                        <Ionicons
                          name={checked ? 'checkbox' : 'square-outline'}
                          size={18}
                          color={checked ? colors.accent : colors.textMuted}
                        />
                        <Text style={styles.assignOptionText}>{opt.name}</Text>
                      </Pressable>
                    );
                  })}
                  {direksiOptions.length === 0 && (
                    <Text style={styles.assignEmptyText}>Belum ada akun direksi terdaftar.</Text>
                  )}
                </View>
                <Text style={styles.completeHint}>
                  Direksi yang dicentang akan dapat notifikasi push & email khusus untuk booking ini setiap ada pesan baru.
                </Text>
              </>
            )}

            <View style={styles.completeActions}>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnCancel]}
                onPress={() => setAssignModalOpen(false)}
                disabled={assignSaving}
              >
                <Text style={styles.completeBtnCancelText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnConfirm]}
                onPress={handleSaveAssignment}
                disabled={assignSaving || assignLoading}
              >
                {assignSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.completeBtnConfirmText}>Simpan</Text>
                )}
              </Pressable>
            </View>
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
}: {
  message: BookingMessage;
  onPhotoPress: (url: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const isAdmin = message.sender_type === 'admin';

  if (message.type === 'stage') {
    return (
      <View style={styles.stageMessageWrap}>
        <View style={styles.stageMessage}>
          <Ionicons name="flag" size={14} color={styles.stageMessageText.color as string} style={styles.stageMessageIcon} />
          <Text style={styles.stageMessageText}>Tahap: {message.stage_label}</Text>
        </View>
        {message.photo_urls.length > 0 && (
          <PhotoGrid photoUrls={message.photo_urls} onPhotoPress={onPhotoPress} styles={styles} />
        )}
        <Text style={styles.stageMessageTime}>{formatTime(message.created_at)}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleWrap, isAdmin ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
      {/* SEBELUMNYA sender_name sudah dikirim backend tapi tidak pernah
          ditampilkan di sini — semua pesan staff (installer, store
          manager, siapa pun) tampil identik, staff lain yang buka
          booking yang sama tidak tahu siapa sebenarnya yang menulis
          pesan itu. Cuma untuk pesan admin — pesan customer selalu dari
          1 orang yang sama (pemilik booking), tidak perlu label.
          Ditemukan & diperbaiki 2026-08-28. */}
      {isAdmin && message.sender_name && (
        <Text style={styles.senderNameLabel}>{message.sender_name}</Text>
      )}
      <View style={[styles.bubble, isAdmin ? styles.bubbleAdmin : styles.bubbleCustomer]}>
        {message.photo_urls.length > 0 && (
          <PhotoGrid photoUrls={message.photo_urls} onPhotoPress={onPhotoPress} styles={styles} />
        )}
        {message.body && (
          <Text style={[styles.bubbleText, isAdmin && styles.bubbleTextAdmin]}>{message.body}</Text>
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
}: {
  photoUrls: string[];
  onPhotoPress: (url: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  if (photoUrls.length === 1) {
    return (
      <Pressable onPress={() => onPhotoPress(photoUrls[0])}>
        <Image source={{ uri: photoUrls[0] }} style={styles.bubblePhoto} />
      </Pressable>
    );
  }

  return (
    <View style={styles.photoGrid}>
      {photoUrls.map((url) => (
        <Pressable key={url} onPress={() => onPhotoPress(url)}>
          <Image source={{ uri: url }} style={styles.photoGridItem} />
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
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  loadErrorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },

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

  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pendingBannerText: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  pendingBannerLabel: { fontSize: fontSize.xs, fontWeight: '600', color: colors.warning, flexShrink: 1 },
  pendingBannerBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  pendingBannerBtnDisabled: { opacity: 0.6 },
  pendingBannerBtnText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.xs },

  stageStripWrap: { backgroundColor: colors.surface, paddingVertical: spacing.xs },
  stageSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 4,
  },
  stageSummaryText: { flex: 1, fontSize: fontSize.xs, fontWeight: '700', color: colors.textPrimary },
  stageStripRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 2,
  },
  stageStripLabel: {
    width: 60, fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
  },
  stageStrip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs,
  },
  stageDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stageDotActive: { backgroundColor: colors.accent },
  stageLine: { flex: 1, height: 2, backgroundColor: colors.border },
  stageLineActive: { backgroundColor: colors.accent },

  stagePicker: { backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  stagePickerTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  stagePickerGroupLabel: {
    fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: spacing.xs,
  },
  stagePickerHint: { fontSize: fontSize.xs, color: colors.accent, marginBottom: 4 },
  stagePickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stagePickerLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
  stagePickerBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  stagePickerBtnText: { fontSize: fontSize.xs, fontWeight: '700', color: '#ffffff' },
  stagePickerBtnPhoto: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 8 },
  stagePickerBtnDisabled: { backgroundColor: colors.border, borderColor: colors.border, opacity: 0.5 },

  messageList: { padding: spacing.md, gap: spacing.sm },

  // alignItems per sisi WAJIB diisi eksplisit — default React Native
  // 'stretch' bikin semua child (bubble, label nama, jam) menyesuaikan
  // lebar sibling TERLEBAR (label nama pengirim, mis. "Admin Toko Test
  // Toko"), jadi bubble teks pendek (mis. "Test") ikut melebar kosong.
  // Ditemukan & diperbaiki 2026-08-28.
  bubbleWrap: { maxWidth: '78%', gap: 2 },
  bubbleWrapLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubbleWrapRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: radius.lg, padding: spacing.sm, overflow: 'hidden' },
  bubbleAdmin: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleCustomer: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20 },
  bubbleTextAdmin: { color: '#ffffff' },
  bubblePhoto: { width: 200, height: 150, borderRadius: radius.sm, marginBottom: 6 },
  photoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4,
    width: 200, marginBottom: 6,
  },
  photoGridItem: { width: 98, height: 98, borderRadius: radius.sm },
  messageTime: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end' },
  senderNameLabel: { fontSize: 10, fontWeight: '700', color: colors.textMuted, alignSelf: 'flex-end', marginBottom: 2, marginRight: 2 },
  stageMessageTime: { fontSize: 10, color: colors.textMuted, alignSelf: 'center' },

  stageMessageWrap: { alignSelf: 'center', alignItems: 'center', gap: 4, marginVertical: spacing.xs },
  stageMessage: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
  },
  stageMessageIcon: { marginTop: 1 },
  stageMessageText: {
    fontSize: fontSize.xs, fontWeight: '700', color: colors.accent,
    lineHeight: fontSize.xs + 2, includeFontPadding: false,
  },
  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '80%' },
  viewerCloseBtn: {
    position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
  },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, minHeight: 40, maxHeight: 100, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 8,
    fontSize: fontSize.sm, color: colors.textPrimary,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  completeBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  completeSheet: {
    width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs,
  },
  completeTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  completeSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.sm },
  completeLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  completeHint: { fontSize: 11, color: colors.accent, marginTop: 4, lineHeight: 15 },
  completeInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: fontSize.sm, color: colors.textPrimary,
  },
  confirmFieldRow: { marginTop: spacing.sm },
  confirmFieldLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: 4 },
  confirmFieldInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: fontSize.sm, color: colors.textPrimary,
  },
  capacityStaleHint: { fontSize: 11, color: colors.warning, marginTop: 6 },
  capacityEmptyText: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  capacityScroll: { maxHeight: 220, marginTop: spacing.xs },
  capacityRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  capacityRowDate: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  capacityRowUsed: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  capacityRowInput: {
    width: 56, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: 8, textAlign: 'center', fontSize: fontSize.sm, color: colors.textPrimary,
  },
  capacityRowClosed: {
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  capacityRowClosedText: { fontSize: fontSize.xs, color: colors.textMuted, fontStyle: 'italic' },
  completeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  completeBtn: {
    flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
  },
  completeBtnCancel: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  completeBtnCancelText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  completeBtnConfirm: { backgroundColor: colors.accent },
  completeBtnConfirmText: { fontSize: fontSize.sm, fontWeight: '700', color: '#ffffff' },

  assignOptionList: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden',
  },
  assignOptionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  assignOptionRowActive: { backgroundColor: colors.bg },
  assignOptionText: { fontSize: fontSize.sm, color: colors.textPrimary, flex: 1 },
  assignEmptyText: {
    fontSize: fontSize.xs, color: colors.textMuted, padding: spacing.md, textAlign: 'center',
  },
  });
}
