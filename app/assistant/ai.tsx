/**
 * app/assistant/ai.tsx
 *
 * Asisten AI Ginnva — powered by Groq (openai/gpt-oss-20b).
 * Model kecil (8B, bukan 70B) sengaja dipilih supaya limit token-per-menit
 * free tier Groq lebih longgar — lihat ChatController::send() di backend
 * untuk detail & histori percobaan pindah provider (sempat dicoba Gemini,
 * tapi project Google Cloud-nya butuh billing aktif, jadi dikembalikan).
 * Knowledge base: PPF & Window Film product info, garansi, perawatan, FAQ,
 * SOP after-sales, dan hand-off ke WhatsApp sales jika tidak bisa jawab.
 *
 * Sebelumnya ini adalah tab "Asisten" — dipindah jadi stack screen terpisah
 * supaya tab tersebut bisa jadi hub berisi 2 pilihan: Asisten AI (di sini)
 * dan Chat dengan Toko (booking-specific, lihat app/(tabs)/chat.tsx).
 *
 * Catatan implementasi:
 * - API key TIDAK disimpan di sini. Request diroute lewat backend Laravel
 *   di endpoint POST /api/chat, yang kemudian forward ke Groq API.
 *   Ini supaya API key aman di server, tidak ter-bundle ke APK.
 * - Conversation history dikirim tiap request (stateless dari sisi server).
 * - Keyboard: pengangkatan kolom ketik memakai useKeyboardLift (sama dengan
 *   chat booking), bukan KeyboardAvoidingView 'height' yang menyusut dua kali
 *   di Android.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { AutoGrowTextInput } from '@/components/ui/AutoGrowTextInput';
import { PressableScale } from '@/components/ui/PressableScale';
import { darkColors, spacing } from '@/constants/theme';
import { SALES_WA_NUMBER } from '@/constants/contact';
import { apiFetch, ApiError } from '@/lib/api';
import { useKeyboardLift } from '@/lib/use-keyboard-lift';
import { useAppTheme } from '@/lib/theme-context';

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  text: string;
  isError?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WA_URL = `https://wa.me/${SALES_WA_NUMBER}?text=${encodeURIComponent('Halo, saya ingin bertanya lebih lanjut tentang produk Ginnva.')}`;

const SUGGESTED_QUESTIONS = [
  'Apa itu PPF dan manfaatnya?',
  'Berapa lama garansi Window Film?',
  'Cara merawat PPF setelah pasang?',
  'Bagaimana cara klaim garansi?',
];

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  text: 'Halo! Saya Asisten Ginnva 👋\n\nSaya siap membantumu seputar produk PPF, Window Film, prosedur garansi, dan perawatan film Ginnva.\n\nAda yang bisa saya bantu?',
};

// ─── Components ──────────────────────────────────────────────────────────────

type Styles = ReturnType<typeof createStyles>;

function UserBubble({ text, styles }: { text: string; styles: Styles }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{text}</Text>
      </View>
    </View>
  );
}

function Avatar({ styles }: { styles: Styles }) {
  return (
    <View style={styles.assistantAvatar}>
      <Ionicons name="sparkles" size={14} color="#ffffff" />
    </View>
  );
}

function AssistantBubble({ text, isError, styles }: { text: string; isError?: boolean; styles: Styles }) {
  return (
    <View style={styles.assistantRow}>
      <Avatar styles={styles} />
      <View style={[styles.assistantBubble, isError && styles.errorBubble]}>
        <Text style={[styles.assistantText, isError && styles.errorText]}>{text}</Text>
      </View>
    </View>
  );
}

// Titik ke-i mulai animasinya belakangan (staggerDelay * i) supaya
// terlihat "bergelombang" kiri-ke-kanan, bukan berdenyut bersamaan.
function TypingDot({ styles, delay }: { styles: Styles; delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 350, useNativeDriver: true }),
        Animated.delay(600 - delay),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, delay]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

function TypingIndicator({ styles }: { styles: Styles }) {
  return (
    <View style={styles.assistantRow}>
      <Avatar styles={styles} />
      <View style={styles.assistantBubble}>
        <View style={styles.typingDots}>
          <TypingDot styles={styles} delay={0} />
          <TypingDot styles={styles} delay={150} />
          <TypingDot styles={styles} delay={300} />
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function AiAssistantScreen() {
  const insets = useSafeAreaInsets();
  const { theme, colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<FlatList>(null);
  const { lift, onBoxLayout } = useKeyboardLift();

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;

      setInput('');

      const userMsg: Message = {
        id: `u_${Date.now()}`,
        role: 'user',
        text: trimmed,
      };

      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);
      scrollToBottom();

      // Siapkan history untuk dikirim ke backend (exclude welcome & error messages)
      const history = [...messages, userMsg]
        .filter((m) => m.id !== 'welcome' && !m.isError)
        .map((m) => ({ role: m.role, content: m.text }));

      try {
        const res = await apiFetch<{ reply: string }>('/api/chat', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ messages: history }),
        });

        const assistantMsg: Message = {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: res.reply,
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const errorMsg: Message = {
          id: `e_${Date.now()}`,
          role: 'assistant',
          isError: true,
          text:
            err instanceof ApiError
              ? err.message
              : 'Maaf, terjadi gangguan koneksi. Silakan coba lagi atau hubungi tim kami via WhatsApp.',
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
        scrollToBottom();
      }
    },
    [loading, messages, scrollToBottom]
  );

  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      if (item.role === 'user') return <UserBubble text={item.text} styles={styles} />;
      return <AssistantBubble text={item.text} isError={item.isError} styles={styles} />;
    },
    [styles]
  );

  const showSuggestions = messages.length === 1; // Hanya tampil saat baru buka
  const canSend = input.trim().length > 0 && !loading;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <LinearGradient pointerEvents="none" colors={[colors.accentSoft, 'transparent']} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 1 }} style={styles.glow} />

      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kembali">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerAvatar}>
          <Ionicons name="sparkles" size={18} color="#ffffff" />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>Asisten Ginnva</Text>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.headerSubtitle} numberOfLines={1}>Produk & Garansi</Text>
          </View>
        </View>
        <PressableScale style={styles.waButton} onPress={() => Linking.openURL(WA_URL)} accessibilityRole="button" accessibilityLabel="Hubungi sales lewat WhatsApp">
          <Ionicons name="logo-whatsapp" size={17} color="#ffffff" />
          <Text style={styles.waButtonText}>Sales</Text>
        </PressableScale>
      </View>

      <View style={styles.flex} onLayout={onBoxLayout}>
        <View style={[styles.flex, { marginBottom: lift }]}>
          <FlatList
            ref={listRef}
            style={styles.flex}
            data={messages}
            keyExtractor={(item, index) => item.id ?? String(index)}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={scrollToBottom}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            ListFooterComponent={loading ? <TypingIndicator styles={styles} /> : null}
          />

          {/* Pertanyaan umum — hanya tampil di awal */}
          {showSuggestions && !loading && (
            <View style={styles.suggestionsWrap}>
              <Text style={styles.suggestionsLabel}>Coba tanyakan</Text>
              <View style={styles.suggestionsRow}>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <PressableScale key={q} style={styles.suggestionChip} onPress={() => sendMessage(q)} accessibilityRole="button">
                    <Text style={styles.suggestionText}>{q}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          )}

          {/* Input */}
          <View style={[styles.inputWrap, { paddingBottom: (insets.bottom > 0 ? insets.bottom : spacing.sm) + spacing.sm }]}>
            <View style={styles.inputBox}>
              <AutoGrowTextInput
                style={styles.input}
                minHeight={48}
                maxHeight={110}
                value={input}
                onChangeText={setInput}
                placeholder="Ketik pertanyaanmu..."
                placeholderTextColor={colors.textMuted}
                maxLength={500}
              />
            </View>
            <Pressable
              style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
              onPress={() => sendMessage(input)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Kirim pertanyaan"
            >
              {loading ? <ActivityIndicator color="#ffffff" size="small" /> : <Ionicons name="send" size={18} color="#ffffff" />}
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: colors.bg },
    glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },

    // Header
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: spacing.md },
    backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceElevated },
    headerAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
    headerText: { flex: 1, gap: 2 },
    headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.textPrimary },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
    headerSubtitle: { flexShrink: 1, fontSize: 12, color: colors.textSecondary },
    waButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#25d366' },
    waButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },

    // List
    listContent: { paddingHorizontal: 24, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: 12 },

    // User bubble
    userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
    userBubble: { maxWidth: '80%', backgroundColor: colors.accent, borderRadius: 22, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 12 },
    userText: { color: '#ffffff', fontSize: 15, lineHeight: 22 },

    // Assistant bubble
    assistantRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
    assistantAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, flexShrink: 0 },
    assistantBubble: { flexShrink: 1, maxWidth: '82%', backgroundColor: colors.surfaceElevated, borderRadius: 22, borderBottomLeftRadius: 6, paddingHorizontal: 16, paddingVertical: 12 },
    errorBubble: { backgroundColor: colors.dangerBg },
    assistantText: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
    errorText: { color: colors.danger },

    // Typing indicator
    typingDots: { flexDirection: 'row', gap: 5, paddingVertical: 6, paddingHorizontal: 2, alignItems: 'center' },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textMuted },

    // Suggested questions
    suggestionsWrap: { paddingHorizontal: 24, paddingBottom: spacing.sm, gap: 10 },
    suggestionsLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textMuted },
    suggestionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    suggestionChip: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.accentSoft },
    suggestionText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.accent },

    // Input area
    inputWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 24, paddingTop: 10, backgroundColor: colors.bg },
    inputBox: { flex: 1, borderRadius: 24, backgroundColor: colors.surfaceElevated },
    input: { fontSize: 15, lineHeight: 21, paddingHorizontal: 18, paddingVertical: 13, color: colors.textPrimary },
    sendButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, flexShrink: 0 },
    sendButtonDisabled: { opacity: 0.4 },
  });
}
