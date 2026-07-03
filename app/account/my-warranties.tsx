import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { hapticSuccess, hapticError, hapticLight } from '@/lib/haptics';

interface MyWarranty {
  id: number;
  warranty_code: string;
  car_type: string;
  car_plate: string;
  product_series: string;
  expiry_date: string;
  status: string;
  remaining_days: number;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Aktif', color: colors.success, bg: '#e7f8ef' },
  pending_review: { label: 'Menunggu Review', color: colors.warning, bg: '#fef3e2' },
  rejected: { label: 'Ditolak', color: colors.danger, bg: '#fde8e8' },
  expired: { label: 'Kedaluwarsa', color: colors.mutedLight, bg: colors.alt },
};

export default function MyWarrantiesScreen() {
  const [warranties, setWarranties] = useState<MyWarranty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    apiFetch<{ data: MyWarranty[] }>('/api/customer/warranties')
      .then((res) => {
        setWarranties(res.data);
        if (isRefresh) hapticSuccess();
      })
      .catch((err) => {
        setError(
          err instanceof ApiError ? err.message : 'Gagal memuat data garansi Anda.'
        );
        if (isRefresh) hapticError();
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Garansi Saya" />

      {loading ? (
        <View style={styles.skeletonList}>
          {[1, 2, 3].map((i) => <SkeletonCard key={i} style={styles.skeletonItem} />)}
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => { hapticLight(); load(); }}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : warranties.length === 0 ? (
        <View style={styles.centerState}>
          <Ionicons name="shield-outline" size={32} color={colors.mutedLight} />
          <Text style={styles.centerStateText}>
            Belum ada garansi yang terhubung ke akun ini.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => router.push('/warranty/check' as never)}
          >
            <Text style={styles.retryText}>Cek / Daftarkan Garansi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={warranties}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.active;
            return (
              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.code}>{item.warranty_code}</Text>
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.badgeText, { color: meta.color }]}>
                      {meta.label}
                    </Text>
                  </View>
                </View>
                <Text style={styles.productText}>{item.product_series}</Text>
                <Text style={styles.subText}>
                  {item.car_type} ({item.car_plate})
                </Text>
                {item.status === 'active' && (
                  <Text style={styles.remainingText}>
                    Sisa {item.remaining_days} hari masa garansi
                  </Text>
                )}
              </Card>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  retryText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  code: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.ink,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
  },
  productText: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.accent,
  },
  subText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  remainingText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginTop: spacing.xs,
  },
  skeletonList: {
    padding: 16,
    gap: 12,
  },
  skeletonItem: {
    marginBottom: 4,
  },
});