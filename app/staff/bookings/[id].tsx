import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseDate, toLocalDateString } from '@/lib/dates';
import {
  View, FlatList, TextInput, Pressable, StyleSheet, ScrollView,
  Platform, Image, ActivityIndicator, Alert, Modal, Linking, Switch, Keyboard, AppState, useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { AppText as Text } from '@/components/ui/AppText';
import { staffApiFetch, ApiError as StaffApiError } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';
import { shrinkForUpload, shrinkAllForUpload } from '@/lib/image-compress';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';
import { AutoGrowTextInput } from '@/components/ui/AutoGrowTextInput';
// SDK 54 memindahkan API lama expo-file-system ke submodul /legacy (downloadAsync, cacheDirectory), sama seperti layar galeri pelanggan.
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import DateGrid from '@/components/ui/DateGrid';
import QualityCheckModal from '@/components/QualityCheckModal';
import HandoverModal from '@/components/HandoverModal';
import WhatsAppTemplatesModal, { WhatsAppBookingInfo } from '@/components/WhatsAppTemplatesModal';
import IntakePhotosModal from '@/components/IntakePhotosModal';

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
  installers: (StaffOption & { can_chat?: boolean })[];
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

// Pemisah hari di chat: "Hari ini", "Kemarin", atau tanggal lengkap.
function chatDayKey(dateString: string): string {
  const d = new Date(dateString);

  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function chatDayLabel(dateString: string): string {
  const d = new Date(dateString);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);

  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';

  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDate(dateString: string): string {
  return parseDate(dateString).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

// Area pemasangan PPF: Eksterior dan Interior boleh dipilih bersamaan. Yang belum menentukan dianggap Eksterior (sama dengan server).
function ppfAreaLabel(ppf?: boolean | null, exterior?: boolean | null, interior?: boolean | null): string | null {
  if (!ppf) return null;
  if (exterior && interior) return 'Eksterior & Interior';
  if (interior) return 'Interior';
  return 'Eksterior';
}

// Lama pengerjaan bawaan PPF: Eksterior 3 hari, Interior 1 hari, keduanya dijumlahkan; staf tetap bisa mengubahnya saat konfirmasi.
function ppfDefaultDays(exterior?: boolean | null, interior?: boolean | null): number {
  return (exterior || !interior ? 3 : 0) + (interior ? 1 : 0);
}

function withPpfArea(service: string | null | undefined, ppf?: boolean | null, exterior?: boolean | null, interior?: boolean | null): string | null {
  const area = ppfAreaLabel(ppf, exterior, interior);
  return area ? `${service ?? 'PPF'} · PPF ${area}` : (service ?? null);
}

// Data booking yang dibutuhkan installer untuk mengerjakan (tanpa chat & tanpa kontak customer).
interface InstallerBookingInfo {
  product_ppf?: boolean;
  ppf_exterior?: boolean;
  ppf_interior?: boolean;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  service_type: string | null;
  preferred_date: string | null;
  preferred_time?: string | null;
  duration_days: number | null;
  vehicle_size?: string | null;
  vehicle_plate?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_variant?: string | null;
  vehicle_color?: string | null;
  notes: string | null;
  customer?: { name: string | null } | null;
  store?: { name: string } | null;
  installers?: { id: number; name: string; can_chat?: boolean }[];
  spk: { id: number } | null;
  current_stage?: string | null;
  secondary_stage?: string | null;
  // Produk yang dipasang (SKU utama dan produk tambahan per bagian kendaraan); API installer hanya mengirim nama dan SKU.
  film_product?: { sku: string | null; name: string | null } | null;
  film_products?: { position: string | null; film_product: { sku: string | null; name: string | null } | null }[];
}

const INSTALLER_STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Konfirmasi',
  confirmed: 'Dikonfirmasi',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};

const DETAIL_STATUS: Record<'pending' | 'confirmed' | 'completed' | 'cancelled', { label: string; color: keyof typeof darkColors; bg: keyof typeof darkColors }> = {
  pending: { label: 'Menunggu', color: 'warning', bg: 'warningBg' },
  confirmed: { label: 'Dikonfirmasi', color: 'success', bg: 'successBg' },
  completed: { label: 'Selesai', color: 'textMuted', bg: 'surface' },
  cancelled: { label: 'Dibatalkan', color: 'danger', bg: 'dangerBg' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function StaffBookingChatScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const bookingId = Number(id);
  const { staff } = useStaffAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors, theme === 'dark'), [colors, theme]);
  // Installer tidak ikut chat booking (2026-10-10): yang berbicara dengan customer adalah leader installer, store
  // manager, dan direksi. Installer tetap tercatat sebagai pengerja dan melihat tugasnya (server menolak chat 403).
  const isInstaller = staff?.role === 'installer';
  // SPK baru hanya boleh dibuat leader installer dan atasannya (sesi lama tanpa flag: tebak dari nama role).
  const canCreateSpk = staff?.can_create_spk
    ?? ['super_admin', 'direksi', 'store_manager', 'installer_leader', 'installer'].includes(staff?.role ?? '');
  const canManageProgress = !isInstaller;
  // Keputusan pengajuan pembatalan: Store Manager/akses penuh saja (server
  // menolak 403 selain itu). Sesi lama tanpa flag: tebak dari nama role.
  const canDecideCancellation = staff?.can_decide_booking_requests
    ?? ['store_manager', 'super_admin', 'direksi'].includes(staff?.role ?? '');

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
  const [actionsOpen, setActionsOpen] = useState(false);
  // Layar dibagi dua tab (Ringkasan dan Chat): ringkasan, tindakan, dan progres tidak lagi bertumpuk di atas chat sehingga memakan
  // layar. Buka langsung ke chat lewat ?tab=chat (mis. dari notifikasi pesan).
  const [activeTab, setActiveTab] = useState<'ringkasan' | 'chat'>(tab === 'chat' ? 'chat' : 'ringkasan');
  const [summary, setSummary] = useState<{
    bookingNumber: string | null;
    service: string | null;
    time: string | null;
    durationDays: number | null;
    ppfDays?: number | null;
    customerName: string | null;
    customerPhone: string | null;
    storeName: string | null;
  } | null>(null);
  // Tahap yang baru saja "Ditandai" di sesi picker yang sedang terbuka —
  // dipakai untuk kunci tombol "Tandai" tahap itu & buka tombol kamera-nya,
  // supaya alurnya: Tandai dulu (kirim pesan tahap) → baru boleh susulkan
  // foto (tanpa bikin pesan tahap dobel).
  const [markedStage, setMarkedStage] = useState<string | null>(null);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [savingViewerImage, setSavingViewerImage] = useState(false);

  // Alur foto susulan tahap DIROMBAK — SEBELUMNYA ikon kamera terpisah per
  // baris tahap (klik = langsung buka galeri, langsung kirim tanpa
  // preview). Sekarang: begitu "Tandai" ditekan → pop-up tanya mau upload
  // foto atau tidak → pilih sumber (Galeri/Kamera) → foto masuk ke
  // "keranjang" pendingStagePhotos yang bisa ditambah berkali-kali dari
  // sumber mana pun → staff cek preview & buang yang tidak perlu → baru
  // eksplisit tekan "Kirim" untuk benar-benar kirim ke chat. Diminta user
  // 2026-08-28.
  const [photoPromptOpen, setPhotoPromptOpen] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [photoPromptStage, setPhotoPromptStage] = useState<string | null>(null);
  const [pendingStagePhotos, setPendingStagePhotos] = useState<{ uri: string; name: string; type: string }[]>([]);
  const [sendingStagePhotos, setSendingStagePhotos] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waInfo, setWaInfo] = useState<WhatsAppBookingInfo | null>(null);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<'pending' | 'confirmed' | 'completed' | 'cancelled' | null>(null);
  // Kendaraan booking ini (plat, merek/model, warna) untuk bar di bawah header; null = booking lama tanpa data kendaraan.
  const [vehicleInfo, setVehicleInfo] = useState<{ plate: string; label: string; color: string | null } | null>(null);
  // Gap UX diperbaiki 2026-09-25 (audit SPK) — Filament sudah punya
  // tombol "Lihat SPK" 1-klik dari halaman Booking, mobile belum sama
  // sekali (staff harus pindah ke menu SPK terpisah & cari manual).
  // null = belum tahu/belum ada SPK, sampai fetchBookingStatus() selesai.
  const [spkId, setSpkId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmDurationDays, setConfirmDurationDays] = useState('1');
  // Kapasitas tim instalasi bisa BEDA-BEDA tiap tanggal (mis. 1 tim masih
  // ngerjain mobil dari hari sebelumnya, atau izin) — 1 baris per tanggal,
  // termasuk baris hari libur (non-editable, cuma penanda) supaya staff
  // tahu kenapa ada lompatan tanggal — bukan 1 angka global. Dimuat dari
  // GET .../capacity-preview.
  //
  // Redesain 2026-09-25 (diminta user, audit Booking Instalasi) —
  // SEBELUMNYA field 'capacity' di sini BISA DIEDIT staff & dikirim balik
  // ke server saat confirm (payload 'capacities') — kapasitas tidak
  // pernah tersimpan, staff mengetik ulang tiap approve, dan bisa beda-
  // beda antar staff untuk tanggal yang sama. Sekarang MURNI tampilan
  // (capacity = angka yang sudah tersimpan/default toko, dibaca dari
  // Booking::capacityForDate() di backend) — kapasitas diatur terpusat
  // lewat Kalender Kapasitas di Filament, bukan di sini lagi.
  const [capacityRows, setCapacityRows] = useState<
    ({ date: string; closed: true } | { date: string; closed: false; used: number; capacity: number })[]
  >([]);
  const [loadingCapacity, setLoadingCapacity] = useState(false);
  // Durasi yang dipakai saat capacityRows terakhir dimuat — dibandingkan
  // saat submit supaya kalau staff ubah durasi tanpa sempat reload
  // otomatis (mis. race jaringan lambat), submit ditolak DI SISI APP dulu
  // (bukan diam-diam kirim kapasitas yang belum pernah staff lihat/setujui
  // untuk tanggal tambahan).
  const [capacityLoadedForDuration, setCapacityLoadedForDuration] = useState<number | null>(null);
  // Jadwal ulang (keputusan 2026-10-02): staff bisa ubah tanggal langsung,
  // dan memutuskan pengajuan customer.
  const [bookingStoreId, setBookingStoreId] = useState<number | null>(null);
  const [rescheduleRequest, setRescheduleRequest] = useState<{ id: number; requested_date: string; reason: string | null } | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleBlocked, setRescheduleBlocked] = useState<string[]>([]);
  const [rescheduling, setRescheduling] = useState(false);
  // Pengajuan pembatalan dari customer (2026-10-05); keputusan hanya Store
  // Manager/akses penuh (server menolak 403 untuk yang lain).
  const [cancellationRequest, setCancellationRequest] = useState<{ id: number; reason: string } | null>(null);
  // Info pembatalan (booking cancelled): alasan & siapa yang membatalkan.
  const [cancelInfo, setCancelInfo] = useState<{ reason: string | null; by: string | null } | null>(null);
  const [cancelRejectOpen, setCancelRejectOpen] = useState(false);
  const [cancelRejectNote, setCancelRejectNote] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [bookingDate, setBookingDate] = useState<string | null>(null);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleLoadFailed, setRescheduleLoadFailed] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  // Koreksi tahap salah tandai (Store Manager/akses penuh).
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctStageKey, setCorrectStageKey] = useState<string | null>(null);
  const [correctReason, setCorrectReason] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const listRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  // Tinggi isi lembar (kalender, daftar) dibatasi secara pasti menurut tinggi layar, supaya area gulirnya selalu bisa digeser; hanya mengandalkan
  // batas tinggi lembar tidak membuat area gulir menyusut di sebagian perangkat.
  const { height: windowHeight } = useWindowDimensions();
  // Lembar bawah (konfirmasi, ubah jadwal, batalkan) diangkat tepat di atas keyboard tanpa mengangkat dua kali bila Android sudah mengecilkan window
  // modalnya (lihat lib/use-keyboard-lift.ts); mengangkat sebesar tinggi keyboard secara langsung membuat lembar melayang jauh di atasnya.
  const { keyboardVisible: sheetKeyboard, lift: sheetLift, onBoxLayout: onSheetLayout } = useKeyboardLift();

  // Titik di tab Chat bila ada pesan pelanggan yang masuk saat staf sedang di tab Ringkasan.
  const latestCustomerMessageId = useMemo(
    () => messages.reduce((max, m) => (m.sender_type === 'customer' && m.id > max ? m.id : max), 0),
    [messages]
  );
  const [seenCustomerMessageId, setSeenCustomerMessageId] = useState<number | null>(null);
  useEffect(() => {
    if (loading) return;
    if (activeTab === 'chat' || seenCustomerMessageId === null) setSeenCustomerMessageId(latestCustomerMessageId);
  }, [activeTab, loading, latestCustomerMessageId, seenCustomerMessageId]);
  const hasUnreadChat = activeTab !== 'chat' && seenCustomerMessageId !== null && latestCustomerMessageId > seenCustomerMessageId;

  // KeyboardAvoidingView bawaan RN TERNYATA tidak reliable di Android
  // untuk layar ini — behavior="height" bisa macet di tinggi lama
  // setelah keyboard sempat muncul/hilang akibat interaksi lain (mis.
  // update tahap), meninggalkan ruang kosong di bawah kolom input;
  // behavior={undefined} malah bikin keyboard nutupin kolom input
  // sepenuhnya. Pola ini SUDAH TERBUKTI jalan di components/ui/
  // PickerModal.tsx (fix 2026-08-27) — lacak tinggi keyboard manual,
  // dorong kolom input naik sejumlah itu sendiri, tidak bergantung
  // behavior bawaan sama sekali. Ditemukan & diperbaiki 2026-08-28.
  // Pengangkatan di atas keyboard dihitung dari seberapa banyak jendela sudah dikecilkan sistem (lihat lib/use-keyboard-lift.ts), supaya tidak
  // terangkat dua kali: kolom pesan tidak melayang jauh di atas keyboard di perangkat yang jendelanya sudah mengecil sendiri.
  const { lift: chatLift, onBoxLayout: onChatBoxLayout } = useKeyboardLift();

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  // Daftar installer / direksi dibuka di lembar pilihan tersendiri (bukan dibentangkan di dalam lembar Assignment), supaya tidak memanjang bila banyak.
  const [assignPicker, setAssignPicker] = useState<'installer' | 'watcher' | null>(null);
  const [assignQuery, setAssignQuery] = useState('');
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [installerOptions, setInstallerOptions] = useState<StaffOption[]>([]);
  const [direksiOptions, setDireksiOptions] = useState<StaffOption[]>([]);
  const [selectedInstallerIds, setSelectedInstallerIds] = useState<number[]>([]);
  // Installer yang boleh ikut chat booking ini (subset dari yang ditugaskan).
  const [chatInstallerIds, setChatInstallerIds] = useState<number[]>([]);
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
      setChatInstallerIds(detail.data.installers.filter((i) => i.can_chat).map((i) => i.id));
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
    setChatInstallerIds((prev) => prev.filter((id) => id !== userId));
  };

  const toggleWatcher = (userId: number) => {
    setSelectedWatcherIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSaveAssignment = async () => {
    setAssignSaving(true);
    try {
      const installerRes = await staffApiFetch<{ warnings?: string[] }>(`/api/staff/bookings/${bookingId}/installers`, {
        method: 'PUT',
        body: JSON.stringify({
          installer_user_ids: selectedInstallerIds,
          chat_installer_user_ids: chatInstallerIds.filter((id) => selectedInstallerIds.includes(id)),
        }),
      });
      await staffApiFetch(`/api/staff/bookings/${bookingId}/watchers`, {
        method: 'PUT',
        body: JSON.stringify({ watcher_user_ids: selectedWatcherIds }),
      });
      setAssignModalOpen(false);
      const clashWarnings = installerRes.warnings ?? [];
      Alert.alert(
        clashWarnings.length > 0 ? 'Tersimpan, ada jadwal bertumpuk' : 'Berhasil',
        clashWarnings.length > 0
          ? 'Assignment disimpan, tapi periksa:\n\n' + clashWarnings.join('\n')
          : 'Assignment booking berhasil disimpan.'
      );
    } catch (err) {
      const message = err instanceof StaffApiError ? err.message : 'Tidak bisa menyimpan assignment. Periksa koneksi internet.';
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
    return staffApiFetch<{
      data: {
        status: typeof bookingStatus;
        spk: { id: number } | null;
        store_id: number | null;
        preferred_date: string | null;
        pending_reschedule_request: { id: number; requested_date: string; reason: string | null } | null;
        pending_cancellation_request: { id: number; reason: string } | null;
        cancel_reason?: string | null;
        cancelled_by_type?: string | null;
        vehicle_plate?: string | null;
        vehicle_brand?: string | null;
        vehicle_model?: string | null;
        vehicle_variant?: string | null;
        vehicle_color?: string | null;
        booking_number?: string;
        service_type?: string | null;
        product_ppf?: boolean;
        ppf_exterior?: boolean;
        ppf_interior?: boolean;
        preferred_time?: string | null;
        ready_at?: string | null;
        duration_days?: number | null;
        customer?: { name: string; phone_number: string | null } | null;
        store?: { name: string } | null;
      };
    }>(`/api/staff/bookings/${bookingId}`)
      .then((res) => {
        setSummary({
          bookingNumber: res.data.booking_number ?? null,
          service: withPpfArea(res.data.service_type, res.data.product_ppf, res.data.ppf_exterior, res.data.ppf_interior),
          time: res.data.preferred_time ?? null,
          durationDays: res.data.duration_days ?? null,
          ppfDays: res.data.product_ppf ? ppfDefaultDays(res.data.ppf_exterior, res.data.ppf_interior) : null,
          customerName: res.data.customer?.name ?? null,
          customerPhone: res.data.customer?.phone_number ?? null,
          storeName: res.data.store?.name ?? null,
        });
        setVehicleInfo(res.data.vehicle_plate
          ? { plate: res.data.vehicle_plate, label: [res.data.vehicle_brand, res.data.vehicle_model, res.data.vehicle_variant].filter(Boolean).join(' '), color: res.data.vehicle_color ?? null }
          : null);
        setWaInfo(res.data.customer?.phone_number && res.data.preferred_date ? {
          phone: res.data.customer.phone_number,
          customerName: res.data.customer.name,
          bookingNumber: res.data.booking_number ?? '',
          service: res.data.service_type ?? 'layanan',
          store: res.data.store?.name ?? 'toko kami',
          dateLabel: parseDate(res.data.preferred_date.slice(0, 10)).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
          time: res.data.preferred_time ?? null,
          ready: !!res.data.ready_at,
        } : null);
        setBookingStatus(res.data.status);
        setSpkId(res.data.spk?.id ?? null);
        setBookingStoreId(res.data.store_id ?? null);
        setBookingDate(res.data.preferred_date ? res.data.preferred_date.slice(0, 10) : null);
        setRescheduleRequest(res.data.pending_reschedule_request ?? null);
        setCancellationRequest(res.data.pending_cancellation_request ?? null);
        setCancelInfo(res.data.status === 'cancelled'
          ? { reason: res.data.cancel_reason ?? null, by: res.data.cancelled_by_type ?? null }
          : null);
      })
      .catch(() => {
        // Diam-diam gagal saja — tombol "Konfirmasi Booking" cuma tidak
        // muncul, chat tetap bisa dipakai seperti biasa (fetchMessages
        // yang menangani error load utama).
      });
  }, [bookingId]);

  // Durasi yang terakhir dicoba dimuat: bila gagal, pemuatan otomatis tidak mengulang durasi yang sama tanpa henti.
  const capacityAttempted = useRef<number | null>(null);

  const loadCapacityPreview = async (durationDays: number) => {
    capacityAttempted.current = durationDays;
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
          : { date: row.date, closed: false, used: row.used, capacity: row.default_capacity }
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
    const duration = productPpf ? (summary?.ppfDays ?? 3) : 1;
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

  // Daftar kapasitas juga dimuat ulang sendiri sebentar setelah staf berhenti mengetik, jadi tidak perlu menekan centang di keyboard dulu
  // (pada papan angka, tombol centang atau mengetuk di luar kolom tidak selalu menutup isian). Jeda mencegah permintaan tiap digit.
  useEffect(() => {
    if (!confirmModalOpen || loadingCapacity) return;

    const durationDays = parseInt(confirmDurationDays, 10);
    if (!durationDays || durationDays < 1 || durationDays === capacityLoadedForDuration || durationDays === capacityAttempted.current) return;

    const timer = setTimeout(() => loadCapacityPreview(durationDays), 600);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmDurationDays, confirmModalOpen, capacityLoadedForDuration, loadingCapacity]);

  const submitConfirmBooking = async () => {
    const durationDays = parseInt(confirmDurationDays, 10);

    if (!durationDays || durationDays < 1) {
      Alert.alert('Data tidak valid', 'Lama pengerjaan minimal 1 hari.');
      return;
    }

    // Jaring pengaman — kalau durasi berubah tapi daftar tanggal (dipakai
    // buat tampilan "penuh/tidak" sebelum submit) belum sempat dimuat
    // ulang, minta staff cek lagi dulu — server tetap validasi ulang
    // sendiri di confirm(), ini murni supaya staff tidak submit sambil
    // melihat data kapasitas yang sudah basi di layar.
    if (durationDays !== capacityLoadedForDuration) {
      Alert.alert(
        'Tanggal belum diperbarui',
        'Lama pengerjaan berubah, daftar tanggal dimuat ulang. Cek lagi lalu tekan Konfirmasi.'
      );
      loadCapacityPreview(durationDays);
      return;
    }

    setConfirming(true);
    try {
      const res = await staffApiFetch<{ warnings?: string[] }>(`/api/staff/bookings/${bookingId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ duration_days: durationDays }),
      });
      setBookingStatus('confirmed');
      setConfirmModalOpen(false);
      // Peringatan (mis. installer yang masuk kerja kurang) hanya informasi: booking tetap terkonfirmasi.
      const warnings = res?.warnings ?? [];
      Alert.alert(warnings.length ? 'Dikonfirmasi, perhatikan' : 'Berhasil', ['Booking dikonfirmasi.', ...warnings].join('\n\n'));
    } catch (err) {
      // Pesan dari backend sudah spesifik (mis. tanggal mana yang penuh)
      // — ditampilkan apa adanya, bukan pesan generik.
      const message = err instanceof StaffApiError
        ? err.message
        : 'Tidak bisa mengonfirmasi booking. Periksa koneksi internet.';
      Alert.alert('Gagal', message);
    } finally {
      setConfirming(false);
    }
  };

  // Polling incremental: poll biasa hanya minta pesan setelah id terakhir
  // (?after_id=), dan penuh tiap ~1 menit supaya pesan yang dihapus di Filament
  // ikut hilang. Panggilan tanpa argumen = muat penuh.
  const lastMessageIdRef = useRef(0);
  const pollTickRef = useRef(0);
  // Respons yang datang tidak berurutan (poll penuh vs incremental) dibuang:
  // hanya permintaan TERBARU yang boleh mengubah state.
  const fetchSeqRef = useRef(0);

  // Installer tidak ikut chat: layar ini menampilkan detail pengerjaan booking-nya saja (lihat tampilan installer di bawah).
  const [installerBooking, setInstallerBooking] = useState<InstallerBookingInfo | null>(null);
  const [installerError, setInstallerError] = useState<string | null>(null);
  // Installer yang diberi izin chat lewat Assignment memakai tampilan utama (tab Ringkasan + Chat); yang tidak, tetap tampilan installer.
  const installerChat = isInstaller && !!installerBooking?.installers?.find((i) => i.id === staff?.id)?.can_chat;
  const installerOnly = isInstaller && !installerChat;
  // Menandai tahap dan melampirkan foto: staf pengelola, plus installer berizin chat.
  const canMarkStage = canManageProgress || installerChat;

  const fetchInstallerBooking = useCallback(() => {
    setInstallerError(null);
    return staffApiFetch<{ data: InstallerBookingInfo }>(`/api/staff/bookings/${bookingId}`)
      .then((res) => setInstallerBooking(res.data))
      .catch((err) => setInstallerError(err instanceof StaffApiError ? err.message : 'Gagal memuat detail booking.'));
  }, [bookingId]);

  useEffect(() => {
    if (isInstaller) fetchInstallerBooking();
  }, [isInstaller, fetchInstallerBooking]);

  const fetchMessages = useCallback((incremental: boolean = false) => {
    if (installerOnly) {
      return Promise.resolve();
    }
    const seq = ++fetchSeqRef.current;
    const afterId = incremental === true && lastMessageIdRef.current > 0 ? lastMessageIdRef.current : 0;
    return staffApiFetch<{
      data: {
        current_stage: string | null;
        secondary_stage: string | null;
        product_kaca_film: boolean;
        product_ppf: boolean;
        messages: BookingMessage[];
      };
    }>(`/api/staff/bookings/${bookingId}/messages${afterId ? `?after_id=${afterId}` : ''}`)
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
  }, [bookingId, installerOnly]);

  useEffect(() => {
    fetchBookingStatus();
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
    // Status & pengajuan customer dimuat ulang tiap 30 dtk: pengajuan baru
    // muncul, dan tombol hilang kalau staff lain sudah memutuskan.
    let statusInterval: ReturnType<typeof setInterval> | null = null;
    const startStatus = () => { if (!statusInterval) statusInterval = setInterval(fetchBookingStatus, 30000); };
    const stopStatus = () => { if (statusInterval) { clearInterval(statusInterval); statusInterval = null; } };
    startStatus();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { fetchMessages(); fetchBookingStatus(); start(); startStatus(); } else { stop(); stopStatus(); }
    });
    return () => { stop(); stopStatus(); sub.remove(); };
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
        : 'Periksa koneksi internet dan coba lagi.';
      Alert.alert('Gagal Mengirim', message);
      return false;
    } finally {
      setSending(false);
    }
  };

  // Simpan foto chat ke galeri perangkat. writeOnly: layar ini hanya MENULIS ke galeri, tidak membaca foto lain milik pengguna, sehingga tidak
  // memerlukan izin baca media (kebijakan Foto & Video Google Play).
  const saveViewerImage = async () => {
    if (!viewerImage || savingViewerImage) return;

    setSavingViewerImage(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert('Butuh Izin', 'Aktifkan izin akses galeri di Pengaturan untuk menyimpan foto.', [
          { text: 'Batal', style: 'cancel' },
          { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() },
        ]);

        return;
      }

      const ext = viewerImage.split('.').pop()?.split('?')[0] || 'jpg';
      const localUri = `${FileSystem.cacheDirectory}ginnva-chat-${Date.now()}.${ext.length <= 4 ? ext : 'jpg'}`;
      const { uri } = await FileSystem.downloadAsync(viewerImage, localUri);
      await MediaLibrary.saveToLibraryAsync(uri);

      Alert.alert('Berhasil', 'Foto disimpan ke galeri perangkat.');
    } catch {
      Alert.alert('Gagal', 'Foto gagal disimpan. Periksa koneksi internet.');
    } finally {
      setSavingViewerImage(false);
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

  // Tombol kamera bebas ("Ketik pesan" → ikon kamera di bawah, foto BUKAN
  // susulan tahap tertentu) — SEBELUMNYA langsung buka galeri tanpa
  // pilihan. Sekarang tanya sumbernya dulu, sama seperti alur foto
  // tahap. Diminta user 2026-08-28.
  const sendGeneralPhotos = async (assets: { uri: string; name: string; type: string }[]) => {
    if (!assets.length) return;

    const form = new FormData();
    form.append('type', 'photo');
    assets.forEach((asset) => {
      form.append('photos[]', asset as any);
    });

    setStagePickerOpen(false);
    sendMessage(form);
  };

  const handlePickPhotoFromGallery = async () => {
    if (!(await requestGalleryPermission())) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets?.length) return;

    sendGeneralPhotos(await shrinkAllForUpload(result.assets, 'photo'));
  };

  const handlePickPhotoFromCamera = async () => {
    if (!(await requestCameraPermission())) return;

    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5 });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    sendGeneralPhotos([await shrinkForUpload(asset, `photo-${Date.now()}.jpg`)]);
  };

  const handlePickPhoto = () => {
    Alert.alert('Kirim Foto', 'Pilih sumber foto', [
      { text: 'Galeri', onPress: handlePickPhotoFromGallery },
      { text: 'Kamera', onPress: handlePickPhotoFromCamera },
      { text: 'Batal', style: 'cancel' },
    ]);
  };

  const handlePickStage = async (stage: string) => {
    // Tahap "Selesai" = booking benar-benar selesai & customer sudah bayar
    // di toko — SELALU lewat modal complete, TIDAK lewat pop-up foto tahap
    // biasa. /complete di backend MURNI penanda status (tidak urus nominal
    // transaksi/kode referral/voucher sama sekali) — itu diisi terpisah
    // lewat aksi "Proses Referral" di Filament, lihat teks modal complete
    // di bawah & BookingController::complete() untuk detailnya.
    if (stage === 'completed') {
      if (currentStage === 'completed') return; // sudah selesai, tidak bisa diulang
      setStagePickerOpen(false);
      setCompleteModalOpen(true);
      return;
    }

    if (sending) return;

    const form = new FormData();
    form.append('type', 'stage');
    form.append('stage', stage);
    // Tunggu hasil: kalau server menolak (422), tahap TIDAK ditandai & pop-up
    // foto tidak dibuka (sendMessage sudah menampilkan alasannya).
    const sent = await sendMessage(form);
    if (!sent) return;
    setMarkedStage(stage);

    // Begitu tahap ditandai, tanya mau susulkan foto atau tidak — bukan
    // langsung buka galeri seperti sebelumnya.
    setPhotoPromptStage(stage);
    setPendingStagePhotos([]);
    // Tutup pop-up tahap dulu, baru buka pop-up foto (dua Modal tidak boleh tampil bersamaan di iOS).
    setStagePickerOpen(false);
    setTimeout(() => setPhotoPromptOpen(true), 300);
  };

  // QC lulus otomatis menandai tahap Quality Check, supaya "Selesai" terbuka tanpa langkah Tandai terpisah.
  const markQcStageAfterPass = async () => {
    if (currentStage === 'qc' || currentStage === 'completed') return;
    const form = new FormData();
    form.append('type', 'stage');
    form.append('stage', 'qc');
    await sendMessage(form);
  };

  const requestGalleryPermission = async (): Promise<boolean> => {
    // Cuma iOS — Android pakai Photo Picker bawaan sistem (Android 13+)
    // yang tidak butuh izin apa pun. Lihat catatan Play Console soal
    // READ_MEDIA_IMAGES/READ_MEDIA_VIDEO.
    if (Platform.OS !== 'ios') return true;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.granted) return true;

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
      Alert.alert('Butuh Izin', 'Aktifkan izin akses galeri untuk mengirim foto.');
    }
    return false;
  };

  const requestCameraPermission = async (): Promise<boolean> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.granted) return true;

    if (!permission.canAskAgain) {
      Alert.alert(
        'Izin Ditolak Permanen',
        'Aktifkan izin akses kamera lewat Pengaturan untuk memotret foto tahap.',
        [
          { text: 'Batal', style: 'cancel' },
          { text: 'Buka Pengaturan', onPress: () => Linking.openSettings() },
        ]
      );
    } else {
      Alert.alert('Butuh Izin', 'Aktifkan izin akses kamera untuk memotret foto tahap.');
    }
    return false;
  };

  // Dipanggil dari pop-up "Ingin upload foto tahap?" — hasil dari galeri
  // MAUPUN kamera masuk ke keranjang pendingStagePhotos yang sama, bisa
  // ditambah berkali-kali dari sumber campuran sebelum benar-benar
  // dikirim.
  const addStagePhotosFromGallery = async () => {
    if (!(await requestGalleryPermission())) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (result.canceled || !result.assets?.length) return;

    const shrunk = await shrinkAllForUpload(result.assets, 'photo');
    setPendingStagePhotos((prev) => [...prev, ...shrunk]);
    setPhotoPromptOpen(false);
    setPhotoPreviewOpen(true);
  };

  const addStagePhotoFromCamera = async () => {
    if (!(await requestCameraPermission())) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.5,
    });

    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const shrunk = await shrinkForUpload(asset, `photo-${Date.now()}.jpg`);
    setPendingStagePhotos((prev) => [...prev, shrunk]);
    setPhotoPromptOpen(false);
    setPhotoPreviewOpen(true);
  };

  const removePendingStagePhoto = (index: number) => {
    setPendingStagePhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const skipStagePhotos = () => {
    setPhotoPromptOpen(false);
    setPhotoPreviewOpen(false);
    setPhotoPromptStage(null);
    setPendingStagePhotos([]);
  };

  const sendStagePhotos = async () => {
    if (pendingStagePhotos.length === 0 || !photoPromptStage) return;

    // Backend batasi maks 10 foto per pesan (lihat
    // StaffBookingMessageController::store()) — keranjang di sini bisa
    // dipupuk dari beberapa kali pilih galeri/kamera, jadi perlu dicek
    // sebelum kirim, bukan cuma andalkan validasi server.
    if (pendingStagePhotos.length > 10) {
      Alert.alert('Terlalu Banyak Foto', 'Maksimal 10 foto per pengiriman. Buang beberapa foto dulu, atau kirim sisanya sebagai pesan susulan.');
      return;
    }

    setSendingStagePhotos(true);
    const form = new FormData();
    form.append('type', 'photo');
    form.append('stage', photoPromptStage);
    pendingStagePhotos.forEach((photo) => {
      form.append('photos[]', photo as any);
    });

    const ok = await sendMessage(form);
    setSendingStagePhotos(false);
    if (ok) {
      setPhotoPreviewOpen(false);
      setPhotoPromptStage(null);
      setPendingStagePhotos([]);
    }
  };

  // Booking dengan KEDUA produk → Kaca Film & PPF jalan paralel (Kaca Film
  // di currentStage, PPF di secondaryStage). Cuma 1 produk → track itu
  // tetap pakai currentStage persis seperti sebelumnya (tidak ada
  // perubahan perilaku untuk booking 1 produk).
  const bothProducts = productKacaFilm && productPpf;
  const kacaFilmColumnValue = currentStage;
  const ppfColumnValue = bothProducts ? secondaryStage : currentStage;
  // Pengerjaan dimulai = tahap APA PUN sudah ditandai (booking Kaca Film +
  // PPF yang mulai dari PPF hanya mengisi secondaryStage).
  const workStarted = !!currentStage || !!secondaryStage;

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
    let idx = trackStages.findIndex((s) => s.key === columnValue);
    // Booking sudah di tahap bersama (Quality Check/Serah Terima): seluruh track produk sudah selesai, jadi semua titiknya menyala.
    if (idx === -1 && SHARED_STAGES.some((sh) => sh.key === columnValue)) idx = trackStages.length - 1;
    // Tiap tahap satu kolom: titik bergaris penghubung di atas, nama tahap di bawahnya.
    return trackStages.map((s, i) => {
      const isDone = i <= idx;
      const first = i === 0;
      const last = i === trackStages.length - 1;
      return (
        <View key={s.key} style={styles.stageCol}>
          <View style={styles.stageColTop}>
            <View style={[styles.stageLine, first && styles.stageLineHidden, i <= idx && !first && styles.stageLineActive]} />
            <View style={[styles.stageDot, isDone && styles.stageDotActive]}>
              <Ionicons name={s.icon} size={12} color={isDone ? '#ffffff' : colors.textMuted} />
            </View>
            <View style={[styles.stageLine, last && styles.stageLineHidden, i < idx && !last && styles.stageLineActive]} />
          </View>
          <Text style={[styles.stageName, isDone && styles.stageNameActive]} numberOfLines={2}>{s.label}</Text>
        </View>
      );
    });
  };

  // Booking 2 produk harus SELESAI KEDUA track (Kaca Film & PPF) dulu
  // sebelum boleh "Quality Check" — SEBELUMNYA tidak dicek sama sekali:
  // "Tahap Akhir" (qc/completed) selalu dirender dengan columnValue =
  // currentStage (kolom track Kaca Film SAJA, lihat renderStagePickerRows
  // di bawah + Booking::stageColumnFor() yang menaruh qc/completed balik
  // ke current_stage). Akibatnya begitu track Kaca Film sampai tahap
  // terakhirnya, tombol "Tandai" Quality Check langsung TERBUKA walau
  // track PPF (secondary_stage) belum mulai/masih di tengah — booking
  // bisa ditandai Selesai (memicu notifikasi customer, poin referral,
  // & Jurnal Pendapatan) padahal PPF-nya belum benar-benar dikerjakan.
  // Backend (StaffBookingMessageController::store()) juga TIDAK
  // memvalidasi urutan/kelengkapan tahap sama sekali, jadi ini bukan
  // cuma soal UI — dikunci di sini. Ditemukan saat audit chat & foto
  // tahap booking 2026-09-07.
  const kacaFilmTrackDone = !productKacaFilm || kacaFilmColumnValue === KACA_FILM_STAGES[KACA_FILM_STAGES.length - 1].key;
  const ppfTrackDone = !productPpf || ppfColumnValue === PPF_STAGES[PPF_STAGES.length - 1].key;
  const readyForQc = kacaFilmTrackDone && ppfTrackDone;

  const renderStagePickerRows = (trackStages: StageItem[], columnValue: string | null, qcGateOk: boolean = true) => {
    const isMarkedInTrack = markedStage !== null && trackStages.some((s) => s.key === markedStage);
    const effectiveStage = isMarkedInTrack ? markedStage : columnValue;
    let effectiveIdx = trackStages.findIndex((s) => s.key === effectiveStage);
    // -1 punya 2 arti berbeda yang HARUS dibedakan:
    // 1. effectiveStage === null (booking baru, belum ada tahap ditandai
    //    sama sekali) -> track ini BELUM MULAI, semua "Tandai" harus
    //    tetap terbuka. Biarkan effectiveIdx = -1 (perilaku asli).
    // 2. effectiveStage adalah tahap BERSAMA (SHARED_STAGES, mis. 'qc')
    //    -> progress sudah lewat dari track produk manapun, track ini
    //    SUDAH SELESAI SEMUA, semua "Tandai" harus tetap terkunci.
    // SEBELUMNYA kedua kasus disamakan (fix 2026-08-28 pertama cuma
    // tangani kasus 2, tapi jadi ikut mengunci kasus 1 — booking baru
    // yang belum mulai sama sekali malah semua tombolnya ikut terkunci).
    const isSharedStageValue = effectiveStage !== null && SHARED_STAGES.some((s) => s.key === effectiveStage);
    if (effectiveIdx === -1 && isSharedStageValue) {
      effectiveIdx = trackStages.length - 1;
    }

    return trackStages.map((s, idx) => {
      const isCompletedRow = s.key === 'completed';
      // "Selesai" HARUS lewat QC dulu — booking ini punya konsekuensi nyata
      // begitu ditandai (memicu poin referral/voucher/notifikasi "selesai"
      // ke customer lewat /complete), jadi tidak boleh sama permisifnya
      // dengan tahap internal lain yang memang boleh ditandai maju bebas.
      const isQcRow = s.key === 'qc';
      const tandaiDisabled = sending || (isCompletedRow
        ? currentStage !== 'qc'
        : isQcRow
          ? (idx <= effectiveIdx) || !qcGateOk
          : idx <= effectiveIdx);
      // Ikon kamera per baris DIHAPUS — dirombak jadi alur pop-up setelah
      // "Tandai" ditekan (lihat handlePickStage & modal photoPromptOpen/
      // photoPreviewOpen). Ditemukan cocok lewat permintaan redesain user
      // 2026-08-28.
      const isDoneRow = isCompletedRow ? currentStage === 'completed' : idx < effectiveIdx || (idx === effectiveIdx && !isMarkedInTrack && effectiveStage !== null);
      // Track produk yang sudah lewat ke tahap bersama (Quality Check dst.) selesai seluruhnya: tahap terakhirnya hijau, bukan "saat ini".
      const trackPassed = isSharedStageValue && !trackStages.some((st) => SHARED_STAGES.some((sh) => sh.key === st.key));
      const isNowRow = !isCompletedRow && idx === effectiveIdx && !trackPassed;
      const isLast = idx === trackStages.length - 1;
      return (
        <View key={s.key} style={[styles.stgRow, !isLast && styles.stgRowDivider]}>
          <View style={[styles.stgIcon, isNowRow && styles.stgIconNow, isDoneRow && !isNowRow && styles.stgIconDone]}>
            <Ionicons
              name={isDoneRow ? 'checkmark' : s.icon}
              size={isDoneRow ? 18 : 17}
              color={isNowRow || isDoneRow ? '#ffffff' : colors.textMuted}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.stgLabel, tandaiDisabled && !isNowRow && styles.stgLabelMuted]}>{s.label}</Text>
            {isNowRow ? <Text style={styles.stgNow}>Tahap saat ini</Text> : null}
          </View>
          {!tandaiDisabled && !(isInstaller && (isQcRow || isCompletedRow)) ? (
            isQcRow ? (
              <Pressable
                style={styles.stgBtn}
                onPress={() => { setStagePickerOpen(false); setTimeout(() => setQcModalOpen(true), 300); }}
                accessibilityRole="button"
                accessibilityLabel="Buka Quality Check"
              >
                <Text style={styles.stgBtnText}>Periksa</Text>
              </Pressable>
            ) : isCompletedRow ? (
              <Pressable
                style={styles.stgBtn}
                onPress={() => { setStagePickerOpen(false); setTimeout(() => setHandoverModalOpen(true), 300); }}
                accessibilityRole="button"
                accessibilityLabel="Buka Serah Terima Unit"
              >
                <Text style={styles.stgBtnText}>Serah Terima</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.stgBtn}
                onPress={() => handlePickStage(s.key)}
                accessibilityRole="button"
                accessibilityLabel={`Tandai tahap ${s.label}`}
              >
                <Text style={styles.stgBtnText}>Tandai</Text>
              </Pressable>
            )
          ) : null}
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

      // Pesan tahap "Selesai" sekarang dibuat server (BookingObserver) untuk
      // semua jalur, termasuk dari panel admin -- tidak dikirim lagi dari
      // sini supaya tidak dobel (2026-10-03).
      setCompleteModalOpen(false);
      fetchBookingStatus();
      fetchMessages();
      if (res.message) Alert.alert('Berhasil', res.message);
    } catch (err) {
      const message = err instanceof StaffApiError ? err.message : 'Tidak bisa menyelesaikan booking. Periksa koneksi internet.';
      Alert.alert('Gagal', message);
    } finally {
      setCompleting(false);
    }
  };

  // Pelanggan terkonfirmasi tidak datang (Fase 3C): dibatalkan dengan penanda no-show; DP dikembalikan penuh oleh server.
  const markNoShow = () => {
    Alert.alert(
      'Tandai pelanggan tidak datang?',
      'Booking dibatalkan dan slot dilepas. DP (kalau ada) dikembalikan penuh. Tidak bisa dibatalkan lagi.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Tandai Tidak Datang',
          style: 'destructive',
          onPress: async () => {
            setMarkingNoShow(true);
            try {
              await staffApiFetch(`/api/staff/bookings/${bookingId}/no-show`, { method: 'POST' });
              setBookingStatus('cancelled');
              fetchBookingStatus();
              Alert.alert('Berhasil', 'Booking ditandai pelanggan tidak datang dan dibatalkan.');
            } catch (err) {
              Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa memproses. Periksa koneksi internet.');
            } finally {
              setMarkingNoShow(false);
            }
          },
        },
      ],
    );
  };

  const openCancelModal = () => {
    setCancelReason('');
    setCancelModalOpen(true);
  };

  const loadRescheduleAvailability = () => {
    if (!bookingStoreId) return;
    setRescheduleLoading(true);
    setRescheduleLoadFailed(false);
    // Satu endpoint: toko tutup (mingguan/diblokir) + kapasitas penuh.
    staffApiFetch<{ data: string[] }>(`/api/stores/${bookingStoreId}/unavailable-dates?booking_id=${bookingId}`)
      .then((res) => setRescheduleBlocked(res.data))
      .catch(() => setRescheduleLoadFailed(true))
      .finally(() => setRescheduleLoading(false));
  };

  const openReschedule = () => {
    setRescheduleDate('');
    setRescheduleReason('');
    setRescheduleBlocked([]);
    setRescheduleOpen(true);
    loadRescheduleAvailability();
  };

  const submitReschedule = async () => {
    if (!rescheduleDate || rescheduling) return;
    // Alasan wajib untuk booking yang sudah dikonfirmasi (dikirim ke customer).
    if (bookingStatus === 'confirmed' && rescheduleReason.trim().length === 0) {
      Alert.alert('Alasan wajib', 'Isi alasan pindah jadwal, akan dikirim ke customer.');
      return;
    }
    setRescheduling(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/reschedule`, {
        method: 'PUT',
        body: JSON.stringify({ preferred_date: rescheduleDate, reason: rescheduleReason.trim() || undefined }),
      });
      setRescheduleOpen(false);
      Alert.alert('Berhasil', 'Jadwal booking diubah dan customer sudah diberi tahu.');
      fetchBookingStatus();
    } catch (err) {
      Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa mengubah jadwal. Periksa koneksi internet.');
    } finally {
      setRescheduling(false);
    }
  };

  const approveCancellationRequest = () => {
    if (!cancellationRequest || deciding) return;
    Alert.alert(
      'Setujui Pembatalan?',
      `Alasan customer: ${cancellationRequest.reason}\n\nBooking akan dibatalkan dan DP (kalau ada) dikembalikan penuh.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Setujui',
          style: 'destructive',
          onPress: async () => {
            setDeciding(true);
            try {
              await staffApiFetch(`/api/staff/bookings/${bookingId}/cancellation-request/${cancellationRequest.id}/approve`, { method: 'POST' });
              fetchBookingStatus();
            } catch (err) {
              Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa memproses pengajuan. Periksa koneksi internet.');
              fetchBookingStatus(); // mungkin sudah diputuskan staff lain
            } finally {
              setDeciding(false);
            }
          },
        },
      ]
    );
  };

  const submitRejectCancellation = async () => {
    if (!cancellationRequest || deciding) return;
    if (cancelRejectNote.trim().length === 0) {
      Alert.alert('Alasan wajib', 'Isi alasan penolakan, akan dikirim ke customer.');
      return;
    }
    setDeciding(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/cancellation-request/${cancellationRequest.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note: cancelRejectNote.trim() }),
      });
      setCancelRejectOpen(false);
      fetchBookingStatus();
    } catch (err) {
      Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa memproses pengajuan. Periksa koneksi internet.');
    } finally {
      setDeciding(false);
    }
  };

  const submitRejectReschedule = async () => {
    if (!rescheduleRequest || deciding) return;
    if (rejectNote.trim().length === 0) {
      Alert.alert('Alasan wajib', 'Isi alasan penolakan, akan dikirim ke customer.');
      return;
    }
    setDeciding(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/reschedule-request/${rescheduleRequest.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ note: rejectNote.trim() }),
      });
      setRejectOpen(false);
      fetchBookingStatus();
    } catch (err) {
      Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa memproses pengajuan. Periksa koneksi internet.');
    } finally {
      setDeciding(false);
    }
  };

  const decideReschedule = (decision: 'approve' | 'reject') => {
    if (!rescheduleRequest || deciding) return;
    // Penolakan wajib alasan (dikirim ke customer) -- pakai modal.
    if (decision === 'reject') {
      setRejectNote('');
      setRejectOpen(true);
      return;
    }
    Alert.alert(
      decision === 'approve' ? 'Setujui Jadwal Ulang?' : 'Tolak Jadwal Ulang?',
      `Pengajuan customer: ${parseDate(rescheduleRequest.requested_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: decision === 'approve' ? 'Setujui' : 'Tolak',
          style: decision === 'approve' ? 'default' : 'destructive',
          onPress: async () => {
            setDeciding(true);
            try {
              await staffApiFetch(`/api/staff/bookings/${bookingId}/reschedule-request/${rescheduleRequest.id}/${decision}`, { method: 'POST' });
              fetchBookingStatus();
            } catch (err) {
              Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa memproses pengajuan. Periksa koneksi internet.');
            } finally {
              setDeciding(false);
            }
          },
        },
      ]
    );
  };

  const submitCorrectStage = async () => {
    if (!correctStageKey || correcting) return;
    if (correctReason.trim().length === 0) {
      Alert.alert('Alasan wajib', 'Isi alasan koreksi tahap.');
      return;
    }
    setCorrecting(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/stage-correction`, {
        method: 'POST',
        body: JSON.stringify({ stage: correctStageKey, reason: correctReason.trim() }),
      });
      setCorrectOpen(false);
      setStagePickerOpen(false);
      await fetchMessages();
      Alert.alert('Berhasil', 'Tahap dikoreksi.');
    } catch (err) {
      Alert.alert('Gagal', err instanceof StaffApiError ? err.message : 'Tidak bisa mengoreksi tahap. Periksa koneksi internet.');
    } finally {
      setCorrecting(false);
    }
  };

  const submitCancelBooking = async () => {
    if (bookingStatus === 'confirmed' && cancelReason.trim().length === 0) {
      Alert.alert('Alasan wajib', 'Isi alasan pembatalan untuk booking yang sudah dikonfirmasi.');
      return;
    }
    setCancelling(true);
    try {
      await staffApiFetch(`/api/staff/bookings/${bookingId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      setBookingStatus('cancelled');
      setCancelModalOpen(false);
      fetchBookingStatus();
      Alert.alert('Berhasil', 'Booking dibatalkan.');
    } catch (err) {
      const message = err instanceof StaffApiError
        ? err.message
        : 'Tidak bisa membatalkan booking. Periksa koneksi internet.';
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
                : 'Tidak bisa mengirim pengingat. Periksa koneksi internet.';
              Alert.alert('Gagal', message);
            } finally {
              setSendingReminder(false);
            }
          },
        },
      ]
    );
  };

  // Menu Aksi: semua aksi booking dikumpulkan di satu tombol berlabel "Aksi" (sebelumnya deretan ikon polos di header yang tidak jelas
  // artinya bagi staf). Tiap baris punya ikon, nama, dan keterangan singkat; yang tidak berlaku untuk status booking ini disembunyikan.
  type BookingAction = {
    key: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    title: string;
    hint: string;
    tone?: 'danger' | 'warning' | 'success';
    onPress: () => void;
  };

  const isOpenBooking = bookingStatus === 'pending' || bookingStatus === 'confirmed';
  const bookingActions: BookingAction[] = [
    isOpenBooking
      ? { key: 'assign', icon: 'people-outline', title: 'Tugaskan Installer & Pemantau', hint: 'Pilih installer yang mengerjakan dan pemantau booking ini', onPress: openAssignModal }
      : null,
    bookingStatus === 'confirmed'
      ? { key: 'intake', icon: 'camera-outline', title: 'Foto Penerimaan Kendaraan', hint: 'Foto kondisi kendaraan saat diterima di toko', onPress: () => setIntakeModalOpen(true) }
      : null,
    // Membuat SPK hanya selama booking dikerjakan. Booking selesai melihat SPK lewat tombol di Ringkasan, bukan menu Aksi.
    bookingStatus === 'confirmed' && (spkId || canCreateSpk)
      ? {
          key: 'spk',
          icon: 'document-text-outline',
          title: spkId ? 'Lihat SPK' : 'Buat SPK',
          hint: spkId ? 'Buka SPK booking ini' : 'Buat SPK untuk booking ini',
          onPress: () => (
            spkId
              ? router.push(`/staff/spks/${spkId}` as never)
              : router.push({ pathname: '/staff/spks/create', params: { bookingId: String(bookingId) } } as never)
          ),
        }
      : null,
    bookingStatus === 'confirmed'
      ? { key: 'stage', icon: 'flag-outline', title: 'Update Tahap Pekerjaan', hint: 'Tandai tahap yang sedang atau sudah dikerjakan', onPress: () => { setStagePickerOpen(true); setMarkedStage(null); } }
      : null,
    bookingStatus === 'confirmed'
      ? { key: 'qc', icon: 'checkmark-done-outline', title: 'Quality Check', hint: 'Periksa hasil pekerjaan sebelum kendaraan diserahkan', onPress: () => setQcModalOpen(true) }
      : null,
    bookingStatus === 'confirmed' && currentStage === 'qc'
      ? { key: 'handover', icon: 'key-outline', title: 'Serah Terima Unit', hint: 'Serahkan kendaraan ke pelanggan', onPress: () => setHandoverModalOpen(true) }
      : null,
    isOpenBooking && !!waInfo
      ? { key: 'whatsapp', icon: 'logo-whatsapp', title: 'Kabari Pelanggan via WhatsApp', hint: 'Kirim kabar ke pelanggan memakai template pesan', tone: 'success' as const, onPress: () => setWaModalOpen(true) }
      : null,
    bookingStatus === 'confirmed' && canDecideCancellation && !workStarted && !!bookingDate && bookingDate <= toLocalDateString(new Date())
      ? { key: 'noshow', icon: 'person-remove-outline', title: 'Tandai Pelanggan Tidak Datang', hint: 'Pelanggan tidak datang pada tanggal booking', tone: 'warning' as const, onPress: markNoShow }
      : null,
    isOpenBooking
      ? { key: 'cancel', icon: 'close-circle-outline', title: 'Batalkan Booking', hint: 'Batalkan booking ini dan beri tahu pelanggan', tone: 'danger' as const, onPress: openCancelModal }
      : null,
  ].filter((a): a is BookingAction => a !== null);

  // Sheet ditutup dulu, aksinya dijalankan sesudah animasi tutup selesai supaya modal berikutnya (QC, WhatsApp, dst.) tidak bertabrakan.
  const runBookingAction = (action: BookingAction) => {
    setActionsOpen(false);
    setTimeout(action.onPress, 300);
  };

  const isDarkTheme = theme === 'dark';

  const HeaderBar = () => (
    <View style={styles.header}>
      {router.canGoBack() ? (
        <Pressable onPress={() => router.back()} style={styles.sideButton} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
      ) : (
        <View style={styles.sideSpacer} />
      )}
      <View style={styles.headerCenter}>
        <Text style={styles.headerName} numberOfLines={1}>{vehicleInfo?.plate ?? summary?.customerName ?? 'Detail Booking'}</Text>
        {summary?.bookingNumber ? <Text style={styles.headerSub} numberOfLines={1}>{summary.bookingNumber}</Text> : null}
      </View>
      {canManageProgress && bookingActions.length > 0 ? (
        <Pressable onPress={() => setActionsOpen(true)} style={styles.actionsButton} accessibilityRole="button" accessibilityLabel="Buka menu aksi booking">
          <Ionicons name="ellipsis-horizontal-circle-outline" size={20} color={isDarkTheme ? '#ff6b8f' : '#cc1042'} />
          <Text style={styles.actionsButtonText}>Aksi</Text>
        </Pressable>
      ) : (
        <View style={styles.sideSpacer} />
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

  if (installerOnly) {
    const b = installerBooking;
    const installerStatus = b ? DETAIL_STATUS[b.status] : null;
    const vehicleLine = b ? [b.vehicle_brand, b.vehicle_model, b.vehicle_variant].filter(Boolean).join(' ') : '';
    const productLabel = (p?: { sku: string | null; name: string | null } | null) => (p ? [p.name, p.sku ? `(${p.sku})` : null].filter(Boolean).join(' ') : '');
    const productValue = b
      ? [productLabel(b.film_product), ...(b.film_products ?? []).map((e) => `${productLabel(e.film_product)}${e.position ? ` — ${e.position}` : ''}`)].filter(Boolean).join('\n')
      : '';
    const stageName = (key?: string | null) => [...KACA_FILM_STAGES, ...PPF_STAGES, ...SHARED_STAGES].find((st) => st.key === key)?.label ?? null;
    const stageValue = b ? [stageName(b.current_stage), stageName(b.secondary_stage)].filter(Boolean).join(' · ') : '';
    const rows: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string }[] = b ? [
      { icon: 'construct-outline', label: 'Layanan', value: withPpfArea(b.service_type, b.product_ppf, b.ppf_exterior, b.ppf_interior) ?? '-' },
      { icon: 'cube-outline', label: 'Produk', value: productValue || 'Belum dipilih' },
      { icon: 'flag-outline', label: 'Tahap saat ini', value: stageValue || 'Belum dimulai' },
      { icon: 'calendar-outline', label: 'Jadwal', value: b.preferred_date ? formatDate(b.preferred_date.slice(0, 10)) + (b.preferred_time ? `, ${b.preferred_time}` : '') : '-' },
      { icon: 'time-outline', label: 'Lama pengerjaan', value: b.duration_days ? `${b.duration_days} hari kerja` : '-' },
      { icon: 'storefront-outline', label: 'Toko', value: b.store?.name ?? '-' },
      { icon: 'person-outline', label: 'Pelanggan', value: b.customer?.name ?? '-' },
      { icon: 'people-outline', label: 'Installer', value: b.installers && b.installers.length ? b.installers.map((i) => i.name).join(', ') : '-' },
    ] : [];

    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
        <View style={styles.header}>
          {router.canGoBack() ? (
            <Pressable onPress={() => router.back()} style={styles.sideButton} accessibilityRole="button" accessibilityLabel="Kembali">
              <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
            </Pressable>
          ) : (
            <View style={styles.sideButton} />
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>Detail Pengerjaan</Text>
          <View style={styles.sideButton} />
        </View>
        {installerError ? (
          <View style={styles.centerState}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
            <Text style={styles.loadErrorText}>{installerError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => { fetchInstallerBooking(); }}>
              <Text style={styles.retryText}>Coba Lagi</Text>
            </Pressable>
          </View>
        ) : !b ? (
          <View style={styles.centerState}><ActivityIndicator color={colors.accent} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 40, gap: 14 }} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.heroTop}>
                <View style={styles.heroTitleWrap}>
                  <Text style={styles.heroPlate} numberOfLines={1}>{b.vehicle_plate ?? b.customer?.name ?? 'Detail Pengerjaan'}</Text>
                  {vehicleLine ? <Text style={styles.heroSub} numberOfLines={1}>{vehicleLine}</Text> : null}
                </View>
                {installerStatus ? (
                  <View style={[styles.statusBadge, { backgroundColor: colors[installerStatus.bg] }]}>
                    <Text style={[styles.statusBadgeText, { color: colors[installerStatus.color] }]}>{installerStatus.label}</Text>
                  </View>
                ) : null}
              </View>
              {b.vehicle_color || b.vehicle_size ? (
                <View style={styles.chipRow}>
                  {b.vehicle_color ? <View style={styles.chip}><Text style={styles.chipText}>{b.vehicle_color}</Text></View> : null}
                  {b.vehicle_size ? <View style={styles.chip}><Text style={styles.chipText}>Ukuran {b.vehicle_size.toUpperCase()}</Text></View> : null}
                </View>
              ) : null}
              <View style={styles.divider} />
              {rows.map((row) => (
                <View key={row.label} style={styles.infoRow}>
                  <View style={styles.infoIcon}>
                    <Ionicons name={row.icon} size={16} color={colors.accent} />
                  </View>
                  <View style={styles.infoBody}>
                    <Text style={styles.infoLabel}>{row.label}</Text>
                    <Text style={styles.infoValue}>{row.value}</Text>
                  </View>
                </View>
              ))}
            </View>
            {b.notes ? (
              <View style={styles.installerCard}>
                <Text style={styles.installerLabel}>Catatan</Text>
                <Text style={styles.installerValue}>{b.notes}</Text>
              </View>
            ) : null}
            {(b.status === 'confirmed' || b.status === 'completed') && (b.spk || canCreateSpk) && (
              <Pressable
                style={styles.retryBtn}
                onPress={() => (
                  b.spk
                    ? router.push(`/staff/spks/${b.spk.id}` as never)
                    : router.push({ pathname: '/staff/spks/create', params: { bookingId: String(bookingId) } } as never)
                )}
                accessibilityRole="button"
              >
                <Text style={[styles.retryText, { textAlign: 'center' }]}>{b.spk ? 'Lihat SPK' : 'Buat SPK'}</Text>
              </Pressable>
            )}
            {(b.status === 'confirmed' || b.status === 'completed') && !b.spk && !canCreateSpk && (
              <Text style={styles.installerHint}>SPK belum dibuat.</Text>
            )}
            <Text style={styles.installerHint}>Chat dengan customer dipegang leader installer. Hubungi leader installer kalau ada kendala di lapangan.</Text>
          </ScrollView>
        )}
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
          {!isInstaller && (
            <Pressable style={styles.retryBtn} onPress={() => { fetchMessages(); }}>
              <Text style={styles.retryText}>Coba Lagi</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ─── Tampilan ringkasan (tab "Ringkasan") ───────────────────────────────────
  const statusTone = bookingStatus ? DETAIL_STATUS[bookingStatus] : null;
  const canChangeSchedule = canManageProgress && !loading && !workStarted && (bookingStatus === 'pending' || bookingStatus === 'confirmed');
  const scheduleLabel = bookingDate
    ? parseDate(bookingDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      + (summary?.time ? `, ${summary.time}` : '')
      + (summary?.durationDays && summary.durationDays > 1 ? ` · ${summary.durationDays} hari` : '')
    : null;
  // Pesan terbaru di indeks 0 (daftar chat terbalik).
  const chatItems = [...messages].reverse();
  const vehicleSub = vehicleInfo ? [vehicleInfo.label, vehicleInfo.color].filter(Boolean).join(' · ') : '';

  // Kartu "perlu tindakan": satu hal per kartu, dengan tombolnya sendiri, bukan lagi bilah-bilah yang bertumpuk di atas chat.
  const renderAttention = (
    key: string,
    tone: 'warning' | 'danger',
    icon: React.ComponentProps<typeof Ionicons>['name'],
    text: string,
    buttons?: React.ReactNode
  ) => {
    const color = tone === 'danger' ? colors.danger : colors.warning;

    return (
      <View key={key} style={[styles.attentionCard, { backgroundColor: tone === 'danger' ? colors.dangerBg : colors.warningBg }]}>
        <View style={styles.attentionHead}>
          <Ionicons name={icon} size={18} color={color} />
          <Text style={[styles.attentionText, { color }]}>{text}</Text>
        </View>
        {buttons ? <View style={styles.attentionButtons}>{buttons}</View> : null}
      </View>
    );
  };

  const infoRow = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string, content: React.ReactNode) => (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={16} color={colors.accent} />
      </View>
      <View style={styles.infoBody}>
        <Text style={styles.infoLabel}>{label}</Text>
        {content}
      </View>
    </View>
  );


  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <HeaderBar />

      <View style={styles.tabBar}>
        {([['ringkasan', 'Ringkasan'], ['chat', 'Chat']] as const).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tabItem, activeTab === key && styles.tabItemActive]}
            onPress={() => setActiveTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === key }}
          >
            <Text style={[styles.tabText, activeTab === key && styles.tabTextActive]}>{label}</Text>
            {key === 'chat' && hasUnreadChat ? <View style={styles.tabDot} /> : null}
          </Pressable>
        ))}
      </View>

      {activeTab === 'ringkasan' ? (
        <ScrollView contentContainerStyle={styles.summaryContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {canManageProgress && bookingStatus === 'pending' && renderAttention(
            'pending', 'warning', 'time-outline', 'Booking ini menunggu konfirmasi.',
            <Pressable style={styles.attentionBtn} onPress={openConfirmModal} accessibilityRole="button">
              <Text style={styles.attentionBtnText}>Konfirmasi Booking</Text>
            </Pressable>
          )}

          {canManageProgress && cancellationRequest && bookingStatus === 'confirmed' && renderAttention(
            'cancel-request', 'danger', 'close-circle-outline',
            `Pelanggan mengajukan pembatalan — "${cancellationRequest.reason}"${canDecideCancellation ? '' : ' (menunggu keputusan Store Manager)'}`,
            canDecideCancellation ? (
              <>
                <Pressable style={[styles.attentionBtn, { backgroundColor: colors.danger }, deciding && styles.attentionBtnDisabled]} disabled={deciding} onPress={approveCancellationRequest}>
                  <Text style={styles.attentionBtnText}>Setujui</Text>
                </Pressable>
                <Pressable
                  style={[styles.attentionBtn, styles.attentionBtnGhost, deciding && styles.attentionBtnDisabled]}
                  disabled={deciding}
                  onPress={() => { setCancelRejectNote(''); setCancelRejectOpen(true); }}
                >
                  <Text style={[styles.attentionBtnText, { color: colors.textPrimary }]}>Tolak</Text>
                </Pressable>
              </>
            ) : undefined
          )}

          {bookingStatus === 'cancelled' && cancelInfo && renderAttention(
            'cancelled', 'danger', 'close-circle-outline',
            `Dibatalkan${cancelInfo.by === 'customer' ? ' oleh customer' : cancelInfo.by === 'staff' ? ' oleh staff' : cancelInfo.by === 'system' ? ' otomatis' : ''}${cancelInfo.reason ? ` — "${cancelInfo.reason}"` : ''}`
          )}

          {canManageProgress && !loading && !workStarted && rescheduleRequest && (bookingStatus === 'pending' || bookingStatus === 'confirmed') && renderAttention(
            'reschedule', 'warning', 'swap-horizontal-outline',
            `Pelanggan mengajukan jadwal ulang ke ${parseDate(rescheduleRequest.requested_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}${rescheduleRequest.reason ? ` — "${rescheduleRequest.reason}"` : ''}`,
            <>
              <Pressable style={[styles.attentionBtn, deciding && styles.attentionBtnDisabled]} disabled={deciding} onPress={() => decideReschedule('approve')}>
                <Text style={styles.attentionBtnText}>Setujui</Text>
              </Pressable>
              <Pressable style={[styles.attentionBtn, { backgroundColor: colors.danger }, deciding && styles.attentionBtnDisabled]} disabled={deciding} onPress={() => decideReschedule('reject')}>
                <Text style={styles.attentionBtnText}>Tolak</Text>
              </Pressable>
            </>
          )}

          <View style={styles.card}>
            <View style={styles.heroTop}>
              <View style={styles.heroTitleWrap}>
                <Text style={styles.heroPlate} numberOfLines={1}>{vehicleInfo?.plate ?? summary?.customerName ?? 'Detail Booking'}</Text>
                {vehicleSub ? <Text style={styles.heroSub} numberOfLines={1}>{vehicleSub}</Text> : null}
              </View>
              {statusTone ? (
                <View style={[styles.statusBadge, { backgroundColor: colors[statusTone.bg] }]}>
                  <Text style={[styles.statusBadgeText, { color: colors[statusTone.color] }]}>{statusTone.label}</Text>
                </View>
              ) : null}
            </View>
            {summary?.bookingNumber ? <Text style={styles.heroNumber}>{summary.bookingNumber}</Text> : null}
            <View style={styles.divider} />

            {infoRow('construct-outline', 'Layanan', <Text style={styles.infoValue}>{summary?.service ?? '-'}</Text>)}
            {infoRow('calendar-outline', 'Jadwal', (
              <>
                <Text style={styles.infoValue}>{scheduleLabel ?? '-'}</Text>
                {canChangeSchedule ? (
                  <Pressable onPress={openReschedule} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.infoLink}>Ubah jadwal</Text>
                  </Pressable>
                ) : null}
              </>
            ))}
            {infoRow('storefront-outline', 'Toko', <Text style={styles.infoValue}>{summary?.storeName ?? '-'}</Text>)}
            {infoRow('person-outline', 'Pelanggan', (
              <>
                <Text style={styles.infoValue}>{summary?.customerName ?? '-'}</Text>
                {summary?.customerPhone || (isOpenBooking && waInfo) ? (
                  <View style={styles.contactRow}>
                    {summary?.customerPhone ? (
                      <Pressable style={styles.contactBtn} onPress={() => Linking.openURL(`tel:${summary.customerPhone}`)} accessibilityRole="button" accessibilityLabel="Telepon pelanggan">
                        <Ionicons name="call-outline" size={15} color={colors.accent} />
                        <Text style={styles.contactBtnText}>Telepon</Text>
                      </Pressable>
                    ) : null}
                    {isOpenBooking && waInfo ? (
                      <Pressable style={styles.contactBtn} onPress={() => setWaModalOpen(true)} accessibilityRole="button" accessibilityLabel="Kabari pelanggan via WhatsApp">
                        <Ionicons name="logo-whatsapp" size={15} color={colors.success} />
                        <Text style={styles.contactBtnText}>WhatsApp</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </>
            ))}
          </View>

          {(bookingStatus === 'confirmed' || bookingStatus === 'completed') && (
            <View style={styles.card}>
              <View style={styles.cardHeadRow}>
                <Text style={styles.cardTitle}>Progres pengerjaan</Text>
                {canMarkStage && bookingStatus === 'confirmed' ? (
                  <Pressable style={styles.smallBtn} onPress={() => { setStagePickerOpen(true); setMarkedStage(null); }} accessibilityRole="button">
                    <Text style={styles.smallBtnText}>Update tahap</Text>
                  </Pressable>
                ) : null}
              </View>
              {workStarted ? (
                <>
                  <Text style={styles.progressSummary}>{stageSummaryLabel}</Text>
                  {productKacaFilm && (
                    <View style={styles.progressRow}>
                      {bothProducts && <Text style={styles.progressLabel}>Kaca Film</Text>}
                      <View style={styles.stageStrip}>{renderStageDots(KACA_FILM_STAGES, kacaFilmColumnValue)}</View>
                    </View>
                  )}
                  {productPpf && (
                    <View style={styles.progressRow}>
                      {bothProducts && <Text style={styles.progressLabel}>PPF</Text>}
                      <View style={styles.stageStrip}>{renderStageDots(PPF_STAGES, ppfColumnValue)}</View>
                    </View>
                  )}
                  <View style={styles.progressRow}>
                    {bothProducts && <View style={styles.progressLabel} />}
                    <View style={styles.stageStrip}>{renderStageDots(SHARED_STAGES, currentStage)}</View>
                  </View>
                </>
              ) : (
                <Text style={styles.mutedText}>Belum ada tahap yang ditandai.</Text>
              )}
            </View>
          )}

          {bookingStatus === 'completed' && !!spkId && (
            <Pressable
              style={styles.reminderBtn}
              onPress={() => router.push(`/staff/spks/${spkId}` as never)}
              accessibilityRole="button"
            >
              <Ionicons name="document-text-outline" size={20} color={colors.accent} />
              <Text style={styles.reminderBtnText}>Lihat SPK</Text>
            </Pressable>
          )}

          {bookingStatus === 'completed' && currentStage === 'completed' && (
            <Pressable
              style={[styles.reminderBtn, sendingReminder && { opacity: 0.6 }]}
              onPress={handleSendMaintenanceReminder}
              disabled={sendingReminder}
              accessibilityRole="button"
            >
              {sendingReminder ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.accent} />
              )}
              <Text style={styles.reminderBtnText}>Kirim Pengingat Maintenance</Text>
            </Pressable>
          )}


        </ScrollView>
      ) : (
        <View style={styles.flex} onLayout={onChatBoxLayout}>
      <View style={[styles.flex, { marginBottom: chatLift }]}>
          <FlatList
            ref={listRef}
            // SEBELUMNYA tidak ada style={flex:1} di sini — list menyusut
            // mengikuti tinggi kontennya sendiri (kayak ScrollView tanpa
            // flex), bukan mengisi sisa ruang di KeyboardAvoidingView.
            // Akibatnya kolom input "naik" nempel tepat di bawah pesan
            // terakhir, bukan di bawah layar, begitu pesannya sedikit.
            // Ditemukan & diperbaiki 2026-08-28.
            style={styles.flex}
            data={chatItems}
            keyExtractor={(item) => String(item.id)}
            inverted
            contentContainerStyle={styles.messageList}
            // Daftar ini inverted: React Native sudah membalik kembali komponen kosongnya, jadi tidak perlu scaleY manual (sebelumnya teksnya terbalik).
            ListEmptyComponent={
              <View style={styles.chatEmpty}>
                <View style={styles.chatEmptyIcon}>
                  <Ionicons name="chatbubble-ellipses-outline" size={34} color={colors.textMuted} />
                </View>
                <Text style={styles.chatEmptyText}>Belum ada pesan</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              // Daftar terbalik: item berikutnya (index + 1) adalah pesan yang lebih lama. Pemisah hari tampil di atas pesan pertama tiap hari.
              const older = chatItems[index + 1];
              const showDay = !older || chatDayKey(older.created_at) !== chatDayKey(item.created_at);

              return (
                <View>
                  {showDay ? (
                    <View style={styles.daySep}>
                      <Text style={styles.daySepText}>{chatDayLabel(item.created_at)}</Text>
                    </View>
                  ) : null}
                  <MessageBubble message={item} onPhotoPress={setViewerImage} styles={styles} />
                </View>
              );
            }}
          />

          {/* +spacing.sm ekstra di kedua kondisi — SEBELUMNYA di HP dengan
              navigasi 3-tombol (insets.bottom = 0), kolom input cuma
              dikasih jarak spacing.sm dari tepi layar, jadi kelihatan
              terlalu mepet ke navigation bar Android. Ditemukan &
              diperbaiki 2026-08-28. */}
          <View style={[styles.inputBar, { paddingBottom: (insets.bottom > 0 ? insets.bottom : spacing.sm) + spacing.sm }]}>
            <View style={styles.composer}>
              {canMarkStage && (bookingStatus === 'confirmed' || bookingStatus === 'completed') && (
                <Pressable style={styles.attachBtn} onPress={() => handlePickPhoto()} disabled={sending} accessibilityRole="button" accessibilityLabel="Lampirkan foto" accessibilityState={{ disabled: sending }}>
                  <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />
                </Pressable>
              )}
              <AutoGrowTextInput
                style={styles.input}
                minHeight={42}
                maxHeight={112}
                placeholder="Tulis pesan…"
                placeholderTextColor={colors.textMuted}
                value={input}
                onChangeText={setInput}
              />
              <Pressable
                style={[styles.sendBtn, !(input.trim() && !sending) && styles.sendBtnIdle]}
                onPress={handleSendText}
                disabled={sending || !input.trim()}
                accessibilityRole="button"
                accessibilityLabel="Kirim pesan"
                accessibilityState={{ disabled: sending || !input.trim(), busy: sending }}
              >
                {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="arrow-up" size={20} color="#ffffff" />}
              </Pressable>
            </View>
          </View>
        </View>
        </View>
      )}

      {/* Lightbox — tap foto untuk lihat ukuran penuh */}
      {canManageProgress && (
        <Modal visible={actionsOpen} transparent animationType="slide" onRequestClose={() => setActionsOpen(false)}>
          <View style={styles.actionsBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setActionsOpen(false)} accessibilityLabel="Tutup" />
            <View style={styles.actionsSheet}>
              <View style={styles.actionsHandle} />
              <Text style={styles.actionsTitle}>Aksi Booking</Text>
              <ScrollView style={[styles.actionsList, { maxHeight: Math.max(240, windowHeight * 0.65) }]} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                {bookingActions.map((action) => {
                  const toneColor = action.tone === 'danger' ? colors.danger : action.tone === 'warning' ? colors.warning : action.tone === 'success' ? colors.success : colors.accent;
                  const toneBg = action.tone === 'danger' ? colors.dangerBg : action.tone === 'warning' ? colors.warningBg : action.tone === 'success' ? colors.successBg : colors.accentSoft;

                  return (
                    <Pressable key={action.key} style={styles.actionRow} onPress={() => runBookingAction(action)} accessibilityRole="button" accessibilityLabel={action.title}>
                      <View style={[styles.actionIconWrap, { backgroundColor: toneBg }]}>
                        <Ionicons name={action.icon} size={22} color={toneColor} />
                      </View>
                      <View style={styles.actionText}>
                        <Text style={[styles.actionTitle, action.tone === 'danger' && { color: colors.danger }]}>{action.title}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable style={styles.actionsClose} onPress={() => setActionsOpen(false)} accessibilityRole="button">
                <Text style={styles.actionsCloseText}>Tutup</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* Penampil foto chat: dua jari untuk memperbesar, geser saat sudah besar, ketuk dua kali untuk membesarkan atau mengembalikan, dan tombol
          Simpan untuk mengunduh ke galeri. */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)} statusBarTranslucent>
        <View style={styles.viewerBackdrop}>
          {viewerImage ? (
            <View style={styles.viewerStage}>
              <PinchZoomImage uri={viewerImage} centered />
            </View>
          ) : null}

          <View style={[styles.viewerBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable style={styles.viewerBtn} onPress={() => setViewerImage(null)} accessibilityRole="button" accessibilityLabel="Tutup foto">
              <Ionicons name="close" size={24} color="#ffffff" />
            </Pressable>
            <Pressable style={[styles.viewerBtn, styles.viewerSave]} onPress={saveViewerImage} disabled={savingViewerImage} accessibilityRole="button" accessibilityLabel="Simpan foto ke galeri">
              {savingViewerImage ? <ActivityIndicator size="small" color="#ffffff" /> : <Ionicons name="download-outline" size={22} color="#ffffff" />}
              <Text style={styles.viewerSaveText}>Simpan</Text>
            </Pressable>
          </View>

        </View>
      </Modal>

      {/* Selesaikan booking — murni konfirmasi, tidak ada input apa pun.
          Nominal transaksi, kode referral partner, & voucher SUDAH TIDAK
          diinput di sini lagi — semua diproses staff terpisah lewat
          Filament (aksi "Proses Referral" di BookingResource untuk
          nominal+referral, VoucherResource untuk assign kode voucher
          fisik), tidak lagi berhubungan dengan penyelesaian booking di
          mobile app. */}
      <QualityCheckModal visible={qcModalOpen} bookingId={bookingId} onClose={() => setQcModalOpen(false)} onSubmitted={(passed) => { if (passed) markQcStageAfterPass(); }} />
      <WhatsAppTemplatesModal visible={waModalOpen} info={waInfo} onClose={() => setWaModalOpen(false)} />
      <IntakePhotosModal visible={intakeModalOpen} bookingId={bookingId} onClose={() => setIntakeModalOpen(false)} />
      <HandoverModal
        visible={handoverModalOpen}
        bookingId={bookingId}
        onClose={() => setHandoverModalOpen(false)}
        onProceed={currentStage === 'qc' ? () => { setHandoverModalOpen(false); setTimeout(() => setCompleteModalOpen(true), 300); } : undefined}
      />

      <Modal visible={completeModalOpen} transparent animationType="fade" onRequestClose={() => setCompleteModalOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Selesaikan Booking</Text>
            <Text style={styles.completeSubtitle}>
              Tandai booking ini selesai? Poin referral dan voucher diproses terpisah di panel.
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

      {/* Pop-up "Ingin upload foto tahap?" — muncul begitu tahap ditandai.
          Diminta user 2026-08-28 sebagai pengganti ikon kamera per baris. */}
      <Modal visible={photoPromptOpen} transparent animationType="slide" onRequestClose={skipStagePhotos}>
        <View style={styles.asgBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={skipStagePhotos} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={styles.asgHandle} />

            <View style={styles.cxHead}>
              <View style={[styles.cxIcon, { backgroundColor: colors.successBg }]}>
                <Ionicons name="checkmark-circle-outline" size={26} color={colors.success} />
              </View>
              <View style={styles.cxHeadText}>
                <Text style={styles.asgTitle}>Tahap Ditandai</Text>
                <Text style={styles.cxBooking} numberOfLines={1}>
                  {[...KACA_FILM_STAGES, ...PPF_STAGES, ...SHARED_STAGES].find((st) => st.key === photoPromptStage)?.label ?? 'Tambahkan foto progres?'}
                </Text>
              </View>
            </View>

            <View style={styles.ppRow}>
              <Pressable style={styles.ppTile} onPress={addStagePhotoFromCamera} accessibilityRole="button" accessibilityLabel="Ambil foto">
                <View style={[styles.ppIcon, { backgroundColor: colors.accent }]}>
                  <Ionicons name="camera-outline" size={24} color="#ffffff" />
                </View>
                <Text style={styles.ppTileText}>Ambil Foto</Text>
              </Pressable>
              <Pressable style={styles.ppTile} onPress={addStagePhotosFromGallery} accessibilityRole="button" accessibilityLabel="Pilih dari galeri">
                <View style={styles.ppIcon}>
                  <Ionicons name="images-outline" size={24} color={colors.textPrimary} />
                </View>
                <Text style={styles.ppTileText}>Dari Galeri</Text>
              </Pressable>
            </View>

            <Pressable style={styles.ppSkip} onPress={skipStagePhotos} accessibilityRole="button">
              <Text style={styles.ppSkipText}>Lewati</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Preview foto tahap sebelum dikirim — bisa tambah lebih banyak
          (loop balik ke pop-up sumber) atau buang satu-satu sebelum
          benar-benar kirim ke chat. */}
      <Modal visible={photoPreviewOpen} transparent animationType="fade" onRequestClose={() => setPhotoPreviewOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Foto Tahap ({pendingStagePhotos.length})</Text>
            <Text style={styles.completeSubtitle}>
              Cek foto yang akan dikirim — ketuk × untuk buang, atau tambah lagi dari galeri/kamera.
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {pendingStagePhotos.map((photo, i) => (
                  <View key={photo.uri + i} style={styles.stagePhotoPreviewItem}>
                    <Image source={{ uri: photo.uri }} style={styles.stagePhotoPreviewImage} />
                    <Pressable style={styles.stagePhotoPreviewRemove} onPress={() => removePendingStagePhoto(i)}>
                      <Ionicons name="close" size={14} color="#ffffff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable style={[styles.completeBtn, styles.completeBtnCancel, { flex: 1, flexDirection: 'row' }]} onPress={addStagePhotosFromGallery}>
                <Ionicons name="images-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.completeBtnCancelText}>  Galeri</Text>
              </Pressable>
              <Pressable style={[styles.completeBtn, styles.completeBtnCancel, { flex: 1, flexDirection: 'row' }]} onPress={addStagePhotoFromCamera}>
                <Ionicons name="camera-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.completeBtnCancelText}>  Kamera</Text>
              </Pressable>
            </View>

            <View style={styles.completeActions}>
              <Pressable style={[styles.completeBtn, styles.completeBtnCancel]} onPress={skipStagePhotos} disabled={sendingStagePhotos}>
                <Text style={styles.completeBtnCancelText}>Batal</Text>
              </Pressable>
              <Pressable
                style={[styles.completeBtn, styles.completeBtnConfirm]}
                onPress={sendStagePhotos}
                disabled={sendingStagePhotos || pendingStagePhotos.length === 0}
              >
                {sendingStagePhotos ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.completeBtnConfirmText}>Kirim ({pendingStagePhotos.length})</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Konfirmasi/approve booking — staff WAJIB isi lama pengerjaan &
          kapasitas instalasi hari itu tiap kali approve (bukan setting
          tetap toko), dicek ke backend lewat POST .../confirm. */}
      <Modal visible={confirmModalOpen} transparent animationType="slide" onRequestClose={() => !confirming && setConfirmModalOpen(false)}>
        <View style={styles.asgBackdrop} onLayout={onSheetLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !confirming && setConfirmModalOpen(false)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { marginBottom: sheetLift, paddingBottom: 16 + (sheetKeyboard ? 0 : insets.bottom) }]}>
            <View style={styles.asgHandle} />

            <View style={styles.cxHead}>
              <View style={[styles.cxIcon, { backgroundColor: colors.successBg }]}>
                <Ionicons name="checkmark-circle-outline" size={26} color={colors.success} />
              </View>
              <View style={styles.cxHeadText}>
                <Text style={styles.asgTitle}>Konfirmasi Booking</Text>
                <Text style={styles.cxBooking} numberOfLines={1}>
                  {[vehicleInfo?.plate ?? summary?.customerName, summary?.bookingNumber].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>

            <ScrollView
              style={[styles.rsBody, { maxHeight: Math.max(220, windowHeight - insets.top - insets.bottom - sheetLift - 290) }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <View style={styles.cxLabelRow}>
                <Text style={styles.cxLabel}>Lama pengerjaan</Text>
              </View>
              <View style={styles.cfDuration}>
                <TextInput
                  style={styles.cfDurationInput}
                  keyboardType="number-pad"
                  value={confirmDurationDays}
                  onChangeText={setConfirmDurationDays}
                  onEndEditing={onDurationBlur}
                  placeholder="1"
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                  accessibilityLabel="Lama pengerjaan dalam hari"
                />
                <Text style={styles.cfDurationUnit}>hari</Text>
              </View>
              {parseInt(confirmDurationDays, 10) !== capacityLoadedForDuration && !loadingCapacity && (
                <Text style={styles.cfStale}>Daftar tanggal belum sesuai durasi ini dan akan dimuat ulang otomatis.</Text>
              )}

              <View style={[styles.cxLabelRow, { marginTop: 18 }]}>
                <Text style={styles.cxLabel}>Kapasitas instalasi</Text>
              </View>

              {loadingCapacity ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: spacing.md }} />
              ) : capacityRows.length === 0 ? (
                <Text style={styles.cfEmpty}>Belum ada tanggal termuat.</Text>
              ) : (
                <View style={styles.cfList}>
                  {capacityRows.map((row, index) => {
                    const full = !row.closed && row.used >= row.capacity;
                    const near = !row.closed && !full && row.used >= row.capacity - 1;
                    const tone = full ? colors.danger : near ? colors.warning : colors.success;
                    const toneBg = full ? colors.dangerBg : near ? colors.warningBg : colors.successBg;

                    return (
                      <View key={row.date} style={[styles.cfRow, index > 0 && styles.cfRowBorder]}>
                        <Text style={[styles.cfDate, row.closed && { color: colors.textMuted }]} numberOfLines={1}>{formatDate(row.date)}</Text>
                        {row.closed ? (
                          <Text style={styles.cfClosed}>Toko libur</Text>
                        ) : (
                          <View style={[styles.cfPill, { backgroundColor: toneBg }]}>
                            <Text style={[styles.cfPillText, { color: tone }]}>{full ? 'Penuh' : `${row.used}/${row.capacity} slot`}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </ScrollView>

            <View style={styles.asgFooter}>
              <Pressable style={[styles.asgBtn, styles.asgBtnCancel]} onPress={() => setConfirmModalOpen(false)} disabled={confirming} accessibilityRole="button">
                <Text style={styles.asgBtnCancelText}>Batal</Text>
              </Pressable>
              <Pressable style={[styles.asgBtn, styles.asgBtnSave, confirming && { opacity: 0.6 }]} onPress={submitConfirmBooking} disabled={confirming} accessibilityRole="button">
                {confirming ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.asgBtnSaveText}>Konfirmasi</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelRejectOpen} transparent animationType="fade" onRequestClose={() => setCancelRejectOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Tolak Pembatalan</Text>
            <Text style={styles.completeSubtitle}>Alasan akan dikirim ke customer lewat notifikasi.</Text>
            <View style={styles.confirmFieldRow}>
              <Text style={styles.confirmFieldLabel}>Alasan (wajib, dikirim ke customer)</Text>
              <TextInput
                style={[styles.confirmFieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
                accessibilityLabel="Alasan penolakan pembatalan"
                multiline
                value={cancelRejectNote}
                onChangeText={setCancelRejectNote}
                maxLength={500}
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.completeActions}>
              <Pressable style={[styles.completeBtn, styles.completeBtnCancel]} onPress={() => setCancelRejectOpen(false)} disabled={deciding}>
                <Text style={styles.completeBtnCancelText}>Tutup</Text>
              </Pressable>
              <Pressable style={[styles.completeBtn, { backgroundColor: colors.danger }]} onPress={submitRejectCancellation} disabled={deciding}>
                {deciding ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.completeBtnConfirmText}>Tolak Pengajuan</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={rejectOpen} transparent animationType="fade" onRequestClose={() => setRejectOpen(false)}>
        <View style={styles.completeBackdrop}>
          <View style={styles.completeSheet}>
            <Text style={styles.completeTitle}>Tolak Jadwal Ulang</Text>
            <Text style={styles.completeSubtitle}>Alasan akan dikirim ke customer lewat notifikasi.</Text>
            <View style={styles.confirmFieldRow}>
              <Text style={styles.confirmFieldLabel}>Alasan (wajib)</Text>
              <TextInput
                style={[styles.confirmFieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
                multiline
                value={rejectNote}
                onChangeText={setRejectNote}
                maxLength={500}
                placeholder="Mis. tanggal itu sudah penuh, pilih tanggal lain."
                placeholderTextColor={colors.textMuted}
              />
            </View>
            <View style={styles.completeActions}>
              <Pressable style={[styles.completeBtn, styles.completeBtnCancel]} onPress={() => setRejectOpen(false)} disabled={deciding}>
                <Text style={styles.completeBtnCancelText}>Tutup</Text>
              </Pressable>
              <Pressable style={[styles.completeBtn, { backgroundColor: colors.danger }]} onPress={submitRejectReschedule} disabled={deciding}>
                {deciding ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.completeBtnConfirmText}>Tolak Pengajuan</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={rescheduleOpen} transparent animationType="slide" onRequestClose={() => !rescheduling && setRescheduleOpen(false)}>
        <View style={styles.asgBackdrop} onLayout={onSheetLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !rescheduling && setRescheduleOpen(false)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { marginBottom: sheetLift, paddingBottom: 16 + (sheetKeyboard ? 0 : insets.bottom) }]}>
            <View style={styles.asgHandle} />

            <View style={styles.cxHead}>
              <View style={[styles.cxIcon, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="calendar-outline" size={26} color={isDarkTheme ? '#ff6b8f' : '#cc1042'} />
              </View>
              <View style={styles.cxHeadText}>
                <Text style={styles.asgTitle}>Ubah Jadwal</Text>
                {bookingDate ? (
                  <Text style={styles.cxBooking} numberOfLines={1}>
                    Saat ini {parseDate(bookingDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </Text>
                ) : null}
              </View>
            </View>

            <ScrollView style={[styles.rsBody, { maxHeight: Math.max(220, windowHeight - insets.top - insets.bottom - sheetLift - 290) }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {rescheduleLoadFailed ? (
                <View style={styles.rsNotice}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                  <Text style={styles.rsNoticeText}>Ketersediaan tanggal gagal dimuat. Tanggal tetap dicek server saat disimpan.</Text>
                  <Pressable onPress={loadRescheduleAvailability} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.rsRetry}>Coba Lagi</Text>
                  </Pressable>
                </View>
              ) : null}

              <DateGrid
                value={rescheduleDate}
                onChange={setRescheduleDate}
                disabledDates={rescheduleBlocked}
                currentDate={bookingDate}
                loading={rescheduleLoading}
                compact
                colors={colors}
              />

              {rescheduleDate ? (
                <View style={styles.rsPicked}>
                  <Ionicons name="checkmark-circle" size={18} color={isDarkTheme ? '#ff6b8f' : '#cc1042'} />
                  <Text style={styles.rsPickedText}>
                    Jadwal baru {parseDate(rescheduleDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </Text>
                </View>
              ) : null}

              <View style={styles.cxLabelRow}>
                <Text style={styles.cxLabel}>Alasan</Text>
                {bookingStatus === 'confirmed' ? (
                  <View style={styles.cxRequired}><Text style={styles.cxRequiredText}>WAJIB</Text></View>
                ) : null}
              </View>
              <TextInput
                style={styles.cxInput}
                accessibilityLabel="Alasan pindah jadwal"
                multiline
                value={rescheduleReason}
                onChangeText={setRescheduleReason}
                maxLength={500}
                placeholder="Mis. kapasitas toko penuh, unit pendukung belum siap"
                placeholderTextColor={colors.textMuted}
                textAlignVertical="top"
              />
            </ScrollView>

            <View style={styles.asgFooter}>
              <Pressable style={[styles.asgBtn, styles.asgBtnCancel]} onPress={() => setRescheduleOpen(false)} disabled={rescheduling} accessibilityRole="button">
                <Text style={styles.asgBtnCancelText}>Tutup</Text>
              </Pressable>
              <Pressable
                style={[styles.asgBtn, styles.asgBtnSave, (!rescheduleDate || rescheduling) && { opacity: 0.5 }]}
                onPress={submitReschedule}
                disabled={!rescheduleDate || rescheduling}
                accessibilityRole="button"
              >
                {rescheduling ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.asgBtnSaveText}>Simpan Jadwal</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Batalkan booking (pending/confirmed) — alasan opsional, dikirim
          ke customer via push notification (BookingObserver::updated()). */}
      {/* Update tahap pengerjaan: pop-up dari bawah, bukan kartu di tab Ringkasan. */}
      <Modal visible={canMarkStage && stagePickerOpen} transparent animationType="slide" onRequestClose={() => setStagePickerOpen(false)}>
        <View style={styles.asgBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setStagePickerOpen(false)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={styles.asgHandle} />
            <View style={styles.stgHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.asgTitle}>Update Tahap</Text>
                <Text style={styles.stgSub} numberOfLines={1}>
                  {[vehicleInfo?.plate ?? summary?.customerName, summary?.bookingNumber].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Pressable style={styles.stgClose} onPress={() => setStagePickerOpen(false)} accessibilityRole="button" accessibilityLabel="Tutup">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: Math.max(240, windowHeight - insets.top - insets.bottom - 190) }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
              {canDecideCancellation && bookingStatus === 'confirmed' && workStarted && (
                <Pressable
                  onPress={() => { setStagePickerOpen(false); setCorrectStageKey(null); setCorrectReason(''); setTimeout(() => setCorrectOpen(true), 300); }}
                  accessibilityRole="button"
                  accessibilityLabel="Koreksi tahap yang salah ditandai"
                >
                  <Text style={styles.stgLink}>Salah tandai? Koreksi tahap</Text>
                </Pressable>
              )}
              {markedStage && (
                <Pressable style={styles.smallBtn} onPress={() => handlePickPhoto()} disabled={sending} accessibilityRole="button" accessibilityLabel="Lampirkan foto tahap">
                  <Text style={styles.smallBtnText}>Tahap ditandai. Lampirkan foto</Text>
                </Pressable>
              )}

              {productKacaFilm && (
                <>
                  {bothProducts && <Text style={styles.stgGroup}>Kaca Film</Text>}
                  <View style={styles.stgCard}>{renderStagePickerRows(KACA_FILM_STAGES, kacaFilmColumnValue)}</View>
                </>
              )}

              {productPpf && (
                <>
                  {bothProducts && <Text style={styles.stgGroup}>PPF</Text>}
                  <View style={styles.stgCard}>{renderStagePickerRows(PPF_STAGES, ppfColumnValue)}</View>
                </>
              )}

              {(productKacaFilm || productPpf) && (
                <Text style={styles.stgGroup}>Tahap Akhir</Text>
              )}
              <View style={styles.stgCard}>{renderStagePickerRows(SHARED_STAGES, currentStage, readyForQc)}</View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelModalOpen} transparent animationType="slide" onRequestClose={() => !cancelling && setCancelModalOpen(false)}>
        <View style={styles.asgBackdrop} onLayout={onSheetLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !cancelling && setCancelModalOpen(false)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { marginBottom: sheetLift, paddingBottom: 16 + (sheetKeyboard ? 0 : insets.bottom) }]}>
            <View style={styles.asgHandle} />

            <View style={styles.cxHead}>
              <View style={styles.cxIcon}>
                <Ionicons name="close-circle-outline" size={26} color={colors.danger} />
              </View>
              <View style={styles.cxHeadText}>
                <Text style={styles.asgTitle}>Batalkan Booking</Text>
                <Text style={styles.cxBooking} numberOfLines={1}>
                  {[vehicleInfo?.plate ?? summary?.customerName, summary?.bookingNumber].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>

            <View style={styles.cxLabelRow}>
              <Text style={styles.cxLabel}>Alasan</Text>
              {bookingStatus === 'confirmed' ? (
                <View style={styles.cxRequired}><Text style={styles.cxRequiredText}>WAJIB</Text></View>
              ) : null}
            </View>
            <TextInput
              style={styles.cxInput}
              multiline
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Mis. customer minta jadwal ulang, salah input"
              placeholderTextColor={colors.textMuted}
              textAlignVertical="top"
            />
            <Text style={styles.cxHint}>Alasan ini dikirim ke pelanggan.</Text>

            <View style={styles.asgFooter}>
              <Pressable style={[styles.asgBtn, styles.asgBtnCancel]} onPress={() => setCancelModalOpen(false)} disabled={cancelling} accessibilityRole="button">
                <Text style={styles.asgBtnCancelText}>Tutup</Text>
              </Pressable>
              <Pressable style={[styles.asgBtn, { backgroundColor: colors.danger }, cancelling && { opacity: 0.6 }]} onPress={submitCancelBooking} disabled={cancelling} accessibilityRole="button">
                {cancelling ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.asgBtnSaveText}>Batalkan Booking</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Koreksi tahap (Store Manager/akses penuh): alasan wajib, tercatat di log, tanpa push ke customer. */}
      <Modal visible={correctOpen} transparent animationType="slide" onRequestClose={() => !correcting && setCorrectOpen(false)}>
        <View style={styles.asgBackdrop} onLayout={onSheetLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !correcting && setCorrectOpen(false)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { marginBottom: sheetLift, paddingBottom: 16 + (sheetKeyboard ? 0 : insets.bottom) }]}>
            <View style={styles.asgHandle} />

            <View style={styles.stgHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.asgTitle}>Koreksi Tahap</Text>
                <Text style={styles.stgSub} numberOfLines={2}>Pilih tahap yang benar.</Text>
              </View>
              <Pressable style={styles.stgClose} onPress={() => setCorrectOpen(false)} disabled={correcting} accessibilityRole="button" accessibilityLabel="Tutup">
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              style={[styles.rsBody, { maxHeight: Math.max(220, windowHeight - insets.top - insets.bottom - sheetLift - 330) }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <View style={styles.stgCard}>
                {[
                  ...(productKacaFilm ? KACA_FILM_STAGES : []),
                  ...(productPpf ? PPF_STAGES : []),
                  SHARED_STAGES[0],
                  { key: 'reset_main', label: bothProducts ? 'Belum mulai (Kaca Film)' : 'Belum mulai', icon: 'refresh-outline' as const },
                  ...(bothProducts ? [{ key: 'reset_secondary', label: 'Belum mulai (PPF)', icon: 'refresh-outline' as const }] : []),
                ].map((st, i, arr) => {
                  const on = correctStageKey === st.key;
                  return (
                    <Pressable
                      key={st.key}
                      style={[styles.stgRow, i < arr.length - 1 && styles.stgRowDivider]}
                      onPress={() => setCorrectStageKey(st.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                    >
                      <View style={[styles.stgIcon, on && styles.stgIconNow]}>
                        <Ionicons name={st.icon} size={17} color={on ? '#ffffff' : colors.textMuted} />
                      </View>
                      <Text style={[styles.stgLabel, { flex: 1 }, !on && styles.stgLabelMuted]}>{st.label}</Text>
                      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.accent : colors.borderStrong} />
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.cxLabelRow}>
                <Text style={styles.cxLabel}>Alasan koreksi</Text>
                <View style={styles.cxRequired}><Text style={styles.cxRequiredText}>WAJIB</Text></View>
              </View>
              <TextInput
                style={styles.cxInput}
                multiline
                value={correctReason}
                onChangeText={setCorrectReason}
                placeholder="Mis. salah ketuk, tahap sebenarnya masih pemanasan"
                placeholderTextColor={colors.textMuted}
                textAlignVertical="top"
              />
            </ScrollView>

            <View style={styles.asgFooter}>
              <Pressable style={[styles.asgBtn, styles.asgBtnCancel]} onPress={() => setCorrectOpen(false)} disabled={correcting} accessibilityRole="button">
                <Text style={styles.asgBtnCancelText}>Tutup</Text>
              </Pressable>
              <Pressable
                style={[styles.asgBtn, styles.asgBtnSave, (!correctStageKey || correcting) && { opacity: 0.45 }]}
                onPress={submitCorrectStage}
                disabled={!correctStageKey || correcting}
                accessibilityRole="button"
              >
                {correcting ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.asgBtnSaveText}>Koreksi</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Assign installer & direksi pemantau chat booking ini. */}
      <Modal visible={assignModalOpen} transparent animationType="slide" onRequestClose={() => setAssignModalOpen(false)}>
        <View style={styles.asgBackdrop} onLayout={onSheetLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !assignSaving && setAssignModalOpen(false)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={styles.asgHandle} />
            <Text style={styles.asgTitle}>Assignment Booking</Text>
            <Text style={styles.asgSubtitle}>Pilih installer yang mengerjakan dan direksi yang memantau chat dan progres booking ini.</Text>

            {assignLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.xl }} />
            ) : (
              <View style={styles.asgFields}>
                {([
                  { key: 'installer' as const, icon: 'construct-outline' as const, label: 'Installer', options: installerOptions, selected: selectedInstallerIds, empty: 'Belum ada akun installer di toko ini.' },
                  { key: 'watcher' as const, icon: 'eye-outline' as const, label: 'Direksi pemantau', options: direksiOptions, selected: selectedWatcherIds, empty: 'Belum ada akun direksi terdaftar.' },
                ]).map((f) => {
                  const names = f.options.filter((o) => f.selected.includes(o.id)).map((o) => o.name);
                  const summary = names.length === 0 ? 'Belum dipilih' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;

                  return (
                    <Pressable
                      key={f.key}
                      style={styles.asgField}
                      onPress={() => { setAssignQuery(''); setAssignPicker(f.key); }}
                      disabled={f.options.length === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`${f.label}: ${summary}. Ketuk untuk memilih`}
                    >
                      <View style={styles.asgSectionIcon}>
                        <Ionicons name={f.icon} size={16} color={isDarkTheme ? '#ff6b8f' : '#cc1042'} />
                      </View>
                      <View style={styles.asgFieldText}>
                        <Text style={styles.asgFieldLabel}>{f.label}</Text>
                        <Text style={[styles.asgFieldValue, names.length === 0 && { color: colors.textMuted, fontWeight: '500' }]} numberOfLines={1}>
                          {f.options.length === 0 ? f.empty : summary}
                        </Text>
                      </View>
                      {names.length > 0 ? <Text style={styles.asgCount}>{names.length}</Text> : null}
                      <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                    </Pressable>
                  );
                })}

                {selectedInstallerIds.length > 0 ? (
                  <View style={styles.asgChat}>
                    <Text style={styles.asgChatTitle}>Akses chat booking</Text>
                    {installerOptions.filter((o) => selectedInstallerIds.includes(o.id)).map((o, i, arr) => (
                      <View key={o.id} style={[styles.asgChatRow, i < arr.length - 1 && styles.asgChatDivider]}>
                        <Text style={styles.asgChatName} numberOfLines={1}>{o.name}</Text>
                        <Switch
                          value={chatInstallerIds.includes(o.id)}
                          onValueChange={(on) => setChatInstallerIds((prev) => (on ? [...prev.filter((x) => x !== o.id), o.id] : prev.filter((x) => x !== o.id)))}
                          trackColor={{ false: isDarkTheme ? '#3a3a44' : '#d9d9e0', true: colors.accent }}
                          thumbColor="#ffffff"
                          accessibilityLabel={`Izinkan ${o.name} mengakses chat booking`}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.asgFooter}>
              <Pressable style={[styles.asgBtn, styles.asgBtnCancel]} onPress={() => setAssignModalOpen(false)} disabled={assignSaving} accessibilityRole="button">
                <Text style={styles.asgBtnCancelText}>Batal</Text>
              </Pressable>
              <Pressable style={[styles.asgBtn, styles.asgBtnSave, (assignSaving || assignLoading) && { opacity: 0.6 }]} onPress={handleSaveAssignment} disabled={assignSaving || assignLoading} accessibilityRole="button">
                {assignSaving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.asgBtnSaveText}>Simpan</Text>}
              </Pressable>
            </View>
          </View>
        </View>

        {/* Lembar pilihan installer / direksi: daftar bisa digulir dan dicari, jadi tinggi lembar Assignment tetap pendek. */}
      <Modal visible={assignPicker !== null} transparent animationType="slide" onRequestClose={() => setAssignPicker(null)}>
        <View style={styles.asgBackdrop} onLayout={onSheetLayout}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAssignPicker(null)} accessibilityLabel="Tutup" />
          <View style={[styles.asgSheet, { paddingBottom: 16 + insets.bottom }]}>
            <View style={styles.asgHandle} />
            <View style={styles.asgPickerHead}>
              <Text style={styles.asgTitle}>{assignPicker === 'installer' ? 'Pilih installer' : 'Pilih direksi'}</Text>
              <Pressable onPress={() => setAssignPicker(null)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.asgDone}>Selesai</Text>
              </Pressable>
            </View>
            {(assignPicker === 'installer' ? installerOptions : direksiOptions).length > 6 ? (
              <TextInput
                style={styles.asgSearch}
                value={assignQuery}
                onChangeText={setAssignQuery}
                placeholder="Cari nama"
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            ) : null}
            <ScrollView style={[styles.asgPickerList, { maxHeight: Math.max(200, windowHeight * 0.5) }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <View style={styles.asgList}>
                {(assignPicker === 'installer' ? installerOptions : direksiOptions)
                  .filter((opt) => opt.name.toLowerCase().includes(assignQuery.trim().toLowerCase()))
                  .map((opt, index) => {
                    const isInstallerPick = assignPicker === 'installer';
                    const checked = (isInstallerPick ? selectedInstallerIds : selectedWatcherIds).includes(opt.id);

                    return (
                      <Pressable
                        key={opt.id}
                        style={[styles.asgRow, index > 0 && styles.asgRowBorder, checked && styles.asgRowActive]}
                        onPress={() => (isInstallerPick ? toggleInstaller(opt.id) : toggleWatcher(opt.id))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                      >
                        <View style={[styles.asgAvatar, checked && styles.asgAvatarOn]}>
                          <Text style={[styles.asgAvatarText, checked && { color: '#ffffff' }]}>{opt.name.trim().charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={styles.asgPerson}>
                          <Text style={styles.asgName} numberOfLines={1}>{opt.name}</Text>
                          {isInstallerPick && opt.level ? <Text style={styles.asgLevel}>{TECHNICIAN_LEVEL_LABEL[opt.level] ?? opt.level}</Text> : null}
                        </View>
                        <View style={[styles.asgCheck, checked && styles.asgCheckOn]}>
                          {checked ? <Ionicons name="checkmark" size={15} color="#ffffff" /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
          <PhotoGrid photoUrls={message.photo_urls} onPhotoPress={onPhotoPress} styles={styles} flush={!message.body} />
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
      <View style={[styles.bubble, isAdmin ? styles.bubbleAdmin : styles.bubbleCustomer, message.photo_urls.length > 0 && !message.body && styles.bubbleMedia]}>
        {message.photo_urls.length > 0 && (
          <PhotoGrid photoUrls={message.photo_urls} onPhotoPress={onPhotoPress} styles={styles} flush={!message.body} />
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
  flush,
}: {
  photoUrls: string[];
  onPhotoPress: (url: string) => void;
  styles: ReturnType<typeof createStyles>;
  // Pesan hanya berisi foto: tanpa jarak bawah, supaya bingkai gelembung tipis dan rata.
  flush?: boolean;
}) {
  if (photoUrls.length === 1) {
    return (
      <Pressable onPress={() => onPhotoPress(photoUrls[0])}>
        <SinglePhoto url={photoUrls[0]} style={[styles.bubblePhoto, flush && styles.bubblePhotoFlush]} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.photoGrid, flush && styles.photoGridFlush]}>
      {photoUrls.map((url) => (
        <Pressable key={url} onPress={() => onPhotoPress(url)}>
          <Image source={{ uri: url }} style={styles.photoGridItem} />
        </Pressable>
      ))}
    </View>
  );
}

// Foto tunggal di gelembung chat mengikuti rasio asli gambar (lebar tetap, tinggi menyesuaikan), tidak dipotong ke kotak 4:3.
// Rasio ekstrem dibatasi supaya gelembung tidak terlalu pendek atau memanjang.
function SinglePhoto({ url, style }: { url: string; style: React.ComponentProps<typeof Image>['style'] }) {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    Image.getSize(
      url,
      (w, h) => { if (alive && w > 0 && h > 0) setRatio(w / h); },
      () => { /* gagal: tetap pakai rasio bawaan */ },
    );

    return () => { alive = false; };
  }, [url]);

  const clamped = ratio === null ? 4 / 3 : Math.min(Math.max(ratio, 0.6), 2.2);

  return <Image source={{ uri: url }} style={[style, { height: undefined, aspectRatio: clamped }]} resizeMode={ratio !== null && clamped === ratio ? 'stretch' : 'cover'} />;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Beranda, Absensi, Izin & Cuti, dan formulir SPK: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
  container: { flex: 1, backgroundColor: screenBg },
  flex: { flex: 1 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  loadErrorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.pill },
  retryText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
  installerCard: { gap: spacing.xs, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
  installerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  installerLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  installerValue: { fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textPrimary, fontWeight: '500' },
  installerHint: { fontSize: 12.5, fontWeight: '500', lineHeight: 18, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
  sideButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
  sideSpacer: { width: 44, height: 44 },
  actionsButton: { minWidth: 44, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 22, backgroundColor: colors.accentSoft },
  actionsButtonText: { fontSize: fontSize.sm, fontWeight: '800', color: accentText },
  actionsBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  actionsSheet: { backgroundColor: isDark ? colors.bg : '#ffffff', borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: 20, paddingTop: 12, paddingBottom: spacing.lg, maxHeight: '85%' },
  actionsHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 14 },
  actionsTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary, marginBottom: 6 },
  actionsList: { flexGrow: 0, flexShrink: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 20 },
  actionIconWrap: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1 },
  actionTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  actionsClose: { marginTop: spacing.sm, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: radius.pill, backgroundColor: chip },
  actionsCloseText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: colors.textPrimary },
  vehicleBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  vehicleBarText: { flex: 1, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },

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
  rescheduleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rescheduleLinkText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent },
  rescheduleChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rescheduleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  rescheduleChipText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
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
    width: 60, fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
  },
  stageStrip: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.xs,
  },
  stageCol: { flex: 1, alignItems: 'center', gap: 6 },
  stageColTop: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stageLineHidden: { backgroundColor: 'transparent' },
  stageName: { paddingHorizontal: 2, fontSize: 11, lineHeight: 14, fontWeight: '600', textAlign: 'center', color: colors.textMuted },
  stageNameActive: { color: colors.textPrimary },
  stageDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: chip, alignItems: 'center', justifyContent: 'center' },
  stageDotActive: { backgroundColor: colors.accent },
  stageLine: { flex: 1, height: 3, borderRadius: 2, backgroundColor: chip },
  stageLineActive: { backgroundColor: colors.accent },

  stagePicker: { backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  stagePickerTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  stagePickerGroupLabel: { fontSize: 11.5, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm },
  stagePickerHint: { fontSize: 12.5, fontWeight: '600', color: accentText, marginBottom: 4 },
  stagePickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stagePickerLabel: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '600', color: colors.textPrimary },
  stagePickerBtn: { paddingHorizontal: 16, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent },
  stagePickerBtnText: { fontSize: 13, fontWeight: '800', color: '#ffffff' },
  stagePickerBtnDisabled: { backgroundColor: chip, opacity: 0.6 },
  stagePhotoPreviewItem: { width: 90, height: 90, borderRadius: radius.md, overflow: 'hidden' },
  stagePhotoPreviewImage: { width: '100%', height: '100%' },
  stagePhotoPreviewRemove: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },

  messageList: { paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  // alignItems per sisi WAJIB diisi eksplisit — default React Native
  // 'stretch' bikin semua child (bubble, label nama, jam) menyesuaikan
  // lebar sibling TERLEBAR (label nama pengirim, mis. "Admin Toko Test
  // Toko"), jadi bubble teks pendek (mis. "Test") ikut melebar kosong.
  // Ditemukan & diperbaiki 2026-08-28.
  bubbleWrap: { maxWidth: '80%', gap: 3 },
  bubbleWrapLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubbleWrapRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { borderRadius: 22, paddingHorizontal: 15, paddingVertical: 11, overflow: 'hidden' },
  bubbleAdmin: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  bubbleCustomer: { backgroundColor: card, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: line },
  bubbleText: { fontSize: fontSize.sm + 1, color: colors.textPrimary, lineHeight: 21 },
  bubbleTextAdmin: { color: '#ffffff' },
  bubblePhoto: { width: 220, height: 165, borderRadius: 18, marginBottom: 6 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, width: 220, marginBottom: 6 },
  photoGridItem: { width: 108, height: 108, borderRadius: 16 },
  messageTime: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  senderNameLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, alignSelf: 'flex-end', marginRight: 4 },
  stageMessageTime: { fontSize: 11.5, fontWeight: '500', color: colors.textMuted, alignSelf: 'center', fontVariant: ['tabular-nums'] },

  stageMessageWrap: { alignSelf: 'center', alignItems: 'center', gap: 4, marginVertical: spacing.xs },
  stageMessage: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  stageMessageIcon: { marginTop: 1 },
  stageMessageText: { fontSize: 12.5, fontWeight: '800', color: accentText, lineHeight: 16, includeFontPadding: false },
  viewerBackdrop: { flex: 1, backgroundColor: '#000000' },
  viewerImage: { width: '100%', height: '80%' },
  viewerCloseBtn: { position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  inputBar: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: screenBg },
  attachBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 42, maxHeight: 112, paddingHorizontal: 6, paddingVertical: 10, textAlignVertical: 'center', fontSize: fontSize.sm + 1, lineHeight: 21, color: colors.textPrimary },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },

  // ─── Rombak tampilan detail (2026-11-02): tab Ringkasan/Chat, kartu bertitik jelas ───
  headerCenter: { flex: 1, gap: 2 },
  headerName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },
  headerSub: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  tabBar: { flexDirection: 'row', gap: 6, marginHorizontal: 20, marginTop: 2, padding: 5, borderRadius: radius.pill, backgroundColor: chip },
  tabItem: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.pill },
  tabItemActive: { backgroundColor: card, ...shadow },
  tabText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textMuted },
  tabTextActive: { color: colors.textPrimary, fontWeight: '800' },
  tabDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },

  summaryContent: { paddingHorizontal: 20, paddingTop: 14, gap: 14, paddingBottom: spacing.xxl },
  card: { gap: 14, padding: 18, borderRadius: 26, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
  mutedText: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  divider: { height: 1, backgroundColor: line },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  heroTitleWrap: { flex: 1 },
  heroPlate: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
  heroSub: { fontSize: fontSize.sm + 1, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  heroNumber: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  statusBadgeText: { fontSize: 12, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: chip },
  chipText: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoIcon: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  infoBody: { flex: 1, gap: 2 },
  infoLabel: { fontSize: 12.5, color: colors.textMuted, fontWeight: '600' },
  infoValue: { fontSize: fontSize.sm + 1, color: colors.textPrimary, fontWeight: '700', lineHeight: 22 },
  infoLink: { fontSize: 13, color: accentText, fontWeight: '800', marginTop: 2 },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: chip },
  contactBtnText: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  attentionCard: { borderRadius: 24, padding: 18, gap: 14 },
  attentionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  attentionText: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '700', lineHeight: 22 },
  attentionButtons: { flexDirection: 'row', gap: spacing.sm },
  attentionBtn: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: spacing.md },
  attentionBtnGhost: { backgroundColor: card },
  attentionBtnDisabled: { opacity: 0.6 },
  attentionBtnText: { color: '#ffffff', fontWeight: '800', fontSize: fontSize.sm + 1 },
  progressSummary: { fontSize: fontSize.base + 1, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
  progressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  progressLabel: { width: 64, paddingTop: 9, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted, textTransform: 'uppercase' },
  smallBtn: { alignSelf: 'flex-start', paddingHorizontal: 16, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  smallBtnText: { fontSize: 13, fontWeight: '800', color: accentText },
  completeBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  completeSheet: { width: '100%', backgroundColor: isDark ? colors.surface : '#ffffff', borderRadius: 28, padding: 22, gap: spacing.xs },
  completeTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
  completeSubtitle: { fontSize: 13, fontWeight: '500', color: colors.textMuted, lineHeight: 19, marginBottom: spacing.sm },
  completeLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 6 },
  completeHint: { fontSize: 12, color: colors.accent, marginTop: 4, lineHeight: 15 },
  completeInput: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, fontSize: fontSize.sm + 1, color: colors.textPrimary, backgroundColor: chip },
  confirmFieldRow: { marginTop: spacing.sm },
  confirmFieldLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  confirmFieldInput: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, fontSize: fontSize.sm + 1, color: colors.textPrimary, backgroundColor: chip },
  completeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  completeBtn: { flex: 1, height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  completeBtnCancel: { backgroundColor: chip },
  // Tombol lebar penuh untuk daftar menurun (kolom): tinggi minimum dan padding, tanpa flex, supaya tidak runtuh.
  photoPromptBtn: {
    alignSelf: 'stretch', minHeight: 48, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.pill,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  completeBtnCancelText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textSecondary },
  completeBtnConfirm: { backgroundColor: colors.accent },
  completeBtnConfirmText: { fontSize: fontSize.sm + 1, fontWeight: '800', color: '#ffffff' },
  assignOptionList: { borderRadius: 20, overflow: 'hidden', backgroundColor: chip },
  assignOptionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 16, paddingVertical: 12 },
  assignOptionRowActive: { backgroundColor: colors.accentSoft },
  assignOptionText: { fontSize: fontSize.sm, color: colors.textPrimary, flex: 1 },
  assignEmptyText: {
    fontSize: fontSize.xs, color: colors.textMuted, padding: spacing.md, textAlign: 'center',
  },

  // ─── Assignment booking (lembar bawah) ───
  asgBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  asgSheet: { maxHeight: '88%', paddingHorizontal: 20, paddingTop: 12, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: isDark ? colors.bg : '#ffffff' },
  asgHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14, backgroundColor: colors.borderStrong },
  asgTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
  asgSubtitle: { marginTop: 4, marginBottom: 14, fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textMuted },
  asgBody: { flexGrow: 0, flexShrink: 1 },
  asgSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  asgSectionIcon: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  asgSectionTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
  asgCount: { fontSize: 12.5, fontWeight: '800', color: accentText },
  asgList: { borderRadius: 22, overflow: 'hidden', backgroundColor: chip },
  asgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  asgRowBorder: { borderTopWidth: 1, borderTopColor: isDark ? colors.border : '#e3e3ea' },
  asgRowActive: { backgroundColor: colors.accentSoft },
  asgAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: card },
  asgAvatarOn: { backgroundColor: colors.accent },
  asgAvatarText: { fontSize: fontSize.base, fontWeight: '800', color: accentText },
  asgPerson: { flex: 1, gap: 1 },
  asgName: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
  asgLevel: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  asgCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: isDark ? '#4b4b57' : '#cfcfd8', alignItems: 'center', justifyContent: 'center' },
  asgCheckOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  asgEmpty: { padding: 18, fontSize: 13, fontWeight: '500', textAlign: 'center', color: colors.textMuted },
  asgFooter: { flexDirection: 'row', gap: 12, paddingTop: 16 },
  asgBtn: { flex: 1, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  asgBtnCancel: { backgroundColor: chip },
  asgBtnCancelText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textSecondary },
  asgBtnSave: { backgroundColor: colors.accent },
  asgBtnSaveText: { fontSize: fontSize.sm + 1, fontWeight: '800', color: '#ffffff' },
  asgFields: { gap: 10 },
  asgChat: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: chip },
  asgChatTitle: { paddingTop: 8, paddingBottom: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
  asgChatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  asgChatDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  asgChatName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  asgField: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: chip },
  asgFieldText: { flex: 1, gap: 2 },
  asgFieldLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textMuted },
  asgFieldValue: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
  asgPickerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  asgDone: { fontSize: fontSize.sm + 1, fontWeight: '800', color: accentText },
  asgSearch: { height: 46, paddingHorizontal: 18, marginBottom: 12, borderRadius: 23, backgroundColor: chip, fontSize: fontSize.sm + 1, color: colors.textPrimary },
  asgPickerList: { flexGrow: 0, flexShrink: 1 },
  cxHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  cxHeadText: { flex: 1, gap: 2 },
  cxIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerBg },
  cxBooking: { fontSize: 13, fontWeight: '500', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  cxLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cxLabel: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
  cxRequired: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.dangerBg },
  cxRequiredText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: colors.danger },
  cxInput: { minHeight: 104, maxHeight: 160, padding: 14, borderRadius: 20, backgroundColor: chip, fontSize: fontSize.sm + 1, lineHeight: 22, color: colors.textPrimary },
  cxHint: { marginTop: 8, fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
  rsBody: { flexGrow: 0, flexShrink: 1 },
  rsNotice: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: 14, marginBottom: 12, borderRadius: 18, backgroundColor: colors.warningBg },
  rsNoticeText: { flex: 1, fontSize: 12.5, fontWeight: '600', lineHeight: 18, color: colors.warning },
  rsRetry: { fontSize: 12.5, fontWeight: '800', color: accentText },
  rsPicked: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, backgroundColor: colors.accentSoft },
  rsPickedText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: accentText },
  cfDuration: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 72, borderRadius: 22, backgroundColor: chip },
  cfDurationInput: { minWidth: 56, padding: 0, textAlign: 'center', fontSize: 36, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  cfDurationUnit: { fontSize: fontSize.base, fontWeight: '700', color: colors.textMuted, marginTop: 8 },
  cfStale: { marginTop: 8, fontSize: 12.5, fontWeight: '600', lineHeight: 18, color: colors.warning },
  cfEmpty: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginVertical: spacing.sm },
  cfList: { borderRadius: 22, overflow: 'hidden', backgroundColor: chip },
  cfRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  cfRowBorder: { borderTopWidth: 1, borderTopColor: isDark ? colors.border : '#e3e3ea' },
  cfDate: { flex: 1, fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textPrimary },
  cfClosed: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
  cfPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  cfPillText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // paddingHorizontal/Vertical milik .bubble mengalahkan `padding`, jadi harus ditimpa dengan nama yang sama.
  bubbleMedia: { paddingHorizontal: 3, paddingVertical: 3 },
  bubblePhotoFlush: { marginBottom: 0, borderRadius: 19 },
  photoGridFlush: { marginBottom: 0 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, padding: 5, borderRadius: 30, backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
  sendBtnIdle: { opacity: 0.35 },
  daySep: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6, marginBottom: 12, borderRadius: radius.pill, backgroundColor: chip },
  daySepText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chatEmpty: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  chatEmptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
  chatEmptyText: { fontSize: fontSize.sm + 1, fontWeight: '600', color: colors.textMuted },
  viewerStage: { flex: 1 },
  viewerBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  viewerBtn: { height: 44, minWidth: 44, borderRadius: 22, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)' },
  viewerSave: { paddingHorizontal: 16 },
  viewerSaveText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: '#ffffff' },
  stgHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  stgSub: { marginTop: 2, fontSize: 13.5, fontWeight: '500', color: colors.textMuted },
  stgClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
  stgGroup: { marginTop: 14, marginBottom: 8, marginLeft: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
  stgCard: { borderRadius: 22, paddingHorizontal: 14, backgroundColor: isDark ? colors.surface : '#f5f5f8' },
  stgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  stgRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  stgIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
  stgIconNow: { backgroundColor: colors.accent },
  stgIconDone: { backgroundColor: '#22a06b' },
  stgLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  stgLabelMuted: { color: colors.textMuted, fontWeight: '600' },
  stgNow: { marginTop: 1, fontSize: 12.5, fontWeight: '600', color: accentText },
  stgHint: { marginTop: 8, marginHorizontal: 4, fontSize: 12.5, fontWeight: '500', color: colors.textMuted },
  stgBtn: { height: 38, paddingHorizontal: 18, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  stgBtnText: { fontSize: 13.5, fontWeight: '800', color: '#ffffff' },
  stgLink: { alignSelf: 'flex-start', marginBottom: 4, fontSize: 13.5, fontWeight: '700', color: accentText },
  ppRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  ppTile: { flex: 1, alignItems: 'center', gap: 12, paddingVertical: 22, borderRadius: 26, backgroundColor: isDark ? colors.surface : '#f5f5f8' },
  ppIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
  ppTileText: { fontSize: 14.5, fontWeight: '700', color: colors.textPrimary },
  ppSkip: { height: 52, marginTop: 8, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ppSkipText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textSecondary },
  reminderBtn: { height: 54, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  reminderBtnText: { fontSize: fontSize.sm + 1, fontWeight: '800', color: colors.accent },
  });
}
