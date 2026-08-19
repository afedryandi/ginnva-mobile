import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { darkColors } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';

export default function TabsLayout() {
  const { colors } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Beranda',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          // Beranda SENGAJA selalu dark (lihat app/(tabs)/index.tsx) —
          // tab bar-nya juga dipaksa dark di sini terlepas dari setting
          // tema global, supaya tidak ada tab bar putih nempel di bawah
          // layar Beranda yang gelap.
          tabBarActiveTintColor: darkColors.accent,
          tabBarInactiveTintColor: darkColors.textMuted,
          tabBarStyle: {
            backgroundColor: darkColors.surface,
            borderTopColor: darkColors.border,
          },
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Produk',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pricetags" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stores"
        options={{
          title: 'Toko',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="storefront" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Asisten',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-ellipses" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Akun Saya',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}