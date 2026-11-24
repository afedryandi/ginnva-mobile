import React, { useCallback, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { isAllowedRoute } from '@/lib/notifications';

interface InboxItem {
  id: string;
  title: string;
  body: string;
  color: string;
  route: string | null;
  params: Record<string, string> | null;
  type: string | null;
  source: 'staff_inbox' | 'panel';
  read_at: string | null;
  created_at: string | null;
}

interface InboxResponse {
  data: InboxItem[];
  has_more: boolean;
  unread_count: number;
}

type Group = { label: string; items: InboxItem[] };

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Kelompok hari untuk judul bagian daftar.
function dayGroup(iso: string | null): string {
  if (!iso) return 'Lebih lama';
  const diff = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86400000);
  if (diff <= 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  if (diff < 7) return 'Minggu ini';
  return 'Lebih lama';
}

// Ikon menurut topik judul, supaya jenis notifikasi dikenali sekilas.
function iconFor(title: string): React.ComponentProps<typeof Ionicons>['name'] {
  const t = title.toLowerCase();
  if (/lembur/.test(t)) return 'moon-outline';
  if (/dinas luar/.test(t)) return 'navigate-outline';
  if (/surat peringatan/.test(t)) return 'alert-circle-outline';
  if (/izin|cuti|sakit/.test(t)) return 'calendar-outline';
  if (/absen|absensi|koreksi/.test(t)) return 'time-outline';
  if (/gaji|slip/.test(t)) return 'cash-outline';
  if (/booking|jadwal|penugasan|instalasi|spk/.test(t)) return 'car-sport-outline';
  if (/stok|bahan|barang|pembelian|memo/.test(t)) return 'cube-outline';
  if (/pesan|chat/.test(t)) return 'chatbubble-ellipses-outline';
  if (/lead|quotation/.test(t)) return 'megaphone-outline';
  if (/dokumen|peraturan|kontrak/.test(t)) return 'document-text-outline';
  return 'notifications-outline';
}

// Kotak masuk notifikasi staf (Notifikasi Fase 2). Membaca tabel notifikasi yang sama dengan lonceng panel; push hanyalah pengingat,
// pesan yang terlewat tetap ada di sini. Menekan baris menandainya dibaca dan membuka layar tujuan bila rutenya diizinkan.
// Tampilan dirancang ulang 2026-11-13: satu kartu per hari berisi baris-baris bergaris tipis, bukan satu kartu per notifikasi.
export default function StaffInboxScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async (targetPage: number, append: boolean) => {
    try {
      const res = await staffApiFetch<InboxResponse>(`/api/staff/inbox?page=${targetPage}`);
      setItems((current) => (append ? [...current, ...res.data] : res.data));
      setHasMore(res.has_more);
      setUnread(res.unread_count);
      setPage(targetPage);
      setError(null);
    } catch {
      setError('Gagal memuat notifikasi. Periksa koneksi internet.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(1, false).finally(() => setLoading(false));
    }, [load])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(1, false);
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await load(page + 1, true);
    setLoadingMore(false);
  }, [hasMore, loadingMore, load, page]);

  const open = useCallback(async (item: InboxItem) => {
    if (!item.read_at) {
      setItems((current) => current.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)));
      setUnread((n) => Math.max(0, n - 1));
      staffApiFetch(`/api/staff/inbox/${item.id}/read`, { method: 'POST' }).catch(() => undefined);
    }
    if (item.route && isAllowedRoute(item.route)) {
      router.push({ pathname: item.route as never, params: item.params ?? undefined });
    }
  }, []);

  const markAll = useCallback(async () => {
    setItems((current) => current.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await staffApiFetch('/api/staff/inbox/read-all', { method: 'POST' });
    } catch {
      load(1, false);
    }
  }, [load]);

  const infoColor = isDark ? '#7aa8ff' : '#2563c8';
  const infoBg = isDark ? 'rgba(122,168,255,0.16)' : '#e6eefb';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';

  const toneColor = (tone: string) =>
    tone === 'success' ? colors.success : tone === 'warning' ? colors.warning : tone === 'danger' ? colors.danger : infoColor;
  const toneBg = (tone: string) =>
    tone === 'success' ? colors.successBg : tone === 'warning' ? colors.warningBg : tone === 'danger' ? colors.dangerBg : infoBg;

  // Dikelompokkan per hari; filter "Belum dibaca" dikerjakan di sisi aplikasi.
  const groups = useMemo<Group[]>(() => {
    const visible = onlyUnread ? items.filter((i) => !i.read_at) : items;
    const out: Group[] = [];

    for (const item of visible) {
      const label = dayGroup(item.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(item);
      else out.push({ label, items: [item] });
    }

    return out;
  }, [items, onlyUnread]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          onPress={markAll}
          disabled={unread === 0}
          style={[styles.markAll, unread === 0 && styles.markAllDisabled]}
          accessibilityLabel="Tandai semua dibaca"
        >
          <Ionicons name="checkmark-done" size={17} color={unread === 0 ? colors.textMuted : accentText} />
          <Text style={[styles.markAllText, unread === 0 && { color: colors.textMuted }]}>Tandai dibaca</Text>
        </Pressable>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.title}>Notifikasi</Text>
        <Text style={styles.subtitle}>{unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca'}</Text>
      </View>

      <View style={styles.segment}>
        <Pressable style={[styles.segmentItem, !onlyUnread && styles.segmentItemActive]} onPress={() => setOnlyUnread(false)} accessibilityRole="button" accessibilityState={{ selected: !onlyUnread }}>
          <Text style={[styles.segmentText, !onlyUnread && styles.segmentTextActive]}>Semua</Text>
        </Pressable>
        <Pressable style={[styles.segmentItem, onlyUnread && styles.segmentItemActive]} onPress={() => setOnlyUnread(true)} accessibilityRole="button" accessibilityState={{ selected: onlyUnread }}>
          <Text style={[styles.segmentText, onlyUnread && styles.segmentTextActive]}>Belum dibaca</Text>
          {unread > 0 ? (
            <View style={styles.segmentBadge}>
              <Text style={styles.segmentBadgeText}>{unread > 99 ? '99+' : unread}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {loading ? (
        <SkeletonCards count={6} />
      ) : error && items.length === 0 ? (
        <View style={styles.centerState}><Text style={styles.errorText}>{error}</Text></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(group) => group.label}
          contentContainerStyle={groups.length === 0 ? styles.emptyContent : styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name={onlyUnread ? 'checkmark-done-outline' : 'notifications-off-outline'} size={38} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>{onlyUnread ? 'Semua sudah dibaca' : 'Belum ada notifikasi'}</Text>
              <Text style={styles.emptyText}>
                {onlyUnread ? 'Semua notifikasi sudah dibaca.' : 'Pengingat absen, kabar pengajuan, dan jadwal pekerjaan akan muncul di sini.'}
              </Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ margin: spacing.md }} /> : null}
          renderItem={({ item: group, index: groupIndex }) => (
            <FadeInUp index={groupIndex} enabled={groupIndex < 3}>
              <View style={styles.group}>
                <Text style={styles.groupTitle}>{group.label}</Text>
                <View style={styles.groupCard}>
                  {group.items.map((item, rowIndex) => {
                    const tint = toneColor(item.color);
                    const unreadItem = !item.read_at;
                    const tappable = !!item.route && isAllowedRoute(item.route);

                    return (
                      <React.Fragment key={item.id}>
                        {rowIndex > 0 ? <View style={styles.divider} /> : null}
                        <Pressable
                          style={({ pressed }) => [styles.row, unreadItem && styles.rowUnread, pressed && styles.rowPressed]}
                          onPress={() => open(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.title}${unreadItem ? ', belum dibaca' : ''}`}
                        >
                          {unreadItem ? <View style={styles.dot} /> : null}
                          <View style={[styles.iconBubble, { backgroundColor: toneBg(item.color) }]}>
                            <Ionicons name={iconFor(item.title)} size={22} color={tint} />
                          </View>
                          <View style={styles.rowBody}>
                            <Text style={[styles.rowTitle, unreadItem && styles.rowTitleUnread]} numberOfLines={2}>{item.title}</Text>
                            <Text style={[styles.rowText, unreadItem && styles.rowTextUnread]} numberOfLines={3}>{item.body}</Text>
                            <View style={styles.rowFoot}>
                              <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
                              {tappable ? (
                                <View style={styles.openHint}>
                                  <Text style={styles.openHintText}>Buka</Text>
                                  <Ionicons name="chevron-forward" size={14} color={accentText} />
                                </View>
                              ) : null}
                            </View>
                          </View>
                        </Pressable>
                      </React.Fragment>
                    );
                  })}
                </View>
              </View>
            </FadeInUp>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan Beranda: latar abu-putih dengan kartu putih di mode terang; tingkat abu bawaan aplikasi di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#eaeaf0';
  const line = isDark ? colors.border : '#eeeef3';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    markAll: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    markAllDisabled: { backgroundColor: chip },
    markAllText: { fontSize: 13, fontWeight: '700', color: accentText },

    titleBlock: { gap: 4, paddingHorizontal: 20, paddingTop: 18 },
    title: { fontSize: 34, fontWeight: '800', letterSpacing: -1.2, color: colors.textPrimary },
    subtitle: { fontSize: 14, fontWeight: '500', color: colors.textMuted },

    segment: { flexDirection: 'row', marginHorizontal: 20, marginTop: 20, marginBottom: 16, padding: 4, borderRadius: 18, backgroundColor: chip },
    segmentItem: { flex: 1, height: 40, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    segmentItemActive: {
      backgroundColor: card,
      shadowColor: '#14141b', shadowOffset: { width: 0, height: 1 }, shadowOpacity: isDark ? 0.4 : 0.12, shadowRadius: 3, elevation: 2,
    },
    segmentText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    segmentTextActive: { fontWeight: '700', color: colors.textPrimary },
    segmentBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    segmentBadgeText: { fontSize: 11, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 20, paddingBottom: spacing.xxl, gap: 22 },
    group: { gap: 10 },
    groupTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    groupCard: { borderRadius: 26, overflow: 'hidden', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    divider: { height: 1, marginLeft: 76, backgroundColor: line },

    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 16, paddingLeft: 24, paddingRight: 18 },
    rowUnread: { backgroundColor: isDark ? 'rgba(237,22,81,0.10)' : 'rgba(237,22,81,0.045)' },
    rowPressed: { opacity: 0.8 },
    dot: { position: 'absolute', left: 10, top: '50%', width: 8, height: 8, marginTop: -4, borderRadius: 4, backgroundColor: colors.accent },
    iconBubble: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    rowBody: { flex: 1, gap: 4 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    rowTitleUnread: { fontWeight: '800' },
    rowText: { fontSize: 13.5, fontWeight: '500', lineHeight: 20, color: colors.textMuted },
    rowTextUnread: { color: colors.textSecondary },
    rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowTime: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    openHint: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    openHintText: { fontSize: 12, fontWeight: '700', color: accentText },

    emptyContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    empty: { alignItems: 'center', gap: 10, paddingHorizontal: 24, paddingBottom: 60 },
    emptyIcon: {
      width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
      backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow,
    },
    emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    emptyText: { fontSize: fontSize.sm, fontWeight: '500', lineHeight: 22, textAlign: 'center', color: colors.textMuted },
    errorText: { color: colors.danger, fontSize: fontSize.sm, textAlign: 'center' },
  });
}
