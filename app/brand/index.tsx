import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, spacing, radius } from '@/constants/theme';

// Konten dikondensasi dari komponen brand di ginnva-web (BrandIntro,
// BrandTimeline, BrandStrength) — bukan salinan utuh, supaya tetap
// nyaman dibaca di layar mobile tanpa kehilangan poin penting.
const COMPANY_STATS = [
  { value: '4', label: 'Pusat R&D' },
  { value: '6', label: 'Basis Industri' },
  { value: '10+', label: 'Anak Perusahaan' },
  { value: '20+', label: 'Jaringan Layanan' },
];

const RND_STATS = [
  { value: '100+', label: 'Paten Penemuan' },
  { value: '4', label: 'Tim R&D' },
  { value: '350+', label: 'Instrumen Canggih' },
  { value: '120+', label: 'Personel R&D' },
];

const TIMELINE = [
  { year: '1994', body: 'Mendirikan Guangdong Ginnva Technology Co., Ltd.' },
  { year: '2006', body: 'Mendirikan Shanghai Ginnva Adhesive New Materials Co., Ltd. sebagai kantor pusat Grup.' },
  { year: '2017', body: 'Tercatat di bursa saham utama Shanghai — perusahaan material perekat pertama yang go public di Tiongkok.' },
  { year: '2022', body: 'Menetapkan arah strategi baru sebagai "ahli solusi perekat", memulai transformasi digital berbasis AI.' },
  { year: '2025', body: 'Mendirikan Beijing Jingzhigan New Materials, fokus pada solusi sensor taktil kulit elektronik.' },
  { year: '2026', body: 'Ekspansi ke Indonesia melalui PT. Ginnva Shield Indonesia — menghadirkan premium PPF dan Kaca Film Mobil ke pasar otomotif Indonesia.' },
];

function StatGrid({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <View style={styles.statGrid}>
      {stats.map((s) => (
        <View key={s.label} style={styles.statItem}>
          <Text style={styles.statValue}>{s.value}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function BrandScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Tentang Ginnva" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ===== Gedung Ginnva Indonesia ===== */}
        <Image
          source={require('@/assets/building-indo.webp')}
          style={styles.buildingImage}
          contentFit="cover"
          transition={300}
        />

        {/* ===== Profil Perusahaan ===== */}
        <View style={styles.content}>
        <Text style={styles.sectionTitle}>Profil Perusahaan</Text>
        <Text style={styles.paragraph}>
          PT. Ginnva Shield Indonesia merupakan mitra resmi dan perwakilan dari
          teknologi advanced functional film Ginnva di Indonesia, menghadirkan
          solusi Premium Paint Protection Film (PPF) dan Kaca Film Mobil dari
          China yang dirancang untuk performa, daya tahan, dan estetika.
        </Text>
        <Text style={styles.paragraph}>
          Produk kami dirancang khusus menghadapi iklim tropis Indonesia —
          memberikan penolakan panas optimal, perlindungan sinar UV, serta
          ketahanan jangka panjang terhadap goresan dan kerusakan lingkungan.
        </Text>
        <StatGrid stats={COMPANY_STATS} />

        {/* ===== Timeline ===== */}
        <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
          Perjalanan Pertumbuhan
        </Text>
        <Card style={styles.timelineCard}>
          {TIMELINE.map((item, idx) => (
            <View
              key={item.year}
              style={[
                styles.timelineRow,
                idx !== TIMELINE.length - 1 && styles.timelineRowBorder,
              ]}
            >
              <Text style={styles.timelineYear}>{item.year}</Text>
              <Text style={styles.timelineBody}>{item.body}</Text>
            </View>
          ))}
        </Card>

        {/* ===== Kekuatan R&D ===== */}
        <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
          Kekuatan R&D
        </Text>
        <Text style={styles.paragraph}>
          Teknologi inti kami mencakup desain struktur spasial polimer, desain
          struktur silang, teknologi polimerisasi multi-komponen, teknologi
          biodegradasi, dan teknologi pelapisan presisi.
        </Text>
        <StatGrid stats={RND_STATS} />

        <Text style={styles.footerNote}>
          Inti dari merek kami adalah komitmen terhadap keunggulan melalui
          inovasi, keandalan, dan kepuasan pelanggan.
        </Text>

        {/* CTA Kemitraan */}
        <Pressable
          style={styles.partnershipCta}
          onPress={() => router.push('/partnership' as never)}
        >
          <Ionicons name="business-outline" size={22} color={colors.white} />
          <View style={{ flex: 1 }}>
            <Text style={styles.partnershipCtaTitle}>Jadilah Mitra Ginnva</Text>
            <Text style={styles.partnershipCtaSub}>
              Buka peluang dealer / distributor resmi di kota Anda
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.white} />
        </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  buildingImage: {
    width: '100%',
    height: 220,
    marginBottom: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  sectionSpacing: {
    marginTop: spacing.lg,
  },
  paragraph: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  statItem: {
    width: '50%',
    paddingVertical: spacing.sm,
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.accent,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  timelineCard: {
    padding: 0,
    overflow: 'hidden',
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  timelineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  timelineYear: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.accent,
    width: 48,
  },
  timelineBody: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.ink,
    lineHeight: 19,
  },
  footerNote: {
    fontSize: fontSize.sm,
    color: colors.mutedLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: spacing.xl,
    lineHeight: 19,
  },
  partnershipCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  partnershipCtaTitle: {
    fontSize: fontSize.base,
    fontWeight: '800',
    color: colors.white,
  },
  partnershipCtaSub: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
});