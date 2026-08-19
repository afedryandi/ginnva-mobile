import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth-context';
import { StaffAuthProvider } from '@/lib/staff-auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { setupNotifications } from '@/lib/notifications';
import { checkInstallReferrerOnce } from '@/lib/referral-attribution';

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

    // Cek kode referral dari link Play Store (kalau app ini baru saja
    // di-install lewat link ajak-teman) — non-kritis, no-op di iOS.
    checkInstallReferrerOnce().catch(() => {});

    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
      <AuthProvider>
      <StaffAuthProvider>
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
          <Stack.Screen name="auth/staff-forgot-password" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen
            name="auth/complete-profile"
            options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
          />
          <Stack.Screen name="warranty/check" />
          <Stack.Screen name="booking/index" />
          <Stack.Screen name="booking/[id]/chat" />
          <Stack.Screen name="assistant/ai" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="quotation/index" />
          <Stack.Screen name="partnership/index" />
          <Stack.Screen name="account/my-warranties" />
          <Stack.Screen name="account/my-bookings" />
          <Stack.Screen name="account/my-gallery" />
          <Stack.Screen name="account/edit-profile" />
          <Stack.Screen name="news/index" />
          <Stack.Screen name="news/[slug]" />
          <Stack.Screen name="brand/index" />
          <Stack.Screen name="case/index" />
          <Stack.Screen name="inquiry/index" />
          <Stack.Screen name="account/warranty-detail" />
          <Stack.Screen name="account/notifications" />
          <Stack.Screen name="account/points" />
          <Stack.Screen name="account/vouchers" />
          <Stack.Screen name="account/promo" />
          <Stack.Screen name="products/index" />
          <Stack.Screen name="products/[category]" />
          <Stack.Screen name="seri-produk/index" />
          <Stack.Screen name="seri-produk/view" />
          <Stack.Screen name="staff/bookings/index" options={{ animation: 'none' }} />
          <Stack.Screen name="staff/bookings/[id]" />
          <Stack.Screen name="partner/dashboard" options={{ animation: 'none' }} />
          <Stack.Screen name="partner/points" />
          <Stack.Screen name="partner/redemptions" />
          <Stack.Screen name="rewards" />
          <Stack.Screen name="r/[code]" />
        </Stack>
      </StaffAuthProvider>
      </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}