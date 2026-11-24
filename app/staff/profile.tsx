import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Alert, Switch, TextProps } from 'react-native';
import { Image } from 'expo-image';
import { AppText } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StaffBottomNav, NAV_CLEARANCE } from '@/components/staff/StaffBottomNav';
import { useHideNavOnScroll } from '@/lib/staff-nav-visibility';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { staffApiFetch } from '@/lib/staff-api';
import { useAppTheme } from '@/lib/theme-context';
import { useStaffAuth } from '@/lib/staff-auth-context';

interface StaffProfile {
  name: string;
  email: string | null;
  phone: string | null;
  employee_number: string | null;
  role: string | null;
  store_name: string | null;
  employment: {
    type: string | null;
    join_date: string | null;
    tenure_label: string | null;
    contract_end_date: string | null;
    contract_days_left: number | null;
    contract_extensions: number;
    // Terbaru di atas; opsional karena server lama belum mengirimnya.
    contract_history?: { previous_end_date: string | null; new_end_date: string }[];
    probation_end_date?: string | null;
  };
  identity: {
    nik: string | null;
    npwp: string | null;
    bpjs_kesehatan_number: string | null;
    bpjs_ketenagakerjaan_number: string | null;
    bank_name: string | null;
    bank_account_number: string | null;
  };
  emergency_contact: { name: string | null; phone: string | null; relationship: string | null };
  leave: {
    year: number;
    annual_quota: number;
    annual_used: number;
    annual_remaining: number;
    pending_requests: number;
    other_used: { name: string; days: number }[];
  };
  pending_policies?: number;
  // Surat Peringatan milik sendiri yang belum dibaca; opsional karena server lama belum mengirimnya.
  unread_warning_letters?: number;
  // Data yang belum lengkap dan perlu diserahkan ke HR; opsional karena server lama belum mengirimnya.
  missing_data?: string[];
  documents: { id: number; type: string; type_label: string; filename: string | null; uploaded_at: string | null }[];
}

type SectionKey = 'employment' | 'leave' | 'identity' | 'emergency' | 'documents';

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// Teks layar ini dibatasi pembesarannya (1,25x) supaya kartu dan kotak ringkasan tidak pecah pada ukuran font sistem besar.
function T(props: TextProps) {
  return <AppText maxFontSizeMultiplier={1.25} {...props} />;
}

