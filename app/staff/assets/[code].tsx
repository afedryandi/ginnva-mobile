import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { Button } from '@/components/ui/Button';
import DateField, { toDateKey, todayKey } from '@/components/ui/DateField';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticSuccess, hapticError } from '@/lib/haptics';
import { useStaffAuth } from '@/lib/staff-auth-context';

type AssetStatus = 'aktif' | 'diperbaiki' | 'rusak' | 'dijual' | 'hilang';

const STATUS_LABEL: Record<AssetStatus, string> = {
  aktif: 'Aktif Dipakai',
  diperbaiki: 'Sedang Diperbaiki',
  rusak: 'Rusak',
  dijual: 'Dijual',
  hilang: 'Hilang',
};

interface Store {
  id: number;
  name: string;
}

interface ActivityLogEntry {
  id: number;
  event: 'created' | 'updated' | 'deleted' | 'maintenance' | null;
  description: string;
  causer: { id: number; name: string } | null;
  created_at: string;
}

interface AssetData {
  id: number;
  asset_tag: string;
  name: string;
  category: string | null;
  status: AssetStatus;
  assignee: { id: number; name: string } | null;
  store: Store | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  notes: string | null;
  next_maintenance_date: string | null;
  maintenance_interval_days: number | null;
  last_maintenance_date: string | null;
  disposed_at: string | null;
  activities: ActivityLogEntry[];
}

interface Holder {
  id: number;
  name: string;
}

interface TransferEntry {
  id: number;
  from_user: string | null;
  to_user: string | null;
  from_store: string | null;
  to_store: string | null;
  condition: 'baik' | 'perlu_perhatian' | 'rusak';
  reason: string;
  performed_by: string | null;
  created_at: string;
}

type Condition = TransferEntry['condition'];

const CONDITION_LABEL: Record<Condition, string> = {
  baik: 'Baik',
  perlu_perhatian: 'Perlu Perhatian',
  rusak: 'Rusak',
};

interface ShowResponse {
  data: AssetData;
  stores: Store[];
  can_modify?: boolean;
  transfers?: TransferEntry[];
  holders?: Holder[];
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Tanggal (YYYY-MM-DD) ditambah n hari, untuk jadwal servis berikutnya.
function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

function eventLabel(event: ActivityLogEntry['event']): string {
  if (event === 'created') return 'Dibuat';
  if (event === 'updated') return 'Diubah';
  if (event === 'deleted') return 'Dihapus';
  if (event === 'maintenance') return 'Servis';
  return '—';
}

function statusColor(status: AssetStatus, colors: typeof darkColors) {
  switch (status) {
    case 'aktif':
      return colors.success;
    case 'diperbaiki':
      return colors.warning;
    default:
      return colors.danger;
  }
}

export default function AssetDetailScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { staff } = useStaffAuth();
  // Sama seperti User::isFullAccess() di backend — cuma super_admin/direksi
  // yang boleh pindahkan aset antar toko (lihat AssetController::update()).
  const isFullAccess = staff?.role === 'super_admin' || staff?.role === 'direksi';

  const [asset, setAsset] = useState<AssetData | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Akun yang hanya boleh melihat aset tidak diberi tombol ubah/serah terima (server juga menolak).
  const [canModify, setCanModify] = useState(false);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [transfers, setTransfers] = useState<TransferEntry[]>([]);

