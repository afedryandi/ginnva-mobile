import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * expo-secure-store butuh Keychain (iOS)/Keystore (Android) — modul
 * native-nya TIDAK ADA di web ("getValueWithKeyAsync is not a function"
 * saat dijalankan via `expo start --web`). Fallback ke localStorage
 * browser biasa khusus di web — bukan "secure storage" sungguhan, tapi
 * app ini memang cuma menyasar iOS/Android untuk produksi; web cuma
 * dipakai untuk preview/testing cepat.
 */
const isWeb = Platform.OS === 'web';

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
