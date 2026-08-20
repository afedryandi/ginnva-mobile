import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Modal } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, spacing, radius } from '@/constants/theme';
import { useAppTheme } from '@/lib/theme-context';
import { PinchZoomImage } from '@/components/ui/PinchZoomImage';

// Gambar mitra & sertifikat cuma ada di ginnva-web (public/image/...) —
// diambil dari domain production langsung, bukan dibundle ke app,
// supaya tidak nambah ukuran APK/IPA buat 13 gambar marketing statis.
const WEB_ASSET_BASE = 'https://ginnva.id/image';

const RND_STATS = [
  { value: '158+', label: 'Sertifikasi Industri' },
  { value: '100+', label: 'Paten Proprietary' },
  { value: '120+', label: 'Personel R&D' },
  { value: '350+', label: 'Peralatan Canggih' },
];

const MANUFACTURING_STATS = [
  { value: '4', label: 'Basis Produksi' },
  { value: '600 juta m²', label: 'Kapasitas Perekat Industri' },
  { value: '350+', label: 'Instrumen Pengujian' },
  { value: '100+', label: 'Pengendalian Kualitas' },
];

// Caption dibaca langsung dari isi tiap sertifikat (nama resmi & penerbit)
// — sama persis dengan yang ada di ginnva-web/components/brand/BrandHonor.tsx.
const HONOR_IMAGES = [
  { src: `${WEB_ASSET_BASE}/certification/certification-1.webp`, caption: 'FSC Chain of Custody Certification — Bureau Veritas' },
  { src: `${WEB_ASSET_BASE}/certification/certification-2.webp`, caption: 'China Automotive Aftermarket TOP100 List 2024' },
  { src: `${WEB_ASSET_BASE}/certification/certification-3.webp`, caption: 'Drafting Unit — Standar Teknis Pemasangan Kaca Film Otomotif (T/CADCC 006-2025)' },
  { src: `${WEB_ASSET_BASE}/certification/certification-4.webp`, caption: '5G Commercial Industry Alliance — Excellent National Brand' },
  { src: `${WEB_ASSET_BASE}/certification/certification-5.webp`, caption: 'Shanghai Science & Technology "Little Giant" Enterprise (2014)' },
  { src: `${WEB_ASSET_BASE}/certification/certification-6.webp`, caption: 'Sertifikasi Sistem Manajemen ISO — DZCC (Akreditasi IAS/IAF)' },
  { src: `${WEB_ASSET_BASE}/certification/certification-7.webp`, caption: 'Shanghai Specialized, Refined, Distinctive & Innovative (SRDI) Enterprise (2014)' },
  { src: `${WEB_ASSET_BASE}/certification/certification-8.webp`, caption: 'ASWORLD 2024 Recommended Brand Award' },
  { src: `${WEB_ASSET_BASE}/certification/certification-9.webp`, caption: 'Drafting Unit — Standar Pemasangan Film Pelindung Cat Otomotif (CADCC)' },
  { src: `${WEB_ASSET_BASE}/certification/certification-10.webp`, caption: 'Sertifikat Peringkat Pemasok Produk Otomotif — Bintang 5' },
  { src: `${WEB_ASSET_BASE}/certification/certification-11.webp`, caption: 'China Automotive Aftermarket TOP100 List 2023' },
  { src: `${WEB_ASSET_BASE}/certification/certification-12.webp`, caption: 'National High-Tech Enterprise Certificate' },
];

const TIMELINE = [
  { year: '1989', body: 'Pendiri Ginnva memulai bisnis di Shantou, China.' },
  { year: '1994', body: 'Guangdong Ginnva resmi didirikan.' },
  { year: '1995', body: 'Ginnva mengembangkan 10 lini produksi.' },
  { year: '2006', body: 'Kantor Pusat Shanghai didirikan.' },
  { year: '2008', body: 'Ekspansi ke industri elektronik konsumen.' },
  { year: '2010', body: 'Transformasi perusahaan berteknologi tinggi.' },
  { year: '2017', body: 'Tercatat di bursa saham Shanghai (SSE: 603683).' },
  { year: '2018', body: 'Basis produksi di Suzhou beroperasi sepenuhnya.' },
  { year: '2022', body: 'Transformasi bisnis berbasis digital dan AI.' },
  { year: '2023', body: 'Divisi optik didirikan.' },
  { year: '2024', body: 'Pabrik smart digital di Sichuan beroperasi.' },
  { year: '2025', body: 'Anak usaha baru di bidang electronic skin & tactile sensing didirikan.' },
  { year: '2026', body: 'Ekspansi ke Indonesia (Jakarta), fokus di bidang otomotif.' },
];