  // Serah Terima: pemegang dan (akses penuh) toko tujuan, kondisi fisik, dan alasan.
  const [trOpen, setTrOpen] = useState(false);
  const [trUserId, setTrUserId] = useState<number | null>(null);
  const [trStoreId, setTrStoreId] = useState<number | null>(null);
  const [trCondition, setTrCondition] = useState<Condition | null>(null);
  const [trReason, setTrReason] = useState('');
  const [trSubmitting, setTrSubmitting] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);

  // Catat Servis: tanggal servis dan jadwal berikutnya (terisi dari interval aset bila ada; boleh dikosongkan).
  const [mtOpen, setMtOpen] = useState(false);
  const [mtDate, setMtDate] = useState('');
  const [mtNext, setMtNext] = useState('');
  const [mtNote, setMtNote] = useState('');
  const [mtSubmitting, setMtSubmitting] = useState(false);
  const [mtError, setMtError] = useState<string | null>(null);  const [editing, setEditing] = useState(false);
  const [formStatus, setFormStatus] = useState<AssetStatus>('aktif');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchAsset = useCallback(() => {
    setError(null);
    return staffApiFetch<ShowResponse>(`/api/staff/assets/${encodeURIComponent(code)}`)
      .then((res) => {
        setAsset(res.data);
        setStores(res.stores);
        setCanModify(res.can_modify === true);
        setHolders(res.holders ?? []);
        setTransfers(res.transfers ?? []);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setError('Akun ini belum diberi akses ke menu Aset Tetap. Minta admin mencentang menu Aset Tetap di Hak Akses.');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Aset tidak ditemukan atau koneksi bermasalah.');
      });
  }, [code]);

  useEffect(() => {
    setLoading(true);
    fetchAsset().finally(() => setLoading(false));
  }, [fetchAsset]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAsset();
    setRefreshing(false);
  }, [fetchAsset]);

  const openEdit = () => {
    if (!asset) return;
    setFormStatus(asset.status);
    // Catatan lama ditampilkan supaya mengubahnya disengaja, bukan menimpa tanpa sadar.
    setFormNotes(asset.notes ?? '');
    setFormError(null);
    setEditing(true);
  };

  const handleSubmit = () => {
    setSubmitting(true);
    setFormError(null);

    staffApiFetch<{ message: string; data: AssetData }>(`/api/staff/assets/${encodeURIComponent(code)}/update`, {
      method: 'POST',
      body: JSON.stringify({
        status: formStatus,
        notes: formNotes.trim(),
      }),
    })
      .then((res) => {
        hapticSuccess();
        setAsset(res.data);
        setEditing(false);
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setFormError(err instanceof ApiError ? err.message : 'Gagal menyimpan perubahan. Periksa koneksi internet.');
      })
      .finally(() => setSubmitting(false));
  };

  const openTransfer = () => {
    if (!asset) return;
    setTrUserId(asset.assignee?.id ?? null);
    setTrStoreId(null);
    setTrCondition(null);
    setTrReason('');
    setTrError(null);
    setTrOpen(true);
  };

  const openMaintenance = () => {
    if (!asset) return;
    const today = todayKey();
    setMtDate(today);
    setMtNext(asset.maintenance_interval_days ? addDays(today, asset.maintenance_interval_days) : '');
    setMtNote('');
    setMtError(null);
    setMtOpen(true);
  };

  const handleMaintenance = () => {
    if (!mtDate) {
      setMtError('Pilih tanggal servis.');
      return;
    }
    if (mtNext && mtNext < mtDate) {
      setMtError('Jadwal berikutnya tidak boleh lebih awal dari tanggal servis.');
      return;
    }

    setMtSubmitting(true);
    setMtError(null);

    staffApiFetch<{ message: string; data: AssetData }>(`/api/staff/assets/${encodeURIComponent(code)}/maintenance`, {
      method: 'POST',
      body: JSON.stringify({ date: mtDate, next_date: mtNext || null, note: mtNote.trim() || undefined }),
    })
      .then((res) => {
        hapticSuccess();
        setAsset(res.data);
        setMtOpen(false);
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setMtError(err instanceof ApiError ? err.message : 'Gagal mencatat servis. Periksa koneksi internet.');
      })
      .finally(() => setMtSubmitting(false));
  };

  const handleTransfer = () => {
    if (!trCondition) {
      setTrError('Pilih kondisi fisik aset saat ini.');
      return;
    }
    if (trReason.trim() === '') {
      setTrError('Isi alasan serah terima (mis. rotasi tugas, pindah toko).');
      return;
    }

    setTrSubmitting(true);
    setTrError(null);

    staffApiFetch<{ message: string; data: AssetData; transfers: TransferEntry[] }>(`/api/staff/assets/${encodeURIComponent(code)}/transfer`, {
      method: 'POST',
      body: JSON.stringify({
        to_user_id: trUserId,
        to_store_id: trStoreId,
        condition_at_transfer: trCondition,
        reason: trReason.trim(),
      }),
    })
      .then((res) => {
        hapticSuccess();
        setAsset(res.data);
        setTransfers(res.transfers);
        setTrOpen(false);
        Alert.alert('Berhasil', res.message);
      })
      .catch((err) => {
        hapticError();
        setTrError(err instanceof ApiError ? err.message : 'Gagal mencatat serah terima. Periksa koneksi internet.');
      })
      .finally(() => setTrSubmitting(false));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Detail Aset Tetap</Text>
        <Pressable onPress={() => router.replace('/staff/assets/scan' as never)} style={styles.sideButton}>
          <Ionicons name="scan-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.centerStateText}>Memuat data aset...</Text>
        </View>
      ) : error || !asset ? (
        <View style={styles.centerState}>
          <Ionicons name="alert-circle" size={32} color={colors.danger} />
          <Text style={styles.centerStateText}>{error ?? 'Aset tidak ditemukan.'}</Text>
          <Pressable style={styles.retryButton} onPress={() => router.replace('/staff/assets/scan' as never)}>
            <Text style={styles.retryText}>Scan Ulang</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        >
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.codeText}>{asset.asset_tag}</Text>
                <Text style={styles.nameText}>{asset.name}</Text>
                {asset.category && <Text style={styles.categoryText}>{asset.category}</Text>}
              </View>
              {/* Pill+ikon — disatukan dengan pola status di modul lain
                  (sebelumnya cuma teks berwarna tanpa ikon). */}
              <View style={[styles.statusBadge, { backgroundColor: statusColor(asset.status, colors) + '22' }]}>
                <Ionicons
                  name={asset.status === 'aktif' ? 'checkmark-circle' : 'alert-circle'}
                  size={13}
                  color={statusColor(asset.status, colors)}
                />
                <Text style={[styles.statusText, { color: statusColor(asset.status, colors) }]}>
                  {STATUS_LABEL[asset.status]}
                </Text>
              </View>
            </View>

            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoText}>{asset.assignee?.name ?? 'Belum ditentukan pemegangnya'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoText}>{asset.store?.name ?? 'Kantor Pusat / belum ditentukan'}</Text>
            </View>
            {asset.next_maintenance_date && (
              <View style={styles.infoRow}>
                <Ionicons name="build-outline" size={16} color={new Date(asset.next_maintenance_date) < new Date(new Date().toDateString()) ? colors.danger : colors.textMuted} />
                <Text style={[styles.infoText, new Date(asset.next_maintenance_date) < new Date(new Date().toDateString()) && { color: colors.danger }]}>
                  Maintenance berikutnya: {formatDate(asset.next_maintenance_date)}
                </Text>
              </View>
            )}
            {(asset.last_maintenance_date || asset.maintenance_interval_days) && (
              <View style={styles.infoRow}>
                <Ionicons name="construct-outline" size={16} color={colors.textMuted} />
                <Text style={styles.infoText}>
                  {asset.last_maintenance_date ? `Servis terakhir: ${formatDate(asset.last_maintenance_date)}` : 'Belum pernah dicatat servis'}
                  {asset.maintenance_interval_days ? ` · tiap ${asset.maintenance_interval_days} hari` : ''}
                </Text>
              </View>
            )}
            {asset.notes && (
              <View style={styles.infoRow}>
                <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
                <Text style={styles.infoText}>{asset.notes}</Text>
              </View>
            )}
            {/* SEBELUMNYA data ini sudah dikirim backend tapi tidak
                pernah ditampilkan — staff tidak pernah tahu kapan/berapa
                harga beli aset walau datanya sudah nyampai ke app. */}
            {(asset.purchase_date || asset.purchase_cost) && (
              <View style={styles.infoRow}>
                <Ionicons name="cash-outline" size={16} color={colors.textMuted} />
                <Text style={styles.infoText}>
                  {asset.purchase_cost ? `Rp ${parseFloat(asset.purchase_cost).toLocaleString('id-ID')}` : 'Harga tidak diketahui'}
                  {asset.purchase_date ? ` — dibeli ${formatDate(asset.purchase_date)}` : ''}
                </Text>
              </View>
            )}
          </View>

          {editing ? (
            <View style={styles.card}>
              <Text style={styles.formTitle}>Ubah Status & Catatan</Text>

              <Text style={styles.fieldLabel}>Status</Text>
              <View style={styles.chipRow}>
                {(Object.keys(STATUS_LABEL) as AssetStatus[])
                  // "Dijual" hanya lewat Lepas Aset di panel (supaya jurnalnya tercatat); tampil hanya bila aset memang sudah berstatus itu.
                  .filter((s) => s !== 'dijual' || asset.status === 'dijual')
                  .map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.chip, formStatus === s && styles.chipActive]}
                    onPress={() => setFormStatus(s)}
                  >
                    <Text style={[styles.chipText, formStatus === s && styles.chipTextActive]}>
                      {STATUS_LABEL[s]}
                    </Text>
                  </Pressable>
                ))}
              </View>


              <Text style={styles.fieldLabel}>Catatan</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. alasan rusak/diperbaiki"
                placeholderTextColor={colors.textMuted}
                value={formNotes}
                onChangeText={setFormNotes}
              />

              {formError && <Text style={styles.errorText}>{formError}</Text>}

              <View style={styles.formActions}>
                <Pressable style={styles.cancelButton} onPress={() => setEditing(false)} disabled={submitting}>
                  <Text style={styles.cancelButtonText}>Batal</Text>
                </Pressable>
                <Button label={submitting ? 'Menyimpan...' : 'Simpan'} onPress={handleSubmit} loading={submitting} style={{ flex: 1 }} />
              </View>
            </View>
          ) : trOpen ? (
            <View style={styles.card}>
              <Text style={styles.formTitle}>Serah Terima</Text>
              <Text style={styles.helperInline}>
                Dicatat sebagai riwayat serah terima: siapa menyerahkan ke siapa, kondisi fisik, dan alasannya.
              </Text>

              <Text style={styles.fieldLabel}>Diserahkan ke</Text>
              <View style={styles.chipRow}>
                <Pressable style={[styles.chip, trUserId === null && styles.chipActive]} onPress={() => setTrUserId(null)}>
                  <Text style={[styles.chipText, trUserId === null && styles.chipTextActive]}>Tanpa pemegang</Text>
                </Pressable>
                {holders.map((h) => (
                  <Pressable key={h.id} style={[styles.chip, trUserId === h.id && styles.chipActive]} onPress={() => setTrUserId(h.id)}>
                    <Text style={[styles.chipText, trUserId === h.id && styles.chipTextActive]}>{h.name}</Text>
                  </Pressable>
                ))}
              </View>

              {isFullAccess && (
                <>
                  <Text style={styles.fieldLabel}>Pindah ke toko</Text>
                  <View style={styles.chipRow}>
                    <Pressable style={[styles.chip, trStoreId === null && styles.chipActive]} onPress={() => setTrStoreId(null)}>
                      <Text style={[styles.chipText, trStoreId === null && styles.chipTextActive]}>Tidak berubah</Text>
                    </Pressable>
                    {stores.map((s) => (
                      <Pressable key={s.id} style={[styles.chip, trStoreId === s.id && styles.chipActive]} onPress={() => setTrStoreId(s.id)}>
                        <Text style={[styles.chipText, trStoreId === s.id && styles.chipTextActive]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>Kondisi fisik saat ini</Text>
              <View style={styles.chipRow}>
                {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => (
                  <Pressable key={c} style={[styles.chip, trCondition === c && styles.chipActive]} onPress={() => setTrCondition(c)}>
                    <Text style={[styles.chipText, trCondition === c && styles.chipTextActive]}>{CONDITION_LABEL[c]}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Alasan</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. rotasi tugas, pindah toko"
                placeholderTextColor={colors.textMuted}
                value={trReason}
                onChangeText={setTrReason}
              />

              {trError && <Text style={styles.errorText}>{trError}</Text>}
              <View style={styles.formActions}>
                <Pressable style={styles.cancelButton} onPress={() => { setTrOpen(false); setTrError(null); }} disabled={trSubmitting}>
                  <Text style={styles.cancelButtonText}>Batal</Text>
                </Pressable>
                <Button label={trSubmitting ? 'Menyimpan...' : 'Catat Serah Terima'} onPress={handleTransfer} loading={trSubmitting} style={{ flex: 1 }} />
              </View>
            </View>
          ) : mtOpen ? (
            <View style={styles.card}>
              <Text style={styles.formTitle}>Catat Servis</Text>

              <Text style={styles.fieldLabel}>Tanggal servis</Text>
              <DateField
                value={mtDate}
                onChange={(v) => {
                  setMtDate(v);
                  if (v && asset.maintenance_interval_days) setMtNext(addDays(v, asset.maintenance_interval_days));
                }}
                placeholder="Pilih tanggal"
                maxDate={todayKey()}
                colors={colors}
              />

              <Text style={styles.fieldLabel}>
                {asset.maintenance_interval_days ? `Jadwal berikutnya (otomatis +${asset.maintenance_interval_days} hari, boleh diubah)` : 'Jadwal berikutnya (opsional)'}
              </Text>
              <DateField value={mtNext} onChange={setMtNext} placeholder="Tidak ada jadwal berikutnya" minDate={mtDate || undefined} allowClear colors={colors} />

              <Text style={styles.fieldLabel}>Catatan servis (opsional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Mis. ganti oli, kalibrasi"
                placeholderTextColor={colors.textMuted}
                value={mtNote}
                onChangeText={setMtNote}
              />

              {mtError && <Text style={styles.errorText}>{mtError}</Text>}
              <View style={styles.formActions}>
                <Pressable style={styles.cancelButton} onPress={() => { setMtOpen(false); setMtError(null); }} disabled={mtSubmitting}>
                  <Text style={styles.cancelButtonText}>Batal</Text>
                </Pressable>
                <Button label={mtSubmitting ? 'Menyimpan...' : 'Catat Servis'} onPress={handleMaintenance} loading={mtSubmitting} style={{ flex: 1 }} />
              </View>
            </View>
          ) : canModify && !asset.disposed_at ? (
            <View style={{ gap: spacing.sm }}>
              <Button label="Serah Terima" onPress={openTransfer} />
              <Button label="Catat Servis" variant="outline" onPress={openMaintenance} />
              <Button label="Ubah Status / Catatan" variant="outline" onPress={openEdit} />
            </View>
          ) : (
            <Text style={styles.emptyHistoryText}>
              {asset.disposed_at
                ? 'Aset ini sudah dilepas (dijual atau dibuang), jadi tidak bisa diubah dari aplikasi.'
                : 'Akun ini hanya bisa melihat aset. Minta admin membuka izin Ubah untuk serah terima dan perubahan status.'}
            </Text>
          )}
          {transfers.length > 0 && (
            <>
              <Text style={styles.historyTitle}>Serah Terima Terakhir</Text>
              {transfers.map((t) => (
                <View key={t.id} style={styles.historyRow}>
                  <Ionicons name="swap-horizontal-outline" size={20} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyText}>
                      {t.from_user ?? 'Tanpa pemegang'} → {t.to_user ?? 'Tanpa pemegang'}
                    </Text>
                    {t.to_store !== t.from_store && (
                      <Text style={styles.historyNote}>
                        Lokasi: {t.from_store ?? 'Kantor Pusat'} → {t.to_store ?? 'Kantor Pusat'}
                      </Text>
                    )}
                    <Text style={styles.historyNote}>Kondisi: {CONDITION_LABEL[t.condition]} — {t.reason}</Text>
                    <Text style={styles.historyDate}>{t.performed_by ?? 'Sistem'} · {formatDateTime(t.created_at)}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          <Text style={styles.historyTitle}>Riwayat Perubahan</Text>
          {asset.activities.length === 0 ? (
            <Text style={styles.emptyHistoryText}>Belum ada riwayat perubahan untuk aset ini.</Text>
          ) : (
            asset.activities.map((a) => (
              <View key={a.id} style={styles.historyRow}>
                <Ionicons name="time-outline" size={20} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyText}>
                    {eventLabel(a.event)}{a.causer ? ` — ${a.causer.name}` : ' — Sistem'}
                  </Text>
                  {a.description && <Text style={styles.historyNote}>{a.description}</Text>}
                  <Text style={styles.historyDate}>{formatDateTime(a.created_at)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
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
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    centerStateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
    retryButton: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
    },
    retryText: { color: '#ffffff', fontSize: fontSize.sm, fontWeight: '600' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: spacing.md,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    codeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent, letterSpacing: 0.5 },
    nameText: { fontSize: fontSize.xl, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
    categoryText: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
    statusText: { fontSize: fontSize.xs, fontWeight: '700' },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    infoText: { fontSize: fontSize.sm, color: colors.textSecondary, flex: 1 },
    formTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
    fieldLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.xs },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: fontSize.sm,
      color: colors.textPrimary,
    },
    errorText: { fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.sm },
    formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    cancelButton: { paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
    cancelButtonText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
    historyTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
    helperInline: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.sm },
    emptyHistoryText: { fontSize: fontSize.sm, color: colors.textMuted },
    historyRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    historyText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
    historyNote: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
    historyDate: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  });
}
