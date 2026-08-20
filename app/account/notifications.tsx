import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
import { hapticLight } from '@/lib/haptics';

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

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<NotifResponse>('/api/customer/notifications');
      setItems(res.data);
      setUnreadCount(res.unread_count);
      setCurrentPage(res.meta.current_page);
      setLastPage(res.meta.last_page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat notifikasi.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Backend paginate(30) — tanpa ini, notifikasi lebih dari 30 (90 hari
  // terakhir) tidak akan pernah bisa dilihat sama sekali karena meta
  // pagination-nya dulu diambil tapi tidak pernah dipakai.
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || currentPage >= lastPage) return;
    setLoadingMore(true);
    try {
      const res = await apiFetch<NotifResponse>(`/api/customer/notifications?page=${currentPage + 1}`);
      setItems((prev) => [...prev, ...res.data]);
      setCurrentPage(res.meta.current_page);
      setLastPage(res.meta.last_page);
    } catch {
      // Silent — user masih bisa scroll ulang untuk coba lagi (onEndReached
      // akan terpicu lagi), tidak perlu mengganggu dengan alert.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, currentPage, lastPage]);

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
      setUnreadCount((c) => Math.max(0, c - 1));
      apiFetch(`/api/customer/notifications/${item.id}/read`, { method: 'POST' }).catch(() => {});
    }
    // Deep link kalau ada route
    if (item.data?.route && typeof item.data.route === 'string') {
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
    } catch {
      // silent
    } finally {
      setMarkingAll(false);
    }
  };

  const renderItem = ({ item }: { item: CustomerNotification }) => {
    const unread = !item.is_read;
    const hasLink = !!item.data?.route;

    return (
      <Pressable
        style={[styles.item, unread && styles.itemUnread]}
        onPress={() => handleTap(item)}
      >
        <View style={[styles.dot, unread ? styles.dotActive : styles.dotRead]} />
        <View style={styles.itemContent}>
          <View style={styles.itemTop}>
            <Text style={[styles.itemTitle, unread && styles.itemTitleBold]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
          </View>
          <Text style={styles.itemBody} numberOfLines={2}>{item.body}</Text>
          {hasLink && (
            <View style={styles.linkHint}>
              <Ionicons name="arrow-forward-circle-outline" size={13} color={colors.accent} />
              <Text style={styles.linkHintText}>Lihat detail</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Notifikasi</Text>
        <View style={styles.sideButton} />
      </View>

      {!isLoggedIn ? (
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Login Diperlukan</Text>
          <Text style={styles.errorText}>Masuk ke akun Anda untuk melihat notifikasi.</Text>
          <Pressable style={styles.retryBtn} onPress={() => router.push('/auth/login' as never)}>
            <Text style={styles.retryText}>Masuk Sekarang</Text>
          </Pressable>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => fetchNotifications()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNotifications(true)}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            items.length > 0 ? (
              <View style={styles.listHeader}>
                <Text style={styles.listHeaderCount}>
                  {unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}
                </Text>
                {unreadCount > 0 && (
                  <Pressable onPress={handleMarkAllRead} disabled={markingAll}>
                    <Text style={styles.markAllText}>
                      {markingAll ? 'Memproses...' : 'Tandai semua dibaca'}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="notifications-off-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Notifikasi</Text>
              <Text style={styles.emptyText}>
                Notifikasi tentang garansi, booking, dan info produk akan muncul di sini.
              </Text>
            </View>
          }
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listHeaderCount: { fontSize: fontSize.xs, color: colors.textSecondary },
  markAllText: { fontSize: fontSize.xs, color: colors.accent, fontWeight: '600' },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  itemUnread: { backgroundColor: colors.accentSoft },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    flexShrink: 0,
  },
  dotActive: { backgroundColor: colors.accent },
  dotRead: { backgroundColor: colors.border },
  itemContent: { flex: 1, gap: 4 },
  itemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  itemTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  itemTitleBold: { fontWeight: '700' },
  itemTime: { fontSize: fontSize.xs, color: colors.textMuted, flexShrink: 0 },
  itemBody: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  linkHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  linkHintText: { fontSize: fontSize.xs, color: colors.accent, fontWeight: '600' },
  emptyContainer: { flex: 1 },
  footerLoading: { paddingVertical: spacing.md, alignItems: 'center' },
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  });
}