function StatGrid({ stats, styles }: { stats: { value: string; label: string }[]; styles: ReturnType<typeof createStyles> }) {
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
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [activeTab, setActiveTab] = useState<'indonesia' | 'china'>('indonesia');
  const [zoomedHonor, setZoomedHonor] = useState<{ src: string; caption: string } | null>(null);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.header}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.sideButton}>
            <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
          </Pressable>
        ) : (
          <View style={styles.sideButton} />
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>Tentang Ginnva</Text>
        <View style={styles.sideButton} />
      </View>

      {/* Tab selector */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tabBtn, activeTab === 'indonesia' && styles.tabBtnActive]}
          onPress={() => setActiveTab('indonesia')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'indonesia' && styles.tabBtnTextActive]}>
            🇮🇩  Ginnva Indonesia
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, activeTab === 'china' && styles.tabBtnActive]}
          onPress={() => setActiveTab('china')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'china' && styles.tabBtnTextActive]}>
            🇨🇳  Ginnva China
          </Text>
        </Pressable>
      </View>

      {activeTab === 'indonesia' ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Image
            source={require('@/assets/images/building-indo.webp')}
            style={styles.buildingImage}
            contentFit="cover"
            transition={300}
          />
          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Profil Perusahaan</Text>
            <Text style={styles.paragraph}>
              PT. Ginnva Shield Indonesia adalah distributor resmi dan perwakilan
              eksklusif brand Ginnva di Indonesia. Kami menghadirkan solusi{' '}
              <Text style={styles.bold}>Paint Protection Film (PPF)</Text> dan{' '}
              <Text style={styles.bold}>Kaca Film Mobil</Text> premium berstandar
              internasional yang dirancang untuk performa, daya tahan, dan estetika.
            </Text>
            <Text style={styles.paragraph}>
              Dikembangkan dengan material canggih dan inovasi mutakhir, produk kami
              dirancang khusus untuk menghadapi iklim tropis Indonesia, memberikan
              penolakan panas yang optimal, perlindungan terhadap sinar UV, serta
              ketahanan jangka panjang terhadap goresan, noda, dan kerusakan lingkungan.
            </Text>
            <Text style={styles.paragraph}>
              Kami bermitra dengan para profesional otomotif, dealer, dan pemilik
              kendaraan premium di seluruh Indonesia untuk menghadirkan kualitas yang
              konsisten dan hasil yang unggul, menggabungkan keahlian internasional
              dengan pemahaman mendalam terhadap pasar lokal.
            </Text>

            {/* Kotak kepercayaan/penunjukan mitra */}
            <View style={styles.trustBox}>
              <Text style={styles.trustBoxText}>
                Sebagai bentuk kepercayaan dan ekspansi global, Shanghai Smith Adhesive
                New Material Co., Ltd. secara resmi menunjuk{' '}
                <Text style={styles.bold}>PT. Ginnva Shield Indonesia</Text> sebagai
                mitra dan perwakilan eksklusif di Indonesia untuk memasarkan serta
                mendistribusikan produk film otomotif bermerek{' '}
                <Text style={styles.bold}>Ginnva</Text>.
              </Text>
            </View>

            {/* ===== Timeline ===== */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              Perjalanan Pertumbuhan
            </Text>
            <View style={styles.timelineCard}>
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
            </View>

            {/* CTA Kemitraan */}
            <Pressable
              style={styles.partnershipCta}
              onPress={() => router.push('/partnership' as never)}
            >
              <Ionicons name="business-outline" size={22} color="#ffffff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.partnershipCtaTitle}>Jadilah Mitra Ginnva</Text>
                <Text style={styles.partnershipCtaSub}>
                  Buka peluang dealer / distributor resmi di kota Anda
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#ffffff" />
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Image
            source={require('@/assets/images/building-china.webp')}
            style={styles.buildingImage}
            contentFit="cover"
            transition={300}
          />
          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Shanghai Smith Adhesive New Material Co., Ltd.</Text>
            <Text style={styles.mutedLabel}>SSE: 603683</Text>
            <Text style={styles.paragraph}>
              Perusahaan material perekat pertama di China yang tercatat di bursa saham,
              berdiri sejak tahun <Text style={styles.bold}>1994</Text> dan resmi terdaftar
              di <Text style={styles.bold}>Bursa Efek Shanghai (SSE)</Text> pada tahun{' '}
              <Text style={styles.bold}>2017</Text> dengan kode saham{' '}
              <Text style={styles.bold}>603683</Text>.
            </Text>
            <Text style={styles.paragraph}>
              Bisnis Ginnva China mencakup tiga bidang utama: material perekat industri,
              material perekat elektronik, dan material film fungsional. Produknya
              diaplikasikan di industri otomotif (PPF, Kaca Film, dan Color Change Film),
              konstruksi &amp; dekorasi, baterai kendaraan listrik, serta layar sentuh.
            </Text>
            <Text style={styles.paragraph}>
              Dengan komitmen pada inovasi teknologi, Ginnva China melayani lebih dari{' '}
              <Text style={styles.bold}>110 negara</Text> di seluruh dunia melalui
              kolaborasi riset bersama pelanggan industri terkemuka.
            </Text>

            {/* ===== Timeline ===== */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              Perjalanan Pertumbuhan
            </Text>
            <View style={styles.timelineCard}>
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
            </View>

            {/* ===== Kekuatan R&D ===== */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              Kekuatan Riset &amp; Pengembangan
            </Text>
            <Text style={styles.chinaNote}>🇨🇳 Data berikut merupakan informasi dari Ginnva China</Text>
            <Text style={styles.paragraph}>
              Ginnva memiliki kapabilitas di bagian Riset dan Pengembangan (Research &amp;
              Development) yang tangguh, dengan keahlian teknis mendalam yang dibangun
              melalui kolaborasi industri, akademik, dan penelitian selama bertahun-tahun.
            </Text>
            <Text style={styles.paragraph}>
              Teknologi inti kami mencakup: desain struktur spasial polimer, desain
              struktur silang, teknologi polimerisasi multi-komponen, teknologi
              biodegradasi, dan teknologi pelapisan presisi.
            </Text>
            <StatGrid stats={RND_STATS} styles={styles} />

            {/* ===== Kekuatan Manufaktur Cerdas ===== */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              Kekuatan Manufaktur Cerdas
            </Text>
            <Text style={styles.chinaNote}>🇨🇳 Data berikut merupakan informasi dari Ginnva China</Text>
            <Text style={styles.paragraph}>
              Ginnva memiliki 4 basis produksi yang tersebar di Suzhou, Quzhou, Chuzhou,
              dan Neijiang. Fasilitas produksi ini dilengkapi dengan robot dan teknologi
              kecerdasan buatan untuk inspeksi kualitas, logistik, dan perakitan —
              menjadikan Ginnva salah satu produsen material perekat fungsional dengan
              infrastruktur manufaktur paling modern di industri. Kapasitas produksi
              mencakup 600 juta m² perekat industri, 170 juta m² perekat elektronik,
              150 juta m² perekat optik, dan 50.000 ton perekat.
            </Text>
            <StatGrid stats={MANUFACTURING_STATS} styles={styles} />

            {/* ===== Mitra Utama ===== */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              Mitra Utama
            </Text>
            <Image
              source={{ uri: `${WEB_ASSET_BASE}/partners.webp` }}
              style={styles.partnersImage}
              contentFit="contain"
              transition={300}
            />

            {/* ===== Penghargaan Perusahaan ===== */}
            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>
              Penghargaan Perusahaan
            </Text>
            <View style={styles.honorGrid}>
              {HONOR_IMAGES.map((item, idx) => (
                <Pressable key={idx} style={styles.honorItem} onPress={() => setZoomedHonor(item)}>
                  <Image
                    source={{ uri: item.src }}
                    style={styles.honorImage}
                    contentFit="contain"
                    transition={300}
                  />
                  <Text style={styles.honorCaption} numberOfLines={4}>{item.caption}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Lightbox sertifikat — bisa pinch-zoom, supaya teks/detail kecil di
          sertifikat resmi tetap bisa dibaca jelas, bukan cuma dilihat kecil
          di grid. */}
      <Modal
        visible={zoomedHonor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomedHonor(null)}
      >
        <View style={styles.honorModalBackdrop}>
          <Pressable style={styles.honorModalClose} onPress={() => setZoomedHonor(null)}>
            <Ionicons name="close" size={26} color="#ffffff" />
          </Pressable>
          {zoomedHonor && (
            <>
              <View style={styles.honorModalImageWrap}>
                <PinchZoomImage uri={zoomedHonor.src} />
              </View>
              <Text style={styles.honorModalCaption}>{zoomedHonor.caption}</Text>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  sideButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  tabBtnText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabBtnTextActive: {
    color: colors.accent,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  buildingImage: {
    width: '100%',
    height: 220,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: spacing.md,
  },
  mutedLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  bold: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  chinaNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionSpacing: {
    marginTop: spacing.lg,
  },
  paragraph: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: spacing.sm,
  },
  trustBox: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  trustBoxText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 21,
    textAlign: 'center',
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
    color: colors.textSecondary,
    marginTop: 2,
  },
  timelineCard: {
    padding: 0,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  timelineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
    color: colors.textPrimary,
    lineHeight: 19,
  },
  partnersImage: {
    width: '100%',
    height: 90,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  honorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  honorItem: {
    width: '48%',
    marginBottom: spacing.lg,
  },
  honorImage: {
    width: '100%',
    aspectRatio: 3 / 4,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
  },
  honorCaption: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 15,
  },
  honorModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  honorModalClose: {
    position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
  honorModalImageWrap: {
    width: '100%',
    height: '70%',
  },
  honorModalCaption: {
    fontSize: fontSize.sm,
    color: '#ffffff',
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
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
    color: '#ffffff',
  },
  partnershipCtaSub: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  });
}
