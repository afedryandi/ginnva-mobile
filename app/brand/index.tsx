import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Modal } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { FadeInUp } from '@/components/ui/FadeInUp';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
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

type Styles = ReturnType<typeof createStyles>;

function StatGrid({ stats, styles }: { stats: { value: string; label: string }[]; styles: Styles }) {
  return (
    <View style={styles.statGrid}>
      {stats.map((s) => (
        <View key={s.label} style={styles.statItem}>
          <Text style={styles.statValue} adjustsFontSizeToFit numberOfLines={1}>{s.value}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

// Garis waktu vertikal: titik merah per tahun, disambung garis tipis.
function Timeline({ styles }: { styles: Styles }) {
  return (
    <View style={styles.timeline}>
      {TIMELINE.map((item, idx) => {
        const last = idx === TIMELINE.length - 1;
        return (
          <View key={item.year} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={styles.timelineDot} />
              {!last && <View style={styles.timelineLine} />}
            </View>
            <View style={[styles.timelineContent, last && styles.timelineContentLast]}>
              <Text style={styles.timelineYear}>{item.year}</Text>
              <Text style={styles.timelineBody}>{item.body}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ChinaNote({ styles, colors }: { styles: Styles; colors: typeof darkColors }) {
  return (
    <View style={styles.chinaNote}>
      <Ionicons name="globe-outline" size={15} color={colors.textMuted} />
      <Text style={styles.chinaNoteText}>Data berikut merupakan informasi dari Ginnva China</Text>
    </View>
  );
}

export default function BrandScreen() {
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [activeTab, setActiveTab] = useState<'indonesia' | 'china'>('indonesia');
  const [zoomedHonor, setZoomedHonor] = useState<{ src: string; caption: string } | null>(null);

  const tabs: { key: 'indonesia' | 'china'; label: string }[] = [
    { key: 'indonesia', label: 'Ginnva Indonesia' },
    { key: 'china', label: 'Ginnva China' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      <View style={styles.topRow}>
        {router.canGoBack() ? (
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={styles.topTitle} numberOfLines={1}>Tentang Ginnva</Text>
      </View>

      {/* Pemilih tab berbentuk pil */}
      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <Pressable
              key={t.key}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              onPress={() => setActiveTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === 'indonesia' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <FadeInUp>
            <Image source={require('@/assets/images/building-indo.webp')} style={styles.buildingImage} contentFit="cover" transition={300} />
          </FadeInUp>
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
              <View style={styles.trustIcon}>
                <Ionicons name="ribbon-outline" size={22} color={colors.accent} />
              </View>
              <Text style={styles.trustBoxText}>
                Sebagai bentuk kepercayaan dan ekspansi global, Shanghai Smith Adhesive
                New Material Co., Ltd. secara resmi menunjuk{' '}
                <Text style={styles.bold}>PT. Ginnva Shield Indonesia</Text> sebagai
                mitra dan perwakilan eksklusif di Indonesia untuk memasarkan serta
                mendistribusikan produk film otomotif bermerek{' '}
                <Text style={styles.bold}>Ginnva</Text>.
              </Text>
            </View>

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Perjalanan Pertumbuhan</Text>
            <Timeline styles={styles} />

            {/* CTA Kemitraan */}
            <PressableScale style={styles.partnershipCta} onPress={() => router.push('/partnership' as never)} accessibilityRole="button">
              <View style={styles.partnershipIcon}>
                <Ionicons name="business-outline" size={24} color="#ffffff" />
              </View>
              <View style={styles.partnershipBody}>
                <Text style={styles.partnershipCtaTitle}>Jadilah Mitra Ginnva</Text>
                <Text style={styles.partnershipCtaSub}>Buka peluang dealer / distributor resmi di kotamu</Text>
              </View>
              <Ionicons name="arrow-forward" size={20} color="#ffffff" />
            </PressableScale>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <FadeInUp>
            <Image source={require('@/assets/images/building-china.webp')} style={styles.buildingImage} contentFit="cover" transition={300} />
          </FadeInUp>
          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Shanghai Smith Adhesive New Material Co., Ltd.</Text>
            <View style={styles.stockPill}>
              <Ionicons name="trending-up-outline" size={14} color={colors.accent} />
              <Text style={styles.stockPillText}>SSE: 603683</Text>
            </View>
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

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Perjalanan Pertumbuhan</Text>
            <Timeline styles={styles} />

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Kekuatan Riset &amp; Pengembangan</Text>
            <ChinaNote styles={styles} colors={colors} />
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

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Kekuatan Manufaktur Cerdas</Text>
            <ChinaNote styles={styles} colors={colors} />
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

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Mitra Utama</Text>
            <View style={styles.partnersCard}>
              <Image source={{ uri: `${WEB_ASSET_BASE}/partners.webp` }} style={styles.partnersImage} contentFit="contain" transition={300} />
            </View>

            <Text style={[styles.sectionTitle, styles.sectionSpacing]}>Penghargaan Perusahaan</Text>
            <View style={styles.honorGrid}>
              {HONOR_IMAGES.map((item, idx) => (
                <PressableScale key={idx} style={styles.honorItem} onPress={() => setZoomedHonor(item)} accessibilityRole="button" accessibilityLabel={item.caption}>
                  <Image source={{ uri: item.src }} style={styles.honorImage} contentFit="contain" transition={300} />
                  <Text style={styles.honorCaption} numberOfLines={4}>{item.caption}</Text>
                </PressableScale>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Lightbox sertifikat — bisa pinch-zoom, supaya teks/detail kecil di
          sertifikat resmi tetap bisa dibaca jelas, bukan cuma dilihat kecil
          di grid. */}
      <Modal visible={zoomedHonor !== null} transparent animationType="fade" onRequestClose={() => setZoomedHonor(null)}>
        <View style={styles.honorModalBackdrop}>
          <Pressable style={styles.honorModalClose} onPress={() => setZoomedHonor(null)} accessibilityRole="button" accessibilityLabel="Tutup">
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
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.sm },
    backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    topTitle: { flex: 1, fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6, color: colors.textPrimary },

    tabBar: { flexDirection: 'row', gap: 4, marginHorizontal: 24, marginTop: spacing.sm, marginBottom: spacing.md, padding: 4, borderRadius: 26, backgroundColor: colors.surfaceElevated },
    tabBtn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    tabBtnActive: { backgroundColor: colors.accent },
    tabBtnText: { fontSize: 14, fontWeight: '800', color: colors.textMuted },
    tabBtnTextActive: { color: '#ffffff' },

    scrollContent: { paddingBottom: 48 },
    buildingImage: { height: 220, marginHorizontal: 24, marginBottom: 24, borderRadius: 28, backgroundColor: colors.surfaceElevated },
    content: { paddingHorizontal: 24 },

    sectionTitle: { fontSize: 22, lineHeight: 29, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary, marginBottom: 10 },
    sectionSpacing: { marginTop: 36 },
    paragraph: { fontSize: 15, lineHeight: 24, color: colors.textSecondary, marginBottom: 12 },
    bold: { fontWeight: '800', color: colors.textPrimary },

    stockPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: colors.accentSoft, marginBottom: 14 },
    stockPillText: { fontSize: 12, fontWeight: '800', color: colors.accent },
    chinaNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    chinaNoteText: { flex: 1, fontSize: 12, color: colors.textMuted },

    trustBox: { gap: 12, padding: 20, borderRadius: 28, backgroundColor: colors.accentSoft, marginTop: 4 },
    trustIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    trustBoxText: { fontSize: 14, lineHeight: 22, color: colors.textSecondary },

    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
    statItem: { flexGrow: 1, flexBasis: '45%', gap: 4, padding: 18, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    statValue: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, color: colors.accent },
    statLabel: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },

    timeline: { paddingTop: 4 },
    timelineRow: { flexDirection: 'row', gap: 16 },
    timelineRail: { width: 14, alignItems: 'center' },
    timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 5, backgroundColor: colors.accent },
    timelineLine: { flex: 1, width: 2, marginTop: 4, borderRadius: 1, backgroundColor: colors.borderStrong },
    timelineContent: { flex: 1, gap: 2, paddingBottom: 22 },
    timelineContentLast: { paddingBottom: 0 },
    timelineYear: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    timelineBody: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },

    partnersCard: { padding: 16, borderRadius: 24, backgroundColor: '#ffffff' },
    partnersImage: { width: '100%', height: 90 },

    honorGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
    honorItem: { width: '48%', gap: 10, padding: 10, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    honorImage: { width: '100%', aspectRatio: 3 / 4, borderRadius: 16, backgroundColor: colors.bg },
    honorCaption: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 4, paddingBottom: 4 },

    honorModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
    honorModalClose: {
      position: 'absolute', top: 48, right: 20, width: 44, height: 44, borderRadius: 22,
      backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center',
      zIndex: 1,
    },
    honorModalImageWrap: { width: '100%', height: '70%' },
    honorModalCaption: { fontSize: 14, lineHeight: 21, color: '#ffffff', textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.md },

    partnershipCta: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, borderRadius: 28, backgroundColor: colors.accent, marginTop: 36 },
    partnershipIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
    partnershipBody: { flex: 1, gap: 2 },
    partnershipCtaTitle: { fontSize: 17, fontWeight: '800', color: '#ffffff' },
    partnershipCtaSub: { fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.85)' },
  });
}
