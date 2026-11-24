import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { AppText as Text } from '@/components/ui/AppText';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticLight } from '@/lib/haptics';
import { isAllowedRoute, setBadgeCount } from '@/lib/notifications';
import PromoPreferenceCard from '@/components/PromoPreferenceCard';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface CustomerNotification {
  id: number;
  title: string;
  body: string;
  data: { route?: string; params?: Record<string, string> } | null;
  // Backend menghitung ini per-customer (penting untuk notif broadcast,
  // yang statusnya TIDAK bisa diwakili field read_at tunggal karena 1
  // baris dibagi semua customer — lihat catatan di NotificationController).
  is_read: boolean;
  created_at: string;
}

interface NotifResponse {
  data: CustomerNotification[];
  meta: { current_page: number; last_page: number; total: number };
  unread_count: number;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'Baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NotificationsScreen() {
  const { isLoggedIn } = useAuth();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<CustomerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  // Tab jenis pesan: semua, promosi, atau informasi (dikirim ke API sebagai ?category=).
  const [filter, setFilter] = useState<'all' | 'promo' | 'info'>('all');
  const categoryQuery = filter === 'all' ? '' : `category=${filter}`;

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<NotifResponse>(`/api/customer/notifications${categoryQuery ? `?${categoryQuery}` : ''}`);
      setItems(res.data);
      setUnreadCount(res.unread_count);
      setBadgeCount(res.unread_count);
      setCurrentPage(res.meta.current_page);
      setLastPage(res.meta.last_page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat notifikasi.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryQuery]);

  // Backend paginate(30) — tanpa ini, notifikasi lebih dari 30 (90 hari
  // terakhir) tidak akan pernah bisa dilihat sama sekali karena meta
  // pagination-nya dulu diambil tapi tidak pernah dipakai.
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || currentPage >= lastPage) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<NotifResponse>(`/api/customer/notifications?page=${currentPage + 1}${categoryQuery ? `&${categoryQuery}` : ''}`);
      setItems((prev) => [...prev, ...res.data]);
      setCurrentPage(res.meta.current_page);
      setLastPage(res.meta.last_page);
    } catch {
      // Silent — user masih bisa scroll ulang untuk coba lagi (onEndReached
      // akan terpicu lagi), tidak perlu mengganggu dengan alert.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, currentPage, lastPage, categoryQuery]);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchNotifications();
  }, [isLoggedIn, fetchNotifications]);

  const handleTap = async (item: CustomerNotification) => {
    hapticLight();
    // Tandai baca
    if (!item.is_read) {
      setItems((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => {
        const next = Math.max(0, c - 1);
        setBadgeCount(next);
        return next;
      });
      apiFetch(`/api/customer/notifications/${item.id}/read`, { method: 'POST' }).catch(() => {});
    }
    // Deep link kalau ada route — dicek lewat allowlist yang sama dengan push
    // notification masuk (audit Riwayat Notifikasi 2026-09-30, defense-in-depth
    // konsisten dengan lib/notifications.ts).
    if (item.data?.route && isAllowedRoute(item.data.route)) {
      try {
        router.push({ pathname: item.data.route as never, params: item.data.params });
      } catch {
        // Route tidak valid — abaikan agar tidak crash
      }
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    hapticLight();
    setMarkingAll(true);
    try {
      await apiFetch('/api/customer/notifications/read-all', { method: 'POST' });
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      setBadgeCount(0);
    } catch {
      // silent
    } finally {
      setMarkingAll(false);
    }
  };

  // Ikon mengikuti tujuan tautan notifikasi (garansi, booking, promo, voucher, poin); lainnya memakai lonceng.
  const iconFor = (item: CustomerNotification): IconName => {
    const route = item.data?.route ?? '';
    if (route.includes('warrant')) return 'shield-checkmark-outline';
    if (route.includes('booking')) return 'calendar-outline';
    if (route.includes('promo') || route.includes('voucher')) return 'pricetag-outline';
    if (route.includes('point') || route.includes('reward')) return 'gift-outline';
    if (route.includes('invoice')) return 'document-text-outline';
    return 'notifications-outline';
  };

  const renderItem = ({ item, index }: { item: CustomerNotification; index: number }) => {
    const unread = !item.is_read;
    const hasLink = !!item.data?.route;

    return (
      <FadeInUp index={index} enabled={index < 6}>
        <PressableScale
          style={[styles.item, unread && styles.itemUnread]}
          onPress={() => handleTap(item)}
          accessibilityRole="button"
          accessibilityLabel={`${unread ? 'Belum dibaca. ' : ''}${item.title}`}
        >
          <View style={[styles.itemIcon, unread && styles.itemIconUnread]}>
            <Ionicons name={iconFor(item)} size={20} color={unread ? '#ffffff' : colors.textMuted} />
          </View>
          <View style={styles.itemContent}>
            <View style={styles.itemTop}>
              <Text style={[styles.itemTitle, unread && styles.itemTitleBold]} numberOfLines={1}>
                {item.title}
              </Text>
              {unread ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text style={styles.itemBody} numberOfLines={2}>{item.body}</Text>
            <View style={styles.itemFoot}>
              <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
              {hasLink ? (
                <View style={styles.linkHint}>
                  <Text style={styles.linkHintText}>Lihat detail</Text>
                  <Ionicons name="arrow-forward" size={12} color={colors.accent} />
                </View>
              ) : null}
            </View>
          </View>
        </PressableScale>
      </FadeInUp>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle} numberOfLines={1}>Notifikasi</Text>
      </View>

      {!isLoggedIn ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>Masuk dulu</Text>
          <Text style={styles.errorText}>Masuk ke akunmu untuk melihat notifikasi.</Text>
          <PressableScale style={styles.primaryButton} onPress={() => router.push('/auth/login' as never)} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Masuk Sekarang</Text>
          </PressableScale>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="cloud-offline-outline" size={30} color={colors.accent} />
          </View>
          <Text style={styles.errorText}>{error}</Text>
          <PressableScale style={styles.primaryButton} onPress={() => fetchNotifications()} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>Coba Lagi</Text>
          </PressableScale>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNotifications(true)}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListHeaderComponent={
            <>
              <PromoPreferenceCard />
              <View style={styles.segmentRow}>
                {([['all', 'Semua'], ['promo', 'Promo'], ['info', 'Informasi']] as const).map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => setFilter(key)}
                    style={[styles.segmentChip, filter === key && styles.segmentChipActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: filter === key }}
                  >
                    <Text style={[styles.segmentChipText, filter === key && styles.segmentChipTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              {items.length > 0 ? (
                <View style={styles.listHeader}>
                  <Text style={styles.listHeaderCount}>
                    {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
                  </Text>
                  {unreadCount > 0 && (
                    <PressableScale style={styles.markAllBtn} onPress={handleMarkAllRead} disabled={markingAll} accessibilityRole="button">
                      <Ionicons name="checkmark-done-outline" size={16} color={colors.accent} />
                      <Text style={styles.markAllText}>{markingAll ? 'Memproses...' : 'Tandai semua dibaca'}</Text>
                    </PressableScale>
                  )}
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.centerIcon}>
                <Ionicons name="notifications-off-outline" size={30} color={colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>{filter === 'all' ? 'Belum ada notifikasi' : filter === 'promo' ? 'Belum ada promo' : 'Belum ada informasi'}</Text>
              <Text style={styles.emptyText}>
                {filter === 'all'
                  ? 'Notifikasi tentang garansi, booking, dan info produk akan muncul di sini.'
                  : 'Coba tab lain untuk melihat notifikasi jenis lainnya.'}
              </Text>
            </View>
          }
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : styles.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color={colors.accent} size="small" />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { flex: 1, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32, paddingVertical: 48 },
    centerIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    errorText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
    primaryButton: { height: 52, paddingHorizontal: 32, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginTop: 6 },
    primaryButtonText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },

    listContent: { paddingHorizontal: 24, paddingTop: spacing.xs, paddingBottom: 56 },
    emptyContainer: { flexGrow: 1, paddingHorizontal: 24 },

    // Penyaring jenis pesan: satu pil abu muda berisi tiga segmen; yang dipilih merah.
    segmentRow: { flexDirection: 'row', padding: 4, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    segmentChip: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    segmentChipActive: { backgroundColor: colors.accent },
    segmentChipText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
    segmentChipTextActive: { color: '#ffffff', fontWeight: '800' },

    listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4 },
    listHeaderCount: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.accentSoft },
    markAllText: { fontSize: 12, fontWeight: '800', color: colors.accent },

    item: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 14, marginBottom: 10, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    itemUnread: { backgroundColor: colors.accentSoft },
    itemIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, flexShrink: 0 },
    itemIconUnread: { backgroundColor: colors.accent },
    itemContent: { flex: 1, gap: 4 },
    itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    itemTitle: { flex: 1, fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
    itemTitleBold: { color: colors.textPrimary, fontWeight: '800' },
    unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
    itemBody: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
    itemFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
    itemTime: { fontSize: 12, color: colors.textMuted },
    linkHint: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    linkHintText: { fontSize: 12, color: colors.accent, fontWeight: '800' },

    footerLoading: { paddingVertical: spacing.md, alignItems: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    emptyText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center' },
  });
}
