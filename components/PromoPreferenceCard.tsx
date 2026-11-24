import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText as Text } from '@/components/ui/AppText';
import { darkColors } from '@/constants/theme';
import { ApiError, apiFetch } from '@/lib/api';
import { useAppTheme } from '@/lib/theme-context';

interface PromoPreference {
  opt_in: boolean;
}

/**
 * Preferensi notifikasi promo (Marketing/Konten Fase 5): opt-in eksplisit, bawaan mati. Hanya mengatur promosi; pesan tentang booking,
 * garansi, dan chat tetap dikirim.
 *
 * Tampilan didesain ulang (2026-11-24): kartu lembut dengan ikon dalam lingkaran dan saklar merah.
 */
export default function PromoPreferenceCard() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [optIn, setOptIn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ data: PromoPreference }>('/api/customer/promo-preference')
      .then((res) => setOptIn(res.data.opt_in))
      .catch(() => setOptIn(null));
  }, []);

  const toggle = useCallback(
    async (next: boolean) => {
      setSaving(true);
      try {
        const res = await apiFetch<{ data: PromoPreference }>('/api/customer/promo-preference', {
          method: 'PUT',
          body: JSON.stringify({ opt_in: next }),
        });
        setOptIn(res.data.opt_in);
      } catch (err) {
        Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menyimpan pilihan. Periksa koneksi internetmu.');
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // Gagal memuat: kartu disembunyikan, daftar notifikasi tetap berfungsi.
  if (optIn === null) return null;

  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <Ionicons name="megaphone-outline" size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Notifikasi promo</Text>
        <Text style={styles.desc}>
          Dapatkan info diskon dan penawaran Ginnva.
        </Text>
      </View>
      {saving ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Switch
          value={optIn}
          onValueChange={toggle}
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
          thumbColor="#ffffff"
          accessibilityLabel="Terima notifikasi promo"
        />
      )}
    </View>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 24, backgroundColor: colors.surfaceElevated, marginBottom: 16 },
    icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
    title: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    desc: { fontSize: 12, lineHeight: 18, color: colors.textMuted, marginTop: 3 },
  });
}
