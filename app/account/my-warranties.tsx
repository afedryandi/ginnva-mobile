import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';
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

function getStatusMeta(colors: typeof darkColors): Record<string, { label: string; color: string; bg: string }> {
  return {
    active: { label: 'Aktif', color: colors.success, bg: colors.successBg },
    pending_review: { label: 'Menunggu Review', color: colors.warning, bg: colors.warningBg },
    rejected: { label: 'Ditolak', color: colors.danger, bg: colors.dangerBg },
    expired: { label: 'Kedaluwarsa', color: colors.textMuted, bg: colors.surface },
  };
}

export default function MyWarrantiesScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const STATUS_META = useMemo(() => getStatusMeta(colors), [colors]);

  const [warranties, setWarranties] = useState<MyWarranty[]>([]);
  const { isLoggedIn } = useAuth();
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

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => load(true)}
      colors={[colors.accent]}
      tintColor={colors.accent}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Garansi Saya</Text>
        <View style={styles.sideButton} />
      </View>

      {!isLoggedIn ? (
        <ScrollView
          contentContainerStyle={styles.centerState}
          refreshControl={refreshControl}
        >
          <Ionicons name="lock-closed-outline" size={36} color={colors.textMuted} />
          <Text style={styles.centerStateTitle}>Login Diperlukan</Text>
          <Text style={styles.centerStateText}>
            Masuk ke akun Anda untuk melihat garansi Anda.
          </Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => router.push('/auth/login' as never)}
          >
            <Text style={styles.retryText}>Masuk Sekarang</Text>
          </Pressable>
        </ScrollView>
      ) : loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <ScrollView
          contentContainerStyle={styles.centerState}
          refreshControl={refreshControl}
        >
          <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => { hapticLight(); load(); }}>
            <Text style={styles.retryText}>Coba Lagi</Text>
          </Pressable>
        </ScrollView>
      ) : warranties.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.centerState}
          refreshControl={refreshControl}
        >
          <Ionicons name="shield-outline" size={32} color={colors.textMuted} />
          <Text style={styles.centerStateTitle}>Belum Ada Garansi</Text>
          <Text style={styles.centerStateText}>
            Garansi Anda akan muncul di sini setelah admin menghubungkannya ke akun Anda.
          </Text>
        </ScrollView>
      ) : (
        <FlatList
          data={warranties}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={refreshControl}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.active;
            return (
              <Pressable
                onPress={() => {
                  hapticLight();
                  router.push(`/account/warranty-detail?id=${item.id}` as never);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.code}>{item.warranty_code}</Text>
                    <View style={styles.cardHeaderRight}>
                      <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.badgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
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
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
  centerState: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  centerStateTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  centerStateText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
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
    color: '#ffffff',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  code: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.textPrimary,
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
    color: colors.textSecondary,
  },
  remainingText: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  });
}
