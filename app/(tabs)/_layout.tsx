import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { darkColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Ikon tab: garis (outline) saat tidak aktif, terisi saat aktif, dengan pil
 * lembut di belakangnya sebagai penanda. `palette` dipakai Beranda yang
 * selalu gelap supaya warna pil ikut gelap.
 */
function TabIcon({ outline, filled, focused, color, palette }: {
  outline: IconName;
  filled: IconName;
  focused: boolean;
  color: string;
  palette: typeof darkColors;
}) {
  return (
    <View style={[styles.iconPill, focused && { backgroundColor: palette.accentSoft }]}>
      <Ionicons name={focused ? filled : outline} size={22} color={color} />
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Jarak ke tombol navigasi Android: area aman ditambah 6 supaya label tidak mepet.
  const bottomPad = insets.bottom + 6;

  // Bilah tab: latar sama dengan layar (bukan panel abu terpisah), tanpa
  // garis tebal, label kecil tebal. Tinggi mengikuti area aman perangkat.
  const barStyle = (palette: typeof darkColors) => ({
    backgroundColor: palette.bg,
    borderTopColor: palette.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
    paddingTop: 6,
    paddingBottom: bottomPad,
    height: 54 + bottomPad,
  });

  const icon = (outline: IconName, filled: IconName, palette: typeof darkColors = colors) =>
    ({ focused, color }: { focused: boolean; color: string }) => (
      <TabIcon outline={outline} filled={filled} focused={focused} color={color} palette={palette} />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Pindah tab memudar halus (2026-11-12), bukan berganti mendadak.
        animation: 'fade',
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: barStyle(colors),
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Beranda',
          tabBarIcon: icon('home-outline', 'home', darkColors),
          // Beranda SENGAJA selalu dark (lihat app/(tabs)/index.tsx) —
          // tab bar-nya juga dipaksa dark di sini terlepas dari setting
          // tema global, supaya tidak ada tab bar putih nempel di bawah
          // layar Beranda yang gelap.
          tabBarActiveTintColor: darkColors.accent,
          tabBarInactiveTintColor: darkColors.textMuted,
          tabBarStyle: barStyle(darkColors),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Produk',
          tabBarIcon: icon('pricetags-outline', 'pricetags'),
        }}
      />
      <Tabs.Screen
        name="stores"
        options={{
          title: 'Toko',
          tabBarIcon: icon('storefront-outline', 'storefront'),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: icon('chatbubble-ellipses-outline', 'chatbubble-ellipses'),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Akun Saya',
          tabBarIcon: icon('person-outline', 'person'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconPill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
