import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { colors, fontSize, spacing, radius } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';

const MENU_ITEMS = [
  { key: 'warranties', label: 'Garansi Saya', icon: 'shield-checkmark-outline' as const, route: '/account/my-warranties' },
  { key: 'bookings', label: 'Booking Saya', icon: 'calendar-outline' as const, route: '/account/my-bookings' },
  { key: 'check', label: 'Cek Garansi', icon: 'search-outline' as const, route: '/warranty/check' },
  { key: 'stores', label: 'Cari Toko', icon: 'storefront-outline' as const, route: '/(tabs)/stores' },
  { key: 'quotation', label: 'Ajukan Penawaran', icon: 'document-text-outline' as const, route: '/quotation' },
  { key: 'partnership', label: 'Ajukan Kemitraan', icon: 'business-outline' as const, route: '/partnership' },
];

export default function AccountScreen() {
  const { customer, isLoading, isLoggedIn, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert('Keluar Akun', 'Anda yakin ingin keluar?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Keluar', style: 'destructive', onPress: logout },
    ]);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centerState} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Akun</Text>
        </View>

        {isLoggedIn && customer ? (
          <Card style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(customer.name || customer.email || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{customer.name || 'Pengguna Ginnva'}</Text>
              <Text style={styles.profileEmail}>{customer.email}</Text>
              {customer.phone_number ? (
                <Text style={styles.profilePhone}>{customer.phone_number}</Text>
              ) : (
                <Text style={styles.profilePhoneMissing}>Belum ada nomor WA</Text>
              )}
            </View>
            <Pressable
              style={styles.editButton}
              onPress={() => router.push('/account/edit-profile' as never)}
            >
              <Ionicons name="pencil-outline" size={18} color={colors.accent} />
            </Pressable>
          </Card>
        ) : (
          <Card style={styles.loginCard}>
            <Ionicons name="person-circle-outline" size={40} color={colors.accent} />
            <Text style={styles.loginTitle}>Masuk untuk Pengalaman Lebih Lengkap</Text>
            <Text style={styles.loginSubtitle}>
              Simpan riwayat garansi Anda dan dapatkan akses lebih cepat ke layanan
              after-sales.
            </Text>
            <Button
              label="Masuk / Daftar"
              onPress={() => router.push('/auth/login' as never)}
              style={styles.loginButton}
            />
          </Card>
        )}

        <View style={styles.menuList}>
          {MENU_ITEMS.map((item) => (
            <Pressable
              key={item.key}
              style={styles.menuRow}
              onPress={() => router.push(item.route as never)}
            >
              <Ionicons name={item.icon} size={20} color={colors.ink} />
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedLight} />
            </Pressable>
          ))}
        </View>

        {isLoggedIn && (
          <Pressable style={styles.logoutRow} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.logoutLabel}>Keluar</Text>
          </Pressable>
        )}

        <Text style={styles.versionText}>Ginnva Shield Indonesia · v1.0</Text>
      </ScrollView>
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
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.ink,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.white,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
  },
  profileEmail: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 2,
  },
  profilePhone: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  profilePhoneMissing: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginTop: 2,
    fontStyle: 'italic',
  },
  editButton: {
    padding: spacing.xs,
  },
  loginCard: {
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    paddingVertical: spacing.lg,
  },
  loginTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  loginSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  loginButton: {
    marginTop: spacing.md,
    width: '100%',
  },
  menuList: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  menuLabel: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.ink,
    fontWeight: '600',
  },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  logoutLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.danger,
  },
  versionText: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});