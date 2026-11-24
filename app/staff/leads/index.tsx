import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AppText as Text } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { SkeletonCards } from '@/components/ui/Skeleton';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { ApiError, staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import LeadOutcomePanel, { LeadOutcomeFields } from '@/components/LeadOutcomePanel';
import LeadLogModal from '@/components/LeadLogModal';

type LeadType = 'quotation' | 'product-inquiry' | 'partnership';
type LeadStatus = 'new' | 'contacted' | 'deal' | 'rejected' | 'closed' | 'cancelled';

// Satu daftar untuk tiga jenis lead (Quotation, Inquiry Produk, Kemitraan) -- digabung 2026-11-13. Satu himpunan status untuk semuanya,
// dan dari aplikasi hanya New <-> Contacted yang bisa diubah; Deal/Rejected/Closed/Cancelled lewat panel web.
interface HubLead extends LeadOutcomeFields {
  type: LeadType;
  id: number;
  status: LeadStatus;
  name: string | null;
  contact: string | null;
  subtitle: string | null;
  store_name: string | null;
  number: string | null;
  message: string | null;
  created_at: string;
}

interface HubMeta {
  current_page: number;
  last_page: number;
  total: number;
  types: LeadType[];
}

const TYPE_LABEL: Record<LeadType, string> = {
  quotation: 'Quotation',
  'product-inquiry': 'Produk',
  partnership: 'Kemitraan',
};

const TYPE_ICON: Record<LeadType, keyof typeof Ionicons.glyphMap> = {
  quotation: 'document-text-outline',
  'product-inquiry': 'cube-outline',
  partnership: 'people-outline',
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  deal: 'Deal',
  rejected: 'Rejected',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const STATUS_FILTERS: { key: LeadStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'deal', label: 'Deal' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const VALID_STATUS = STATUS_FILTERS.map((f) => f.key);
const VALID_TYPE: (LeadType | 'all')[] = ['all', 'quotation', 'product-inquiry', 'partnership'];

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function StaffLeadHubScreen() {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const params = useLocalSearchParams<{ type?: string; status?: string }>();

  // Rute lama '/staff/quotations?status=new' (tautan notifikasi "Lead Belum Di-follow-up") dialihkan ke sini; nilai dari query divalidasi
  // dulu terhadap daftar yang dikenal.
  const [typeFilter, setTypeFilter] = useState<LeadType | 'all'>(VALID_TYPE.includes(params.type as LeadType) ? (params.type as LeadType) : 'all');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>(VALID_STATUS.includes(params.status as LeadStatus) ? (params.status as LeadStatus) : 'all');
  const [mineOnly, setMineOnly] = useState(false);
  // Filter jenis dan "Lead saya" ada di lembar Filter; status tetap berupa tab di atas daftar.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftType, setDraftType] = useState<LeadType | 'all'>('all');
  const [draftMine, setDraftMine] = useState(false);

  const [leads, setLeads] = useState<HubLead[]>([]);
  const [meta, setMeta] = useState<HubMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const keyOf = (l: HubLead) => `${l.type}-${l.id}`;

  const fetchPage = useCallback(
    (page: number) => {
      const qs = new URLSearchParams({ page: String(page), type: typeFilter });
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (mineOnly) qs.set('mine', '1');
      setError(null);
      return staffApiFetch<{ data: HubLead[]; meta: HubMeta }>(`/api/staff/lead-hub?${qs.toString()}`)
        .then((res) => {
          setLeads((prev) => (page === 1 ? res.data : [...prev, ...res.data]));
          setMeta(res.meta);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar lead. Periksa koneksi internet.'));
    },
    [typeFilter, statusFilter, mineOnly],
  );

  useEffect(() => {
    setLoading(true);
    setExpanded(null);
    fetchPage(1).finally(() => setLoading(false));
  }, [fetchPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPage(1);
    setRefreshing(false);
  }, [fetchPage]);

  const onLoadMore = useCallback(async () => {
    if (loadingMore || !meta || meta.current_page >= meta.last_page) return;
    setLoadingMore(true);
    await fetchPage(meta.current_page + 1);
    setLoadingMore(false);
  }, [fetchPage, meta, loadingMore]);

  const patchLocal = (lead: HubLead, patch: Partial<HubLead>) =>
    setLeads((prev) => prev.map((l) => (keyOf(l) === keyOf(lead) ? { ...l, ...patch } : l)));

  const setStatus = async (lead: HubLead, status: 'new' | 'contacted') => {
    if (lead.status === status) return;
    try {
      const res = await staffApiFetch<{ data: { status: LeadStatus } }>(`/api/staff/lead-inbox/${lead.type}/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      patchLocal(lead, { status: res.data.status });
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa mengubah status.');
    }
  };

  const availableTypes = meta?.types ?? (['quotation', 'product-inquiry', 'partnership'] as LeadType[]);

  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const chipColor = isDark ? colors.surfaceElevated : '#e4e4ea';
  const activeExtra = (typeFilter !== 'all' ? 1 : 0) + (mineOnly ? 1 : 0);

  const openSheet = () => {
    setDraftType(typeFilter);
    setDraftMine(mineOnly);
    setSheetOpen(true);
  };

  const applySheet = () => {
    setTypeFilter(draftType);
    setMineOnly(draftMine);
    setSheetOpen(false);
  };

  const statusStyle = (s: LeadStatus) => {
    if (s === 'new') return { bg: colors.accentSoft, fg: isDark ? '#ff6b8f' : '#cc1042' };
    if (s === 'contacted') return { bg: colors.warningBg, fg: colors.warning };
    if (s === 'deal' || s === 'closed') return { bg: colors.successBg, fg: colors.success };
    return { bg: colors.dangerBg, fg: colors.danger };
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <LeadLogModal visible={logOpen} onClose={() => setLogOpen(false)} />

      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/staff' as never))} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Lead</Text>
          {meta ? <Text style={styles.subtitle}>{meta.total} lead</Text> : null}
        </View>
        <Pressable onPress={() => setLogOpen(true)} style={styles.addButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Catat lead manual">
          <Ionicons name="add" size={24} color="#ffffff" />
        </Pressable>
      </View>

      <View style={styles.tabsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsContent}>
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.key;

            return (
              <Pressable key={f.key} style={styles.tab} onPress={() => setStatusFilter(f.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{f.label}</Text>
                <View style={[styles.tabBar, active && styles.tabBarActive]} />
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable style={styles.filterButton} onPress={openSheet} accessibilityRole="button" accessibilityLabel="Filter lead">
          <Ionicons name="options-outline" size={20} color={colors.textPrimary} />
          {activeExtra > 0 ? (
            <View style={styles.filterDot}>
              <Text style={styles.filterDotText}>{activeExtra}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {activeExtra > 0 ? (
        <View style={styles.activeRow}>
          {typeFilter !== 'all' ? (
            <Pressable style={styles.activeChip} onPress={() => setTypeFilter('all')} accessibilityRole="button" accessibilityLabel={'Hapus filter ' + TYPE_LABEL[typeFilter]}>
              <Ionicons name={TYPE_ICON[typeFilter]} size={13} color={accentText} />
              <Text style={styles.activeChipText}>{TYPE_LABEL[typeFilter]}</Text>
              <Ionicons name="close" size={14} color={accentText} />
            </Pressable>
          ) : null}
          {mineOnly ? (
            <Pressable style={styles.activeChip} onPress={() => setMineOnly(false)} accessibilityRole="button" accessibilityLabel="Hapus filter Lead saya">
              <Ionicons name="person-outline" size={13} color={accentText} />
              <Text style={styles.activeChipText}>Lead saya</Text>
              <Ionicons name="close" size={14} color={accentText} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Modal visible={sheetOpen} animationType="slide" transparent onRequestClose={() => setSheetOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropFill} onPress={() => setSheetOpen(false)} accessibilityLabel="Tutup filter" />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filter Lead</Text>
              <Pressable onPress={() => { setDraftType('all'); setDraftMine(false); }} hitSlop={8} accessibilityRole="button">
                <Text style={styles.sheetReset}>Reset</Text>
              </Pressable>
            </View>

            {availableTypes.length > 1 ? (
              <>
                <Text style={styles.sheetLabel}>Jenis</Text>
                <View style={styles.optionList}>
                  {(['all', ...availableTypes] as (LeadType | 'all')[]).map((t) => {
                    const selected = draftType === t;

                    return (
                      <Pressable key={t} style={[styles.option, selected && styles.optionSelected]} onPress={() => setDraftType(t)} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                        <View style={[styles.optionIcon, selected && styles.optionIconSelected]}>
                          <Ionicons name={t === 'all' ? 'apps-outline' : TYPE_ICON[t]} size={18} color={selected ? '#ffffff' : colors.textSecondary} />
                        </View>
                        <Text style={styles.optionText}>{t === 'all' ? 'Semua jenis' : TYPE_LABEL[t]}</Text>
                        <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Hanya lead saya</Text>
                <Text style={styles.switchHint}>Yang saya pegang sebagai penanggung jawab</Text>
              </View>
              <Switch value={draftMine} onValueChange={setDraftMine} trackColor={{ true: colors.accent, false: chipColor }} thumbColor="#ffffff" />
            </View>

            <PressableScale style={styles.applyButton} onPress={applySheet} accessibilityRole="button">
              <Text style={styles.applyText}>Terapkan</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>

      {loading ? (
        <SkeletonCards count={4} />
      ) : (
        <FlatList
          data={leads}
          keyExtractor={keyOf}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.accent} /> : null}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            error ? null : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="megaphone-outline" size={34} color={colors.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Belum ada lead</Text>
                <Text style={styles.emptyText}>Lead dari quotation, inquiry produk, dan kemitraan akan muncul di sini.</Text>
              </View>
            )
          }
          renderItem={({ item, index }) => {
            const k = keyOf(item);
            const open = expanded === k;
            const isQuotation = item.type === 'quotation';
            const editable = !isQuotation && (item.status === 'new' || item.status === 'contacted');
            const st = statusStyle(item.status);
            return (
<FadeInUp index={index} enabled={index < 8}>
              <View style={styles.card}>
                <PressableScale
                  scaleTo={0.985}
                  onPress={() => (isQuotation ? router.push(`/staff/quotations/${item.id}` as never) : setExpanded(open ? null : k))}
                  accessibilityRole="button"
                >
                  <View style={styles.cardTopRow}>
                    <View style={styles.typeBadge}>
                      <Ionicons name={TYPE_ICON[item.type]} size={13} color={colors.textSecondary} />
                      <Text style={styles.typeBadgeText}>{TYPE_LABEL[item.type]}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: st.fg }]}>{STATUS_LABEL[item.status]}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardName} numberOfLines={1}>{item.name ?? '—'}</Text>
                  {item.subtitle ? <Text style={styles.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                  <View style={styles.cardBottomRow}>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {[item.store_name, item.owner?.name ? `PJ: ${item.owner.name}` : null, item.outcome ? (item.outcome === 'won' ? 'Deal' : 'Tidak Jadi') : null]
                        .filter(Boolean)
                        .join(' · ') || (item.contact ?? '')}
                    </Text>
                    <Text style={styles.cardMeta}>{formatDate(item.created_at)}</Text>
                  </View>
                </PressableScale>

                {open ? (
                  <View style={styles.expandBox}>
                    {item.contact ? <Text style={styles.contact}>{item.contact}</Text> : null}
                    {item.message ? <Text style={styles.message}>{item.message}</Text> : null}
                    {editable ? (
                      <View style={styles.chipWrap}>
                        {(['new', 'contacted'] as const).map((s) => (
                          <PressableScale key={s} style={[styles.chip, item.status === s && styles.chipActive]} onPress={() => setStatus(item, s)}>
                            <Text style={[styles.chipText, item.status === s && styles.chipTextActive]}>{STATUS_LABEL[s]}</Text>
                          </PressableScale>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.hint}>Status ini diubah lewat panel web.</Text>
                    )}
                    <LeadOutcomePanel
                      embedded
                      endpoint={`/api/staff/lead-inbox/${item.type}/${item.id}`}
                      lead={item}
                      onSaved={(next) => patchLocal(item, next)}
                    />
                  </View>
                ) : null}
              </View>
            </FadeInUp>
);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    headerText: { flex: 1, gap: 2 },
    title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
    addButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },

    tabsRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20, paddingRight: 20, gap: spacing.sm },
    tabsScroll: { flex: 1, flexGrow: 1 },
    tabsContent: { alignItems: 'flex-end', gap: 22, paddingRight: 8 },
    tab: { alignItems: 'center', paddingTop: 8, gap: 7 },
    tabText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
    tabTextActive: { color: colors.textPrimary },
    tabBar: { height: 3, width: '100%', minWidth: 18, borderRadius: 2, backgroundColor: 'transparent' },
    tabBarActive: { backgroundColor: colors.accent },
    filterButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    filterDot: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    filterDotText: { fontSize: 10.5, fontWeight: '800', color: '#ffffff' },
    activeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: 20, paddingTop: spacing.sm },
    activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.accentSoft },
    activeChipText: { fontSize: 12.5, fontWeight: '700', color: isDark ? '#ff6b8f' : '#cc1042' },

    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
    backdropFill: { flex: 1 },
    sheet: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: spacing.md, borderTopLeftRadius: 32, borderTopRightRadius: 32, backgroundColor: isDark ? colors.bg : '#ffffff' },
    sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: line },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },
    sheetReset: { fontSize: 14, fontWeight: '700', color: isDark ? '#ff6b8f' : '#cc1042' },
    sheetLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted, marginBottom: -4 },
    optionList: { gap: 8 },
    option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 20, borderWidth: 1, borderColor: line, backgroundColor: card },
    optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    optionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: chip },
    optionIconSelected: { backgroundColor: colors.accent },
    optionText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: colors.accent },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: line, backgroundColor: card },
    switchText: { flex: 1, gap: 4 },
    switchTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
    switchHint: { fontSize: 12, lineHeight: 18, paddingBottom: 2, color: colors.textMuted },
    applyButton: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 4 },
    applyText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: chip, flexShrink: 0 },
    chipActive: { backgroundColor: colors.accent },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    chipTextActive: { color: '#ffffff' },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },

    listContent: { paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.xxl, flexGrow: 1 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm },

    card: { padding: 16, borderRadius: 24, backgroundColor: card, borderWidth: 1, borderColor: line, marginBottom: spacing.sm + 2, ...shadow },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: chip },
    typeBadgeText: { fontSize: 11.5, fontWeight: '700', color: colors.textSecondary },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
    statusBadgeText: { fontSize: 11.5, fontWeight: '800' },
    cardName: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    cardSubtitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary, marginTop: 2 },
    cardBottomRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: 10 },
    cardMeta: { flexShrink: 1, fontSize: 12, fontWeight: '500', color: colors.textMuted },

    expandBox: { gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: line },
    contact: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
    message: { fontSize: fontSize.sm, lineHeight: 21, color: colors.textSecondary },
    hint: { fontSize: 12, fontWeight: '500', color: colors.textMuted },

    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm, paddingHorizontal: spacing.lg },
    emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line, ...shadow },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    emptyText: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },
  });
}
