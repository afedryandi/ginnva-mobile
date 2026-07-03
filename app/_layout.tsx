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
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
