/**
 * lib/notifications.ts
 *
 * Push notification setup via expo-notifications.
 * Menggunakan Expo Push Token — dikirim ke Expo Push Service,
 * yang kemudian forward ke FCM (Android) / APNs (iOS).
 *
 * Di Expo Go (SDK 53+): di-skip secara graceful.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { apiFetch } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function isExpoGo(): boolean {
  return Constants.executionEnvironment === 'storeClient';
}

// Push payload datang dari server TANPA autentikasi (register-token pakai
// skipAuth), jadi `data.route` tidak bisa dipercaya mentah-mentah — hanya
// izinkan navigasi ke path yang memang ada di app ini.
const ALLOWED_ROUTE_PREFIXES = [
  '/(tabs)',
  '/account',
  '/assistant',
  '/booking',
  '/brand',
  '/case',
  '/inquiry',
  '/news',
  '/partner',
  '/partnership',
  '/products',
  '/quotation',
  '/rewards',
  '/seri-produk',
  '/staff',
  '/warranty',
];

export function isAllowedRoute(route: string): boolean {
  if (typeof route !== 'string' || !route.startsWith('/')) return false;
  return ALLOWED_ROUTE_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export async function setupNotifications(): Promise<() => void> {
  if (isExpoGo()) {
    console.log('[Notifications] Expo Go — skipped.');
    return () => {};
  }

  if (!Device.isDevice) {
    console.log('[Notifications] Emulator — skipped.');
    return () => {};
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted.');
    return () => {};
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Ginnva',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C8A96E',
    });
  }

  let token: string | null = null;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('[Notifications] projectId tidak ditemukan di app.json.');
      return () => {};
    }

    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
    console.log('[Notifications] Expo push token:', token);
  } catch (err) {
    console.warn('[Notifications] Failed to get push token:', err);
    return () => {};
  }

  // Daftarkan token ke backend
  try {
    await apiFetch('/api/notifications/register-token', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }),
    });
    console.log('[Notifications] Token registered to backend.');
  } catch (err) {
    console.warn('[Notifications] Failed to register token:', err);
  }

  const foregroundSub = Notifications.addNotificationReceivedListener((notification) => {
    console.log('[Notifications] Foreground:', notification);
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as {
      route?: string;
      params?: Record<string, string>;
    };
    console.log('[Notifications] Tapped, data:', data);
    if (data?.route && isAllowedRoute(data.route)) {
      // Delay kecil supaya router sudah mount setelah app dibuka dari background
      setTimeout(() => {
        router.push({ pathname: data.route as never, params: data.params });
      }, 300);
    } else if (data?.route) {
      console.warn('[Notifications] Blocked navigation to disallowed route:', data.route);
    }
  });

  return () => {
    foregroundSub.remove();
    responseSub.remove();
  };
}

export async function linkTokenToCustomer(token: string): Promise<void> {
  try {
    await apiFetch('/api/notifications/link-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  } catch (err) {
    console.warn('[Notifications] Failed to link token:', err);
  }
}

export async function getCurrentPushToken(): Promise<string | null> {
  if (!Device.isDevice || isExpoGo()) return null;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return null;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Set badge count di icon app ke angka PASTI (dari unread_count backend) --
 * diperbaiki 2026-10-01, audit Notifikasi. SEBELUMNYA shouldSetBadge: true
 * diset di handler (atas) tapi setBadgeCountAsync TIDAK PERNAH dipanggil
 * di mana pun — badge terus bertambah otomatis oleh OS tiap ada push
 * masuk tapi tidak pernah berkurang/reset walau user sudah baca semua
 * notifikasi di app. Dipanggil dari layar riwayat notifikasi (Customer &
 * Partner) tiap kali unread_count berubah (fetch/tap/mark-all-read).
 */
export async function setBadgeCount(count: number): Promise<void> {
  if (!Device.isDevice || isExpoGo()) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // Badge gagal di-set (mis. permission dicabut) -- bukan hal fatal,
    // diamkan saja, tidak perlu mengganggu UI.
  }
}