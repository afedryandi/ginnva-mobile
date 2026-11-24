import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { Skeleton } from '@/components/ui/Skeleton';
import { darkColors, fontSize, spacing, radius, shadow } from '@/constants/theme';
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

interface MemoListItem {
  id: number;
  memo_number: string;
  vehicle_info: string | null;
  spk_number: string | null;
  items_count: number;
  unreturned_count?: number;
  creator: { name: string } | null;
  store: { name: string } | null;
  created_at: string;
  flow?: string;
  request_status?: string | null;
}

interface InboxMemo {
  id: number;
  memo_number: string;
  vehicle_info: string | null;
  request_note: string | null;
  creator: { name: string } | null;
  store: { name: string } | null;
}

interface InboxResponse {
  data: { to_approve: InboxMemo[]; to_hand_over: InboxMemo[] };
}

const REQUEST_LABEL: Record<string, string> = {
  pending: 'Menunggu persetujuan',
  approved: 'Disetujui, silakan hubungi staf gudang',
  rejected: 'Ditolak',
  fulfilled: 'Sudah diserahkan',
};

interface ListResponse {
  data: MemoListItem[];
  has_more?: boolean;
  total?: number;
  summary?: { all: number; unreturned: number };
  can_create?: boolean;
}

type FilterMode = 'all' | 'unreturned';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MemoListScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const styles = useMemo(() => createStyles(colors, isDark, accentText), [colors, isDark, accentText]);

  const [memos, setMemos] = useState<MemoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [summary, setSummary] = useState<ListResponse['summary']>(undefined);
  const [canCreate, setCanCreate] = useState(true);
  const [denied, setDenied] = useState(false);
  // Memo yang menunggu keputusan akun ini (setujui oleh store manager, serahkan oleh gudang).
  const [inbox, setInbox] = useState<InboxResponse['data']>({ to_approve: [], to_hand_over: [] });

  // Kata kunci dikirim ke server setelah berhenti mengetik sebentar.
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Hanya respons permintaan terbaru yang dipakai: ketikan/filter yang berganti cepat tidak boleh ditimpa respons lama yang telat.
  const latestRequest = useRef(0);

  const buildUrl = useCallback((offset: number) => {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    if (filter === 'unreturned') params.set('unreturned', '1');
    if (offset > 0) params.set('offset', String(offset));
    const qs = params.toString();
    return `/api/staff/memos${qs ? `?${qs}` : ''}`;
  }, [query, filter]);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await staffApiFetch<InboxResponse>('/api/staff/memos/inbox');
      setInbox(res.data);
    } catch {
      setInbox({ to_approve: [], to_hand_over: [] });
    }
  }, []);

  const fetchMemos = useCallback(async () => {
    const requestId = ++latestRequest.current;
    fetchInbox();
    setError(null);
    setDenied(false);
    try {
      const res = await staffApiFetch<ListResponse>(buildUrl(0));
      if (requestId !== latestRequest.current) return;
      setMemos(res.data ?? []);
      setHasMore(res.has_more ?? false);
      setSummary(res.summary);
      setCanCreate(res.can_create !== false);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar memo.');
    }
  }, [buildUrl, fetchInbox]);

  // Halaman berikutnya lewat offset — daftar sebelumnya dibatasi 50 tanpa
  // cara lihat yang lebih lama sama sekali kalau toko sudah punya >50 memo.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await staffApiFetch<ListResponse>(buildUrl(memos.length));
      setMemos((prev) => [...prev, ...(res.data ?? [])]);
      setHasMore(res.has_more ?? false);
    } catch {
      // Senyap — user masih bisa coba lagi dengan scroll/tap lagi.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, memos.length, buildUrl]);

  // Refetch tiap kali layar ini kembali dapat fokus (mis. balik dari buat memo baru / dari detail), bukan cuma sekali saat mount.
  // Kerangka pemuatan hanya tampil kalau belum pernah berhasil load (hasLoadedOnce, bukan dibaca dari state yang bisa basi di
  // closure ini); refetch berikutnya jalan senyap di latar belakang.
  const hasLoadedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedOnce.current) setLoading(true);
      fetchMemos().finally(() => {
        hasLoadedOnce.current = true;
        setLoading(false);
      });
    }, [fetchMemos])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMemos();
    setRefreshing(false);
  }, [fetchMemos]);

  const goToCreate = () => router.push('/staff/memos/create' as never);
  const inboxCount = inbox.to_approve.length + inbox.to_hand_over.length;
  const openRequest = (id: number) => router.push({ pathname: '/staff/memos/request/[id]', params: { id: String(id) } } as never);

  const renderInbox = () =>
    inboxCount === 0 ? null : (
      <View style={{ gap: 10, marginBottom: 6 }}>
        {([['Menunggu persetujuan Anda', inbox.to_approve], ['Perlu dicatat penyerahannya', inbox.to_hand_over]] as [string, InboxMemo[]][])
          .filter(([, list]) => list.length > 0)
          .map(([title, list]) => (
            <View key={title} style={{ gap: 8 }}>
              <Text style={styles.stateTitle}>{title} ({list.length})</Text>
              {list.map((m) => (
                <PressableScale key={m.id} style={styles.card} onPress={() => openRequest(m.id)} accessibilityRole="button">
                  <Text style={styles.memoNumber} numberOfLines={1}>{m.memo_number}</Text>
                  <Text style={styles.memoInfo} numberOfLines={2}>{[m.vehicle_info, m.request_note].filter(Boolean).join(' · ') || 'Tanpa keterangan'}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>{[m.creator?.name, m.store?.name].filter(Boolean).join(' · ')}</Text>
                </PressableScale>
              ))}
            </View>
          ))}
      </View>
    );
  const filtering = !!query || filter !== 'all';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.roundButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>Memo Barang</Text>
          </View>
          {canCreate && !denied ? (
            <PressableScale onPress={goToCreate} style={styles.addButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Buat memo baru">
              <Ionicons name="add" size={26} color="#ffffff" />
            </PressableScale>
          ) : null}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Cari no memo, kendaraan, atau SPK"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hapus pencarian">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Pola sama dengan filter halaman Bahan Baku: tab selebar layar, jumlah di samping nama, dan garis aksen di bawah tab terpilih.
            Jumlah "Masih Digunakan" berlatar kuning karena itu yang menunggu tindakan. */}
        <View style={styles.tabs}>
          {([['all', 'Semua'], ['unreturned', 'Masih Digunakan']] as [FilterMode, string][]).map(([key, label]) => {
            const active = filter === key;
            const count = summary ? summary[key] : 0;

            return (
              <Pressable key={key} style={styles.tab} onPress={() => setFilter(key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <View style={styles.tabTop}>
                  <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
                  {count > 0 ? (
                    <View style={[styles.tabCount, key === 'unreturned' && styles.tabCountAlert]}>
                      <Text style={[styles.tabCountText, key === 'unreturned' && styles.tabCountTextAlert]}>{count}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.tabBar, active && styles.tabBarActive]} />
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.listContent}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.card}>
                <View style={styles.cardTop}>
                  <Skeleton width={46} height={46} borderRadius={23} />
                  <View style={styles.skeletonLines}>
                    <Skeleton width="45%" height={12} />
                    <Skeleton width="75%" height={16} />
                  </View>
                </View>
                <Skeleton width="60%" height={26} borderRadius={13} />
              </View>
            ))}
          </View>
        ) : denied && inboxCount > 0 ? (
          <ScrollView contentContainerStyle={styles.listContent}>{renderInbox()}</ScrollView>
        ) : denied ? (
          <View style={styles.centerState}>
            <View style={styles.stateIcon}>
              <Ionicons name="lock-closed-outline" size={30} color={accentText} />
            </View>
            <Text style={styles.stateTitle}>Belum Ada Akses</Text>
            <Text style={styles.stateText}>Minta admin mencentang menu Memo Barang di Hak Akses akun ini.</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <View style={[styles.stateIcon, { backgroundColor: colors.dangerBg }]}>
              <Ionicons name="alert-circle-outline" size={30} color={colors.danger} />
            </View>
            <Text style={styles.stateTitle}>Gagal Memuat</Text>
            <Text style={styles.stateText}>{error}</Text>
            <PressableScale style={styles.secondaryBtn} onPress={onRefresh}>
              <Ionicons name="refresh" size={16} color={colors.textPrimary} />
              <Text style={styles.secondaryBtnText}>Coba Lagi</Text>
            </PressableScale>
          </View>
        ) : memos.length === 0 && inboxCount === 0 ? (
          <View style={styles.centerState}>
            <View style={styles.stateIcon}>
              <Ionicons name={filtering ? 'search-outline' : 'clipboard-outline'} size={32} color={accentText} />
            </View>
            <Text style={styles.stateTitle}>{filtering ? 'Tidak Ada Memo yang Cocok' : 'Belum Ada Memo'}</Text>
            <Text style={styles.stateText}>
              {filtering
                ? 'Ubah kata kunci atau filter.'
                : canCreate
                  ? 'Buat memo untuk mencatat barang keluar dan kembali dalam satu instalasi.'
                  : 'Belum ada memo di toko ini.'}
            </Text>
            {!filtering && canCreate ? (
              <PressableScale style={styles.primaryBtn} onPress={goToCreate}>
                <Ionicons name="add" size={20} color="#ffffff" />
                <Text style={styles.primaryBtnText}>Buat Memo Baru</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={memos}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            ListHeaderComponent={renderInbox()}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator color={colors.accent} style={styles.footerSpinner} />
              ) : hasMore ? (
                <Pressable style={styles.loadMoreBtn} onPress={loadMore}>
                  <Text style={styles.loadMoreBtnText}>Muat Lebih Banyak</Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item, index }) => {
              const unreturned = item.unreturned_count ?? 0;
              const info = [item.vehicle_info, item.spk_number ? `SPK ${item.spk_number}` : null].filter(Boolean).join(' · ');

              return (
                <FadeInUp index={index} enabled={index < 8}>
                  <PressableScale
                    style={styles.card}
                    onPress={() => (item.flow === 'request' ? openRequest(item.id) : router.push({ pathname: '/staff/memos/[id]', params: { id: String(item.id) } } as never))}
                    accessibilityRole="button"
                  >
                    <View style={styles.cardTop}>
                      <View style={styles.cardIcon}>
                        <Ionicons name="reader-outline" size={22} color={accentText} />
                      </View>
                      <View style={styles.cardBody}>
                        <Text style={styles.memoNumber} numberOfLines={1}>{item.memo_number}</Text>
                        <Text style={[styles.memoInfo, !info && styles.memoInfoEmpty]} numberOfLines={1}>{info || 'Tanpa info kendaraan'}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </View>

                    <View style={styles.cardChips}>
                      <View style={styles.infoChip}>
                        <Ionicons name="cube-outline" size={14} color={colors.textSecondary} />
                        <Text style={styles.infoChipText}>{item.items_count} barang</Text>
                      </View>
                      {item.flow === 'request' && item.request_status && item.request_status !== 'fulfilled' && !(item.request_status === 'approved' && item.items_count > 0) ? (
                        <View style={[styles.infoChip, item.request_status === 'rejected' ? styles.warnChip : null]}>
                          <Ionicons name="hourglass-outline" size={14} color={colors.textSecondary} />
                          <Text style={styles.infoChipText}>{REQUEST_LABEL[item.request_status] ?? item.request_status}</Text>
                        </View>
                      ) : null}
                      {unreturned > 0 ? (
                        <View style={[styles.infoChip, styles.warnChip]}>
                          <Ionicons name="time-outline" size={14} color={colors.warning} />
                          <Text style={[styles.infoChipText, { color: colors.warning }]}>{unreturned} masih digunakan</Text>
                        </View>
                      ) : item.items_count > 0 ? (
                        <View style={[styles.infoChip, styles.okChip]}>
                          <Ionicons name="checkmark-circle-outline" size={14} color={colors.success} />
                          <Text style={[styles.infoChipText, { color: colors.success }]}>Lengkap</Text>
                        </View>
                      ) : null}
                    </View>

                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {item.creator?.name ?? '—'} · {formatDate(item.created_at)}
                    </Text>
                  </PressableScale>
                </FadeInUp>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean, accentText: string) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: colors.bg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, color: colors.textPrimary },
    addButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },

    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 20,
      paddingHorizontal: 16,
      height: 50,
      borderRadius: 25,
      borderWidth: 1,
      borderColor: isDark ? colors.border : '#e8e8ee',
      backgroundColor: colors.surface,
    },
    searchInput: { flex: 1, height: 50, fontSize: fontSize.sm, color: colors.textPrimary },

    tabs: { flexDirection: 'row', marginHorizontal: 20, marginTop: spacing.md, marginBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: isDark ? colors.border : '#e8e8ee' },
    tab: { flex: 1, alignItems: 'center', paddingTop: 10, gap: 8 },
    tabTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tabText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabCount: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    tabCountAlert: { backgroundColor: colors.warningBg },
    tabCountText: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
    tabCountTextAlert: { color: colors.warning },
    tabBar: { height: 3, width: '60%', borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.xs, paddingBottom: spacing.xl, gap: 14 },
    card: {
      borderRadius: 26,
      padding: 18,
      gap: 14,
      borderWidth: 1,
      borderColor: isDark ? colors.border : '#e8e8ee',
      backgroundColor: colors.surface,
      ...shadow.sm,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    cardIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    cardBody: { flex: 1, gap: 3 },
    memoNumber: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, color: colors.textMuted },
    memoInfo: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    memoInfoEmpty: { fontWeight: '600', color: colors.textMuted },
    cardChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    infoChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.surfaceElevated },
    infoChipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    warnChip: { backgroundColor: colors.warningBg },
    okChip: { backgroundColor: colors.successBg },
    cardMeta: { fontSize: 12, color: colors.textMuted },
    skeletonLines: { flex: 1, gap: 8 },

    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: 60 },
    stateIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft, marginBottom: spacing.xs },
    stateTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    stateText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, paddingHorizontal: 24, borderRadius: 25, backgroundColor: colors.accent, marginTop: spacing.sm },
    primaryBtnText: { color: '#ffffff', fontWeight: '800', fontSize: fontSize.sm },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: colors.surfaceElevated, marginTop: spacing.xs },
    secondaryBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: fontSize.sm },

    footerSpinner: { marginTop: spacing.sm },
    loadMoreBtn: { alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 23, backgroundColor: colors.surfaceElevated },
    loadMoreBtnText: { color: accentText, fontWeight: '800', fontSize: fontSize.sm },
  });
}
