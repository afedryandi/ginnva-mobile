import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, type LayoutChangeEvent } from 'react-native';

/**
 * Mengangkat kartu di dalam <Modal> tepat di atas keyboard, tidak lebih.
 *
 * Modal RN di Android punya window sendiri. Tergantung versi Android dan pengaturan layar penuh (edge-to-edge), window itu kadang
 * SUDAH dikecilkan oleh sistem saat keyboard muncul, kadang belum. Mengangkat kartu sebesar tinggi keyboard secara membabi buta
 * (cara lama) menjadi dua kali lipat pada kasus pertama: kartu melayang jauh di atas keyboard dengan celah kosong di antaranya.
 *
 * Cara kerja di sini tidak bergantung pada tebakan itu: tinggi dasar wadah (backdrop) tanpa keyboard diingat, lalu setelah keyboard muncul
 * dihitung berapa banyak wadah itu sudah mengecil. Kartu hanya diangkat sebesar sisanya:
 *   - window belum dikecilkan: sisa = tinggi keyboard (kartu naik penuh)
 *   - window sudah dikecilkan penuh: sisa = 0 (kartu sudah di atas keyboard)
 *
 * Pakai: onLayout={onBoxLayout} pada backdrop modal, lalu style kartu { marginBottom: lift } dan, bila keyboardVisible, kurangi padding bawah
 * (padding untuk area gesture sistem tidak perlu lagi karena keyboard sudah menutupinya).
 */
export function useKeyboardLift() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);
  // Tinggi wadah terbesar yang pernah terlihat (= tanpa keyboard). Dipakai sebagai dasar karena urutan kejadian "keyboard muncul" dan
  // "wadah mengecil" tidak terjamin.
  const baseHeight = useRef(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    // Putar layar atau lipat perangkat mengubah ukuran dasar: ukur ulang.
    const dimensionSub = Dimensions.addEventListener('change', () => {
      baseHeight.current = 0;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
      dimensionSub.remove();
    };
  }, []);

  const onBoxLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    baseHeight.current = Math.max(baseHeight.current, height);
    setBoxHeight(height);
  }, []);

  const shrunk = keyboardHeight > 0 && baseHeight.current > 0 ? Math.max(0, baseHeight.current - boxHeight) : 0;
  const lift = Math.max(0, keyboardHeight - shrunk);

  return { keyboardHeight, keyboardVisible: keyboardHeight > 0, lift, onBoxLayout };
}
