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
    const data = response.notification.request.content.data;
    console.log('[Notifications] Tapped, data:', data);
    // TODO: handle deep link
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