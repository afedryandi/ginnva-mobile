import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { ApiError, staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';

const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'telepon', label: 'Telepon' },
  { key: 'walk_in', label: 'Datang Langsung' },
  { key: 'instagram_dm', label: 'DM Instagram' },
  { key: 'lainnya', label: 'Lainnya' },
] as const;

const INTERESTS = [
  { key: 'ppf', label: 'PPF' },
  { key: 'kaca_film', label: 'Kaca Film' },
  { key: 'detailing', label: 'Detailing' },
  { key: 'premium_wash', label: 'Premium Wash' },
  { key: 'color_change', label: 'Color Change' },
  { key: 'kaca_bangunan', label: 'Kaca Bangunan' },
  { key: 'lainnya', label: 'Lainnya' },
] as const;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Catat lead manual (Marketing/Konten Fase 0): lead dari WhatsApp, telepon, DM, atau datang langsung yang tidak punya jejak otomatis.
 * Disimpan sebagai Inquiry Produk dengan kanal yang dipilih; kampanye diisi bila diketahui (mis. nama iklan yang disebut pelanggan).
 */
export default function LeadLogModal({ visible, onClose, onSaved }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [campaign, setCampaign] = useState('');
  const [channel, setChannel] = useState<string | null>(null);
  const [interest, setInterest] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim().length > 0 && contact.trim().length > 0 && channel !== null && !saving;

  const reset = () => {
    setName('');
    setContact('');
    setMessage('');
    setCampaign('');
    setChannel(null);
    setInterest(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      await staffApiFetch('/api/staff/leads', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: name.trim(),
          customer_contact: contact.trim(),
          message: message.trim() || null,
          channel,
          interest,
          campaign: campaign.trim() || null,
        }),
      });
      Alert.alert('Tersimpan', 'Lead dicatat.');
      reset();
      onSaved?.();
      onClose();
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menyimpan lead. Periksa koneksi internet.');
    } finally {
      setSaving(false);
    }
  };

  const Chips = ({ items, value, onPick }: { items: readonly { key: string; label: string }[]; value: string | null; onPick: (k: string | null) => void }) => (
    <View style={styles.chipWrap}>
      {items.map((it) => (
        <Pressable
          key={it.key}
          onPress={() => onPick(value === it.key ? null : it.key)}
          style={[styles.chip, value === it.key && styles.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === it.key }}
        >
          <Text style={[styles.chipText, value === it.key && styles.chipTextOn]}>{it.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Catat Lead</Text>
            <Text style={styles.subtitle}>Dari WhatsApp, telepon, DM, atau datang langsung</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Tutup" hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Dari mana lead ini datang? *</Text>
            <Chips items={CHANNELS} value={channel} onPick={setChannel} />

            <Text style={styles.label}>Nama *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Nama pelanggan" placeholderTextColor={colors.textMuted} maxLength={255} />

            <Text style={styles.label}>Kontak (HP atau email) *</Text>
            <TextInput style={styles.input} value={contact} onChangeText={setContact} placeholder="08xxxxxxxxxx" placeholderTextColor={colors.textMuted} keyboardType="default" maxLength={255} />

            <Text style={styles.label}>Minat</Text>
            <Chips items={INTERESTS} value={interest} onPick={setInterest} />

            <Text style={styles.label}>Yang ditanyakan</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              value={message}
              onChangeText={setMessage}
              placeholder="Ringkasan pertanyaan atau kebutuhan pelanggan"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
            />

            <Text style={styles.label}>Kampanye / iklan (bila tahu)</Text>
            <TextInput style={styles.input} value={campaign} onChangeText={setCampaign} placeholder="mis. nama iklan Instagram yang disebut pelanggan" placeholderTextColor={colors.textMuted} maxLength={150} />
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.footer}>
          <PressableScale onPress={save} disabled={!canSave} style={[styles.save, !canSave && { opacity: 0.4 }]} accessibilityRole="button">
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Simpan Lead</Text>}
          </PressableScale>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: typeof darkColors, isDark: boolean) => {
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary },
    subtitle: { fontSize: 12.5, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
    closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: card, borderWidth: 1, borderColor: line },
    body: { paddingHorizontal: 20, paddingBottom: spacing.xl },
    label: { color: colors.textMuted, fontWeight: '700', fontSize: 13, marginTop: spacing.lg, marginBottom: spacing.sm, marginLeft: 4 },
    input: {
      borderRadius: 18, paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 14 : 12,
      color: colors.textPrimary, backgroundColor: card, borderWidth: 1, borderColor: line, fontSize: fontSize.sm,
    },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: chip },
    chipOn: { backgroundColor: colors.accent },
    chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: '#ffffff' },
    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: screenBg, borderTopWidth: 1, borderTopColor: line },
    save: {
      height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.accent,
      shadowColor: colors.accent, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20, elevation: 4,
    },
    saveText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.base },
  });
};
