import React, { useMemo } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/ui/AppText';
import { darkColors, fontSize, radius } from '@/constants/theme';
import { toWhatsAppNumber } from '@/lib/phone';
import { useAppTheme } from '@/lib/theme-context';

export interface WhatsAppBookingInfo {
  phone: string;
  customerName: string;
  bookingNumber: string;
  service: string;
  store: string;
  dateLabel: string;
  time: string | null;
  ready: boolean;
}

interface Props {
  visible: boolean;
  info: WhatsAppBookingInfo | null;
  onClose: () => void;
}

const TEMPLATE_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  confirm: 'calendar-outline',
  remind: 'alarm-outline',
  ready: 'car-sport-outline',
};

/**
 * Tombol "Kabari via WhatsApp" (Fase 4): staf memilih pesan siap pakai lalu WhatsApp terbuka dengan teks terisi; staf yang menekan
 * kirim (tanpa WhatsApp Business API berbayar). Pesan menyebut nama, layanan, toko, tanggal, dan jam.
 * Tampilan dirancang ulang 2026-11-18: lembar bawah dengan satu kartu per pesan.
 */
export default function WhatsAppTemplatesModal({ visible, info, onClose }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const templates = useMemo(() => {
    if (!info) return [];
    const when = `${info.dateLabel}${info.time ? ` pukul ${info.time}` : ''}`;
    const hi = `Halo ${info.customerName}, `;
    const list = [
      { key: 'confirm', label: 'Konfirmasi jadwal', text: `${hi}booking ${info.service} Anda di ${info.store} (${info.bookingNumber}) dijadwalkan ${when}. Mohon konfirmasi kehadirannya ya. Terima kasih.` },
      { key: 'remind', label: 'Pengingat jadwal', text: `${hi}kami mengingatkan jadwal ${info.service} Anda di ${info.store} pada ${when}. Jika berhalangan, mohon kabari kami atau ubah jadwal dari aplikasi Ginnva.` },
    ];
    if (info.ready) {
      list.push({ key: 'ready', label: 'Kendaraan siap diambil', text: `${hi}kendaraan Anda (booking ${info.bookingNumber}) sudah selesai dan siap diambil di ${info.store}. Terima kasih sudah mempercayakan kepada kami.` });
    }
    return list;
  }, [info]);

  const send = async (text: string) => {
    if (!info) return;
    const url = `https://wa.me/${toWhatsAppNumber(info.phone)}?text=${encodeURIComponent(text)}`;
    try {
      await Linking.openURL(url);
      onClose();
    } catch {
      Alert.alert('WhatsApp tidak bisa dibuka', 'Pastikan WhatsApp terpasang di perangkat ini.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Tutup">
        <SafeAreaView edges={['bottom']} style={styles.sheetWrap}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />

            <View style={styles.head}>
              <View style={styles.headIcon}>
                <Ionicons name="logo-whatsapp" size={24} color="#ffffff" />
              </View>
              <View style={styles.headText}>
                <Text style={styles.title}>Kabari via WhatsApp</Text>
                {!!info && <Text style={styles.sub} numberOfLines={1}>{info.customerName} · {info.phone}</Text>}
              </View>
            </View>

            <View style={styles.list}>
              {templates.map((t) => (
                <Pressable key={t.key} onPress={() => send(t.text)} style={styles.row} accessibilityRole="button" accessibilityLabel={`Kirim pesan ${t.label}`}>
                  <View style={styles.rowIcon}>
                    <Ionicons name={TEMPLATE_ICON[t.key] ?? 'chatbubble-outline'} size={20} color={colors.success} />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle}>{t.label}</Text>
                  </View>
                  <Ionicons name="paper-plane-outline" size={18} color={colors.textMuted} />
                </Pressable>
              ))}
            </View>

            <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
              <Text style={styles.cancelText}>Batal</Text>
            </Pressable>
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: typeof darkColors, isDark: boolean) => {
  const chip = isDark ? colors.surfaceElevated : '#efeff4';

  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheetWrap: { backgroundColor: isDark ? colors.bg : '#ffffff', borderTopLeftRadius: 32, borderTopRightRadius: 32 },
    sheet: { gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },

    head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    headIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#25d366' },
    headText: { flex: 1, gap: 2 },
    title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, color: colors.textPrimary },
    sub: { fontSize: 13, fontWeight: '500', color: colors.textMuted },

    list: { gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: chip },
    rowIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successBg },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary },

    cancel: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    cancelText: { fontSize: fontSize.sm + 1, fontWeight: '700', color: colors.textSecondary },
  });
};
