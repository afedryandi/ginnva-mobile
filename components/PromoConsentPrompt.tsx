import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAppTheme } from '@/lib/theme-context';

interface PromoPreference {
  opt_in: boolean;
  prompted: boolean;
}

/**
 * Pertanyaan persetujuan promo sekali saja untuk pelanggan yang sudah masuk (Marketing/Konten Fase 5). Tidak ada pilihan yang
 * dicentang di muka; "Ya" maupun "Tidak" menandai pelanggan sudah ditanya, jadi tidak muncul lagi. Bisa diubah kapan saja di layar
 * Notifikasi. Tidak bisa ditutup tanpa memilih supaya jawabannya selalu pilihan sadar pelanggan.
 */
export default function PromoConsentPrompt() {
  const { isLoggedIn } = useAuth();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState<'yes' | 'no' | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setVisible(false);
      return;
    }

    let cancelled = false;
    apiFetch<{ data: PromoPreference }>('/api/customer/promo-preference')
      .then((res) => {
        if (!cancelled) setVisible(!res.data.prompted);
      })
      .catch(() => {
        // Gagal memuat: jangan tanya sekarang, coba lagi di pembukaan berikutnya.
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const choose = async (optIn: boolean) => {
    setSaving(optIn ? 'yes' : 'no');
    try {
      await apiFetch('/api/customer/promo-preference', { method: 'PUT', body: JSON.stringify({ opt_in: optIn }) });
      setVisible(false);
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menyimpan pilihan. Periksa koneksi internetmu.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { /* sengaja tidak bisa ditutup tanpa memilih */ }}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Mau dapat info promo dari Ginnva?</Text>
          <Text style={styles.body}>
            Kami bisa mengirim kabar diskon dan penawaran lewat notifikasi, paling banyak beberapa kali seminggu. Pesan penting tentang booking
            dan garansimu tetap dikirim apa pun pilihanmu.
          </Text>
          <Text style={styles.note}>Bisa kamu ubah kapan saja di layar Notifikasi.</Text>

          <Pressable
            style={[styles.primary, saving !== null && { opacity: 0.6 }]}
            disabled={saving !== null}
            onPress={() => choose(true)}
            accessibilityRole="button"
          >
            {saving === 'yes' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Ya, kirimi saya promo</Text>}
          </Pressable>
          <Pressable
            style={[styles.secondary, saving !== null && { opacity: 0.6 }]}
            disabled={saving !== null}
            onPress={() => choose(false)}
            accessibilityRole="button"
          >
            {saving === 'no' ? <ActivityIndicator color={colors.textSecondary} /> : <Text style={styles.secondaryText}>Tidak, terima kasih</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    card: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
    title: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
    body: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
    note: { fontSize: fontSize.xs, color: colors.textMuted },
    primary: { marginTop: spacing.sm, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.md, backgroundColor: colors.accent },
    primaryText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.base },
    secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
    secondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: fontSize.base },
  });
}
