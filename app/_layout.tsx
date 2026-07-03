import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth-context';
import { setupNotifications } from '@/lib/notifications';

export default function RootLayout() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    setupNotifications()
      .then((fn) => {
        cleanup = fn;
      })
      .catch((err) => {
        // Jangan crash app — notifikasi bukan fitur kritis
        console.warn('[RootLayout] Notification setup failed:', err);
      });

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            // Transisi slide dari kanan — smooth, 60fps, tanpa reanimated
            animation: 'slide_from_right',
            animationDuration: 250,
            gestureEnabled: true,
            gestureDirection: 'horizontal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
          <Stack.Screen name="auth/login" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="auth/verify" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="warranty/check" />
          <Stack.Screen name="booking/index" />
          <Stack.Screen name="quotation/index" />
          <Stack.Screen name="partnership/index" />
          <Stack.Screen name="account/my-warranties" />
          <Stack.Screen name="account/my-bookings" />
          <Stack.Screen name="account/edit-profile" />
          <Stack.Screen name="news/index" />
          <Stack.Screen name="news/[slug]" />
          <Stack.Screen name="brand/index" />
          <Stack.Screen name="case/index" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}