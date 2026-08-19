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
import { staffApiFetch, ApiError } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { hapticLight } from '@/lib/haptics';

interface PartnerNotification {
  id: number;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

interface NotifResponse {
  data: PartnerNotification[];
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

export default function PartnerNotificationsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [items, setItems] = useState<PartnerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await staffApiFetch<NotifResponse>('/api/partner/notifications');
      setItems(res.data);
      setUnreadCount(res.unread_count);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat notifikasi.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleTap = async (item: PartnerNotification) => {
    if (item.is_read) return;
    hapticLight();
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    staffApiFetch(`/api/partner/notifications/${item.id}/read`, { method: 'POST' }).catch(() => {});
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    hapticLight();
    setMarkingAll(true);
    try {
      await staffApiFetch('/api/partner/notifications/read-all', { method: 'POST' });
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // silent
    } finally {
      setMarkingAll(false);
    }
  };

  const renderItem = ({ item }: { item: PartnerNotification }) => {
    const unread = !item.is_read;

    return (
      <Pressable style={[styles.item, unread && styles.itemUnread]} onPress={() => handleTap(item)}>
        <View style={[styles.dot, unread ? styles.dotActive : styles.dotRead]} />
        <View style={styles.itemContent}>
          <View style={styles.itemTop}>
            <Text style={[styles.itemTitle, unread && styles.itemTitleBold]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.itemTime}>{timeAgo(item.created_at)}</Text>
          </View>
          <Text style={styles.itemBody} numberOfLines={3}>{item.body}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.sideButton}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Notifikasi</Text>
        <View style={styles.sideButton} />
      </View>

      {loading ? (
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
            <RefreshControl refreshing={refreshing} onRefresh={() => fetchNotifications(true)} tintColor={colors.accent} />
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
                Info poin, promo, dan pengumuman untuk mitra referral akan muncul di sini.
              </Text>
            </View>
          }
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : undefined}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
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
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0 },
  dotActive: { backgroundColor: colors.accent },
  dotRead: { backgroundColor: colors.border },
  itemContent: { flex: 1, gap: 4 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  itemTitle: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  itemTitleBold: { fontWeight: '700' },
  itemTime: { fontSize: fontSize.xs, color: colors.textMuted, flexShrink: 0 },
  itemBody: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 19 },
  emptyContainer: { flex: 1 },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
