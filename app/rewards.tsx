import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';

interface Reward {
  id: number;
  name: string;
  description: string | null;
  image: string | null;
  points_cost: number;
  stock: number | null;
}

// Layar katalog reward customer — penukaran reward Partner SENGAJA
// tatap muka langsung di toko (lihat app/partner/dashboard.tsx), bukan
// self-service lewat app, jadi layar ini tidak lagi punya jalur partner.
export default function RewardsScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isLoggedIn: loggedIn } = useAuth();

  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<number | null>(null);
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRewards = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: Reward[] }>('/api/rewards', { skipAuth: true });
      setRewards(res.data ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat katalog reward.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchRewards(); }, [fetchRewards]);

  // Saldo poin sendiri — supaya user tahu reward mana yang terjangkau
  // tanpa harus keluar ke layar Poin & balik lagi. Best-effort: kalau
  // belum login atau fetch gagal, cukup jangan ditampilkan (bukan
  // bagian kritis dari alur, jadi tidak perlu error state sendiri).
  useEffect(() => {
    if (!loggedIn) {
      setPointsBalance(null);
      return;
    }
    apiFetch<{ balance: number }>('/api/customer/points')
      .then((res) => setPointsBalance(res.balance))
      .catch(() => {});
  }, [loggedIn]);

  const handleRedeem = (reward: Reward) => {
    Alert.alert(
      'Tukar Reward',
      `Tukar ${reward.points_cost.toLocaleString('id-ID')} poin dengan "${reward.name}"?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Tukar',
          onPress: async () => {
            setRedeemingId(reward.id);
            try {
              const res = await apiFetch<{ message: string }>(
                `/api/customer/rewards/${reward.id}/redeem`,
                { method: 'POST' }
              );

              setPointsBalance((prev) => (prev !== null ? prev - reward.points_cost : prev));
              Alert.alert('Berhasil', res.message);
              router.back();
            } catch (err) {
              const message = err instanceof ApiError
                ? err.message
                : 'Gagal menukar reward. Silakan coba lagi.';
              Alert.alert('Gagal', message);
            } finally {
              setRedeemingId(null);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: Reward }) => {
    const insufficientPoints = pointsBalance !== null && item.points_cost > pointsBalance;
    return (
      <View style={styles.card}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.cardImage} />
        ) : (
          <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
            <Ionicons name="gift-outline" size={28} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
          {item.description && (
            <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          )}
          <View style={styles.cardFooter}>
            <View style={styles.pointsBadge}>
              <Ionicons name="star" size={12} color={colors.accent} />
              <Text style={styles.pointsBadgeText}>{item.points_cost.toLocaleString('id-ID')} poin</Text>
            </View>
            <Pressable
              style={[
                styles.redeemBtn,
                (redeemingId === item.id || insufficientPoints) && styles.redeemBtnDisabled,
              ]}
              disabled={redeemingId === item.id || insufficientPoints}
              onPress={() => handleRedeem(item)}
            >
              {redeemingId === item.id ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.redeemBtnText}>
                  {insufficientPoints ? 'Poin Kurang' : 'Tukar'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
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
        <Text style={styles.headerTitle} numberOfLines={1}>Tukar Poin</Text>
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
          <Pressable style={styles.retryBtn} onPress={() => fetchRewards()}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rewards}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchRewards(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            pointsBalance !== null ? (
              <View style={styles.balanceBox}>
                <Ionicons name="star" size={16} color={colors.accent} />
                <Text style={styles.balanceText}>
                  Poin kamu: <Text style={styles.balanceValue}>{pointsBalance.toLocaleString('id-ID')}</Text>
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="gift-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Belum Ada Reward</Text>
              <Text style={styles.emptyText}>Katalog reward akan segera hadir.</Text>
            </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  errorText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: { color: '#ffffff', fontWeight: '600', fontSize: fontSize.sm },

  listContent: { padding: spacing.md, gap: spacing.md },

  balanceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  balanceText: { fontSize: fontSize.sm, color: colors.textSecondary },
  balanceValue: { fontWeight: '800', color: colors.accent },

  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardImage: { width: 72, height: 72, borderRadius: radius.md },
  cardImagePlaceholder: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 4, justifyContent: 'center' },
  cardName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  cardDesc: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 16 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pointsBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.accent },
  redeemBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    minWidth: 64,
    alignItems: 'center',
  },
  redeemBtnDisabled: { opacity: 0.6 },
  redeemBtnText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.xs },

  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });
}