// Profil Saya (Karyawan Fase 2): data kepegawaian milik sendiri, hanya baca. Perubahan data tetap lewat HR di panel; nomor identitas
// tampil tersamar dari server.
export default function StaffProfileScreen() {
  const hideNavOnScroll = useHideNavOnScroll();
  const { theme, colors, toggleTheme } = useAppTheme();
  const { staff, logout } = useStaffAuth();
  const isDark = theme === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);

  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rincian data dilipat secara bawaan supaya halaman pendek; ringkasan penting sudah ada di kotak di atasnya.
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    employment: false, leave: false, identity: false, emergency: false, documents: false,
  });
  const toggleSection = (key: SectionKey) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await staffApiFetch<{ profile: StaffProfile }>('/api/staff/profile');
      setProfile(res.profile);
    } catch {
      setError('Gagal memuat profil. Periksa koneksi internet.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <View style={styles.row}>
      <T style={styles.rowLabel}>{label}</T>
      <T style={styles.rowValue}>{value || '—'}</T>
    </View>
  );

  const Section = ({ id, icon, title, summary, children }: { id: SectionKey; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; summary?: string; children: React.ReactNode }) => (
    <View style={styles.sectionCard}>
      <Pressable style={styles.sectionHead} onPress={() => toggleSection(id)} accessibilityRole="button" accessibilityState={{ expanded: openSections[id] }}>
        <View style={styles.menuIconWrap}>
          <Ionicons name={icon} size={18} color={colors.accent} />
        </View>
        <View style={styles.sectionHeadText}>
          <T style={styles.sectionHeadTitle}>{title}</T>
          {summary ? <T style={styles.sectionHeadSummary} numberOfLines={1}>{summary}</T> : null}
        </View>
        <Ionicons name={openSections[id] ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </Pressable>
      {openSections[id] ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );

  const daysLeft = profile?.employment.contract_days_left ?? null;
  const contractWarning = daysLeft !== null && daysLeft <= 60;

  // Satu kartu "Perlu perhatian" untuk semua hal yang menunggu karyawan, bukan kotak kuning yang bertebaran di halaman.
  const attention: { key: string; icon: React.ComponentProps<typeof Ionicons>['name']; tone: 'danger' | 'warning'; text: string; route?: string }[] = [];
  if (profile) {
    if ((profile.unread_warning_letters ?? 0) > 0) {
      attention.push({ key: 'sp', icon: 'alert-circle-outline', tone: 'danger', text: `${profile.unread_warning_letters} Surat Peringatan belum dibaca`, route: '/staff/attendance/warning-letters' });
    }
    if ((profile.pending_policies ?? 0) > 0) {
      attention.push({ key: 'policy', icon: 'document-text-outline', tone: 'warning', text: `${profile.pending_policies} dokumen peraturan/kebijakan menunggu dibaca dan diterima`, route: '/staff/policies' });
    }
    if (contractWarning && daysLeft !== null) {
      attention.push({
        key: 'contract',
        icon: 'time-outline',
        tone: 'warning',
        text: daysLeft >= 0 ? `Kontrak berakhir ${daysLeft} hari lagi. Hubungi HR untuk perpanjangan.` : 'Masa kontrak sudah lewat. Hubungi HR.',
      });
    }
    if ((profile.missing_data ?? []).length > 0) {
      attention.push({
        key: 'missing',
        icon: 'clipboard-outline',
        tone: 'warning',
        text: `Data kepegawaian belum lengkap: ${(profile.missing_data ?? []).join(', ')}. Lengkapi lewat HR.`,
      });
    }
  }

  const menuItems = [
    { key: 'safety', icon: 'shield-checkmark-outline' as const, label: 'K3 & Penilaian', href: '/staff/safety', badge: 0 },
    { key: 'policies', icon: 'document-text-outline' as const, label: 'Peraturan & Kebijakan', href: '/staff/policies', badge: profile?.pending_policies ?? 0 },
    { key: 'warnings', icon: 'alert-circle-outline' as const, label: 'Surat Peringatan', href: '/staff/attendance/warning-letters', badge: profile?.unread_warning_letters ?? 0 },
    { key: 'guides', icon: 'book-outline' as const, label: 'Panduan', href: '/staff/guides', badge: 0 },
  ]
    // K3 & Penilaian hanya tampil bila fiturnya menyala di server (has_safety_access); sesi lama tanpa flag dianggap mati.
    .filter((item) => item.key !== 'safety' || (staff?.has_safety_access ?? false));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        <T style={styles.headerTitle}>Profil</T>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          onScroll={hideNavOnScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
        >
          {error ? (
            <View style={styles.errorBox}>
              <T style={styles.errorText}>{error}</T>
            </View>
          ) : null}

          {profile ? (
            <>
              <View style={styles.hero}>
                <View style={styles.avatar} accessible accessibilityLabel="Ginnva">
                  <Image source={require('@/assets/icon.png')} style={styles.avatarLogo} contentFit="contain" />
                </View>
                <View style={styles.heroText}>
                  <T style={styles.heroName} numberOfLines={2}>{profile.name}</T>
                  <T style={styles.heroSub} numberOfLines={2}>{[profile.role, profile.store_name].filter(Boolean).join(' · ') || '—'}</T>
                  {profile.employee_number ? <T style={styles.heroNumber}>{profile.employee_number}</T> : null}
                </View>
              </View>

              {attention.length > 0 ? (
                <View style={styles.attentionCard}>
                  <T style={styles.attentionTitle}>Perlu perhatian</T>
                  {attention.map((item, index) => {
                    const color = item.tone === 'danger' ? colors.danger : colors.warning;
                    const content = (
                      <>
                        <Ionicons name={item.icon} size={18} color={color} />
                        <T style={[styles.attentionText, { color: colors.textPrimary }]}>{item.text}</T>
                        {item.route ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
                      </>
                    );

                    return item.route ? (
                      <Pressable key={item.key} style={[styles.attentionRow, index > 0 && styles.attentionRowBorder]} onPress={() => router.push(item.route as never)} accessibilityRole="button">
                        {content}
                      </Pressable>
                    ) : (
                      <View key={item.key} style={[styles.attentionRow, index > 0 && styles.attentionRowBorder]}>{content}</View>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.statRow}>
                <Pressable style={styles.statTile} onPress={() => router.push('/staff/attendance/leave' as never)} accessibilityRole="button" accessibilityLabel="Sisa cuti, buka pengajuan izin dan cuti">
                  <T style={[styles.statValue, { color: colors.accent }]}>{profile.leave.annual_remaining}</T>
                  <T style={styles.statLabel}>Sisa cuti {profile.leave.year}</T>
                </Pressable>
                <View style={styles.statTile}>
                  <T style={styles.statValueSmall} numberOfLines={2}>{profile.employment.tenure_label || '—'}</T>
                  <T style={styles.statLabel}>Masa kerja</T>
                </View>
                {profile.employment.contract_end_date ? (
                  <View style={styles.statTile}>
                    <T style={[styles.statValue, contractWarning && { color: daysLeft !== null && daysLeft < 0 ? colors.danger : colors.warning }]}>
                      {daysLeft !== null ? (daysLeft >= 0 ? daysLeft : '0') : '—'}
                    </T>
                    <T style={styles.statLabel}>Hari sisa kontrak</T>
                  </View>
                ) : (
                  <View style={styles.statTile}>
                    <T style={styles.statValueSmall} numberOfLines={2}>{profile.employment.type || '—'}</T>
                    <T style={styles.statLabel}>Status</T>
                  </View>
                )}
              </View>

              <T style={styles.groupTitle}>Menu saya</T>
              <View style={styles.listCard}>
                {menuItems.map((item, index) => (
                  <Pressable
                    key={item.key}
                    style={[styles.menuRow, index > 0 && styles.menuRowBorder]}
                    onPress={() => router.push(item.href as never)}
                    accessibilityRole="button"
                  >
                    <View style={styles.menuIconWrap}>
                      <Ionicons name={item.icon} size={18} color={colors.accent} />
                    </View>
                    <T style={styles.menuLabel}>{item.label}</T>
                    {item.badge > 0 ? (
                      <View style={styles.menuBadge}>
                        <T style={styles.menuBadgeText}>{item.badge}</T>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>

              <T style={styles.groupTitle}>Data saya</T>
              <Section
                id="employment"
                icon="briefcase-outline"
                title="Masa kerja & kontrak"
                summary={[profile.employment.type, profile.employment.join_date ? `sejak ${formatDate(profile.employment.join_date)}` : null].filter(Boolean).join(' · ')}
              >
                <Row label="Status" value={profile.employment.type} />
                <Row label="Mulai bekerja" value={formatDate(profile.employment.join_date)} />
                <Row label="Masa kerja" value={profile.employment.tenure_label} />
                {profile.employment.probation_end_date ? (
                  <Row label="Masa percobaan berakhir" value={formatDate(profile.employment.probation_end_date)} />
                ) : null}
                {profile.employment.contract_end_date ? (
                  <>
                    <Row label="Kontrak berakhir" value={formatDate(profile.employment.contract_end_date)} />
                    <Row label="Perpanjangan" value={`${profile.employment.contract_extensions}x`} />
                  </>
                ) : null}
                {(profile.employment.contract_history ?? []).length > 0 ? (
                  <View style={styles.historyBox}>
                    <T style={styles.historyTitle}>Riwayat kontrak</T>
                    {(profile.employment.contract_history ?? []).map((h, i) => (
                      <T key={`${h.new_end_date}-${i}`} style={styles.historyText}>
                        {h.previous_end_date
                          ? `Diperpanjang sampai ${formatDate(h.new_end_date)} (sebelumnya ${formatDate(h.previous_end_date)})`
                          : `Kontrak pertama sampai ${formatDate(h.new_end_date)}`}
                      </T>
                    ))}
                  </View>
                ) : null}
              </Section>

              <Section
                id="leave"
                icon="calendar-outline"
                title={`Cuti ${profile.leave.year}`}
                summary={`${profile.leave.annual_remaining} dari ${profile.leave.annual_quota} hari tersisa`}
              >
                <Row label="Jatah Cuti Tahunan" value={`${profile.leave.annual_quota} hari`} />
                <Row label="Sudah dipakai" value={`${profile.leave.annual_used} hari`} />
                <Row label="Menunggu persetujuan" value={`${profile.leave.pending_requests} pengajuan`} />
                {profile.leave.other_used.map((o) => (
                  <Row key={o.name} label={o.name} value={`${o.days} hari`} />
                ))}
                <Pressable style={styles.linkButton} onPress={() => router.push('/staff/attendance/leave' as never)} accessibilityRole="button">
                  <T style={styles.linkButtonText}>Ajukan Izin/Cuti</T>
                  <Ionicons name="chevron-forward" size={16} color={colors.accent} />
                </Pressable>
              </Section>

              <Section id="identity" icon="id-card-outline" title="Data diri" summary={[profile.email, profile.phone].filter(Boolean).join(' · ') || undefined}>
                <Row label="Email" value={profile.email} />
                <Row label="Telepon" value={profile.phone} />
                <Row label="NIK" value={profile.identity.nik} />
                <Row label="NPWP" value={profile.identity.npwp} />
                <Row label="BPJS Kesehatan" value={profile.identity.bpjs_kesehatan_number} />
                <Row label="BPJS Ketenagakerjaan" value={profile.identity.bpjs_ketenagakerjaan_number} />
                <Row label="Rekening" value={profile.identity.bank_name ? `${profile.identity.bank_name} ${profile.identity.bank_account_number ?? ''}`.trim() : null} />
                <T style={styles.hint}>Nomor ditampilkan sebagian supaya aman. Untuk mengubah data, hubungi HR.</T>
              </Section>

              <Section id="emergency" icon="call-outline" title="Kontak darurat" summary={profile.emergency_contact.name ?? 'Belum diisi'}>
                <Row label="Nama" value={profile.emergency_contact.name} />
                <Row label="Hubungan" value={profile.emergency_contact.relationship} />
                <Row label="Telepon" value={profile.emergency_contact.phone} />
              </Section>

              <Section id="documents" icon="folder-open-outline" title="Dokumen" summary={profile.documents.length > 0 ? `${profile.documents.length} dokumen` : 'Belum ada'}>
                {profile.documents.length === 0 ? (
                  <T style={styles.hint}>Belum ada dokumen tersimpan di data kepegawaian.</T>
                ) : (
                  profile.documents.map((d) => (
                    <View key={d.id} style={styles.docRow}>
                      <Ionicons name="document-text-outline" size={18} color={colors.accent} />
                      <View style={styles.docText}>
                        <T style={styles.docType}>{d.type_label}</T>
                        {d.filename ? <T style={styles.docName} numberOfLines={1}>{d.filename}</T> : null}
                      </View>
                      <T style={styles.docDate}>{formatDate(d.uploaded_at)}</T>
                    </View>
                  ))
                )}
              </Section>
            </>
          ) : (
            // Menu Saya tetap tampil walau data profil gagal dimuat, supaya Panduan tetap bisa dibuka.
            <>
              <T style={styles.groupTitle}>Menu saya</T>
              <View style={styles.listCard}>
                {menuItems.map((item, index) => (
                  <Pressable key={item.key} style={[styles.menuRow, index > 0 && styles.menuRowBorder]} onPress={() => router.push(item.href as never)} accessibilityRole="button">
                    <View style={styles.menuIconWrap}>
                      <Ionicons name={item.icon} size={18} color={colors.accent} />
                    </View>
                    <T style={styles.menuLabel}>{item.label}</T>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <T style={styles.groupTitle}>Akun</T>
          <View style={styles.listCard}>
            <Pressable style={styles.menuRow} onPress={() => router.push('/staff/change-password' as never)} accessibilityRole="button">
              <View style={styles.menuIconWrap}>
                <Ionicons name="key-outline" size={18} color={colors.accent} />
              </View>
              <T style={styles.menuLabel}>Ganti password</T>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
            {/* Tombol mode tampilan dipindah dari header Beranda ke sini (2026-11-13) supaya header Beranda lebih bersih. */}
            <View style={[styles.menuRow, styles.menuRowBorder]}>
              <View style={styles.menuIconWrap}>
                <Ionicons name={theme === 'dark' ? 'moon-outline' : 'sunny-outline'} size={18} color={colors.accent} />
              </View>
              <T style={styles.menuLabel}>Mode gelap</T>
              <Switch
                value={theme === 'dark'}
                onValueChange={toggleTheme}
                trackColor={{ false: isDark ? colors.border : '#d9d9e0', true: colors.accent }}
                thumbColor="#ffffff"
                accessibilityLabel="Mode gelap"
              />
            </View>
          </View>

          <Pressable
            style={styles.logoutButton}
            onPress={() =>
              Alert.alert('Keluar', 'Yakin mau keluar dari akun ini?', [
                { text: 'Batal', style: 'cancel' },
                { text: 'Keluar', style: 'destructive', onPress: () => logout().then(() => router.replace('/auth/login' as never)) },
              ])
            }
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <T style={styles.logoutText}>Keluar</T>
          </Pressable>
        </ScrollView>
      )}
      <StaffBottomNav active="profile" />
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors, isDark: boolean) {
  // Sama dengan halaman lain yang sudah dirombak: latar abu-putih dengan kartu putih berlekuk besar di mode terang; tingkat abu bawaan di mode gelap.
  const screenBg = isDark ? colors.bg : '#f5f5f8';
  const card = isDark ? colors.surface : '#ffffff';
  const chip = isDark ? colors.surfaceElevated : '#efeff4';
  const line = isDark ? colors.border : '#e8e8ee';
  const accentText = isDark ? '#ff6b8f' : '#cc1042';
  const shadow = isDark
    ? {}
    : { shadowColor: '#14141b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: screenBg },
    centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: { paddingHorizontal: 20, paddingTop: spacing.sm, paddingBottom: spacing.md },
    headerTitle: { fontSize: 30, fontWeight: '800', letterSpacing: -0.9, color: colors.textPrimary },
    content: { paddingHorizontal: 20, paddingBottom: NAV_CLEARANCE, gap: 12 },
    errorBox: { backgroundColor: colors.dangerBg, borderRadius: 20, padding: spacing.md },
    errorText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '600' },

    hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 28, backgroundColor: card, ...shadow },
    // Logo G Ginnva dalam lingkaran putih, sama dengan avatar di header Beranda.
    avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#ffffff', borderWidth: 1, borderColor: line },
    avatarLogo: { width: 64, height: 64 },
    heroText: { flex: 1, gap: 3 },
    heroName: { fontSize: 21, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },
    heroSub: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
    heroNumber: { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden', fontSize: 12, fontWeight: '700', color: accentText, backgroundColor: colors.accentSoft },

    attentionCard: { borderRadius: 26, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: card, ...shadow },
    attentionTitle: { paddingTop: 6, paddingBottom: 2, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    attentionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    attentionRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line },
    attentionText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },

    statRow: { flexDirection: 'row', gap: 10 },
    statTile: { flex: 1, minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 12, borderRadius: 24, backgroundColor: card, ...shadow },
    statValue: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    statValueSmall: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    statLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },

    groupTitle: { marginTop: 10, marginLeft: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    listCard: { borderRadius: 26, paddingHorizontal: 16, backgroundColor: card, ...shadow },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 10 },
    menuRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line },
    menuIconWrap: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
    menuLabel: { flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.textPrimary },
    menuBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
    menuBadgeText: { color: '#ffffff', fontSize: 11.5, fontWeight: '800' },

    sectionCard: { borderRadius: 26, paddingHorizontal: 16, backgroundColor: card, ...shadow },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 10 },
    sectionHeadText: { flex: 1 },
    sectionHeadTitle: { fontSize: 15.5, fontWeight: '700', color: colors.textPrimary },
    sectionHeadSummary: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
    sectionBody: { gap: 14, paddingTop: 14, paddingBottom: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line },

    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
    rowLabel: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
    rowValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
    hint: { fontSize: 12.5, lineHeight: 18, fontWeight: '500', color: colors.textMuted },
    historyBox: { gap: 4, padding: 14, borderRadius: 18, backgroundColor: chip },
    historyTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: colors.textMuted },
    historyText: { fontSize: 13, lineHeight: 19, color: colors.textPrimary },
    linkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 46, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    linkButtonText: { fontSize: 14.5, fontWeight: '800', color: colors.accent },
    docRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    docText: { flex: 1 },
    docType: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    docName: { fontSize: 12.5, color: colors.textMuted },
    docDate: { fontSize: 12.5, color: colors.textMuted },

    logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, marginTop: 8, borderRadius: radius.pill, backgroundColor: colors.dangerBg },
    logoutText: { fontSize: 15.5, fontWeight: '800', color: colors.danger },
  });
}
