import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { ApiError, staffApiFetch } from '@/lib/staff-api';
import { useStaffAuth } from '@/lib/staff-auth-context';
import { useAppTheme } from '@/lib/theme-context';

export interface LeadOutcomeFields {
  owner_user_id: number | null;
  owner?: { id: number; name: string } | null;
  outcome: 'won' | 'lost' | null;
  outcome_reason: string | null;
  outcome_note?: string | null;
}

const OUTCOMES = [
  { key: 'won', label: 'Deal' },
  { key: 'lost', label: 'Tidak Jadi' },
] as const;

const REASONS = [
  { key: 'harga', label: 'Harga di atas anggaran' },
  { key: 'beli_di_tempat_lain', label: 'Memilih penyedia lain' },
  { key: 'tidak_merespons', label: 'Tidak merespons lagi' },
  { key: 'belum_butuh', label: 'Belum butuh / menunda' },
  { key: 'lokasi_jauh', label: 'Lokasi terlalu jauh' },
  { key: 'tidak_sesuai_kebutuhan', label: 'Layanan tidak sesuai' },
  { key: 'lainnya', label: 'Lainnya' },
] as const;

interface Props {
  /** PATCH endpoint untuk lead ini, mis. /api/staff/quotations/12/lead atau /api/staff/lead-inbox/partnership/3 */
  endpoint: string;
  lead: LeadOutcomeFields;
  /** Dipanggil dengan data lead terbaru dari server setelah tersimpan. */
  onSaved: (lead: LeadOutcomeFields) => void;
  /** Dipakai di dalam kartu lain (daftar Lead): tanpa bingkai dan bayangan sendiri. */
  embedded?: boolean;
}

/**
 * Pemilik dan hasil lead (Marketing/Konten Fase 1): staf bisa mengambil lead sebagai penanggung jawabnya, lalu menandai Deal atau
 * Tidak Jadi (alasan wajib bila Tidak Jadi). Dipakai di detail Lead Quotation dan daftar Lead Masuk.
 */
export default function LeadOutcomePanel({ endpoint, lead, onSaved, embedded }: Props) {
  const { theme, colors } = useAppTheme();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { staff } = useStaffAuth();

  const [outcome, setOutcome] = useState<LeadOutcomeFields['outcome']>(lead.outcome);
  const [reason, setReason] = useState<string | null>(lead.outcome_reason);
  const [note, setNote] = useState<string>(lead.outcome_note ?? '');
  const [saving, setSaving] = useState(false);

  const ownerLabel = lead.owner?.name ?? (lead.owner_user_id ? 'Karyawan lain' : 'Belum ada penanggung jawab');
  const isMine = !!staff && lead.owner_user_id === staff.id;
  const needsNote = outcome === 'lost' && reason === 'lainnya';
  const dirty = outcome !== lead.outcome || (outcome === 'lost' && (reason !== lead.outcome_reason || (needsNote && note.trim() !== (lead.outcome_note ?? ''))));
  const canSave = dirty && !saving && (outcome !== 'lost' || !!reason) && (!needsNote || note.trim().length > 0);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await staffApiFetch<{ data: LeadOutcomeFields }>(endpoint, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved(res.data);
      return true;
    } catch (err) {
      Alert.alert('Gagal', err instanceof ApiError ? err.message : 'Tidak bisa menyimpan. Periksa koneksi internet.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.box, embedded && styles.boxEmbedded]}>
      <View style={styles.ownerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Penanggung Jawab</Text>
          <Text style={styles.ownerName}>{isMine ? 'Saya' : ownerLabel}</Text>
        </View>
        {!isMine && staff ? (
          <PressableScale style={styles.smallButton} disabled={saving} onPress={() => patch({ owner_user_id: staff.id })}>
            <Text style={styles.smallButtonText}>Ambil lead ini</Text>
          </PressableScale>
        ) : null}
      </View>

      <Text style={styles.label}>Hasil</Text>
      <View style={styles.chipWrap}>
        {OUTCOMES.map((o) => (
          <Pressable
            key={o.key}
            style={[styles.chip, outcome === o.key && (o.key === 'won' ? styles.chipWon : styles.chipLost)]}
            onPress={() => {
              setOutcome(outcome === o.key ? null : o.key);
              if (o.key !== 'lost') setReason(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: outcome === o.key }}
          >
            <Text style={[styles.chipText, outcome === o.key && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>

      {outcome === 'lost' ? (
        <>
          <Text style={styles.label}>Alasan tidak jadi *</Text>
          <View style={styles.chipWrap}>
            {REASONS.map((r) => (
              <Pressable key={r.key} style={[styles.chip, reason === r.key && styles.chipLost]} onPress={() => setReason(r.key)} accessibilityRole="button">
                <Text style={[styles.chipText, reason === r.key && styles.chipTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          {needsNote ? (
            <>
              <Text style={styles.label}>Jelaskan alasannya *</Text>
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                placeholder="Tulis alasan singkat"
                placeholderTextColor={colors.textMuted}
                maxLength={255}
                multiline
              />
            </>
          ) : null}
        </>
      ) : null}

      {dirty ? (
        <PressableScale
          style={[styles.saveButton, !canSave && { opacity: 0.5 }]}
          disabled={!canSave}
          onPress={() => patch({ outcome, outcome_reason: outcome === 'lost' ? reason : null, outcome_note: needsNote ? note.trim() : null })}
        >
          {saving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>Simpan Hasil</Text>}
        </PressableScale>
      ) : null}
    </View>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    box: { backgroundColor: card, borderRadius: 24, borderWidth: 1, borderColor: line, padding: 18, gap: spacing.sm + 2, ...shadow },
    boxEmbedded: { padding: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 },
    ownerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    label: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    ownerName: { fontSize: fontSize.base, fontWeight: '800', letterSpacing: -0.2, color: colors.textPrimary },
    smallButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    smallButtonText: { fontSize: 12.5, fontWeight: '700', color: accentText },
    noteInput: { minHeight: 76, textAlignVertical: 'top', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, backgroundColor: chip, color: colors.textPrimary, fontSize: fontSize.sm },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: chip },
    chipWon: { backgroundColor: colors.success },
    chipLost: { backgroundColor: colors.danger },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    chipTextOn: { color: '#ffffff' },
    saveButton: { alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: radius.pill, backgroundColor: colors.accent, marginTop: spacing.xs },
    saveButtonText: { color: '#ffffff', fontWeight: '700', fontSize: fontSize.sm },
  });
}
