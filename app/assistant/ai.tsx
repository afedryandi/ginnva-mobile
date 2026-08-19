/**
 * app/assistant/ai.tsx
 *
 * Asisten AI Ginnva — powered by Groq (llama-3.1-8b-instant).
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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { darkColors, fontSize, radius, spacing } from '@/constants/theme';
import { SALES_WA_NUMBER } from '@/constants/contact';
import { apiFetch, ApiError } from '@/lib/api';
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
  text: 'Halo! Saya Asisten Ginnva 👋\n\nSaya siap membantu Anda seputar produk PPF, Window Film, prosedur garansi, dan perawatan film Ginnva.\n\nAda yang bisa saya bantu?',
};

// ─── Components ──────────────────────────────────────────────────────────────

function UserBubble({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{text}</Text>
      </View>
    </View>
  );
}

function AssistantBubble({ text, isError, styles }: { text: string; isError?: boolean; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantAvatar}>
        <Text style={styles.avatarText}>G</Text>
      </View>
      <View style={[styles.assistantBubble, isError && styles.errorBubble]}>
        <Text style={[styles.assistantText, isError && styles.errorText]}>{text}</Text>
      </View>
    </View>
  );
}

// Titik ke-i mulai animasinya belakangan (staggerDelay * i) supaya
// terlihat "bergelombang" kiri-ke-kanan, bukan berdenyut bersamaan.
function TypingDot({ styles, delay }: { styles: ReturnType<typeof createStyles>; delay: number }) {
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

function TypingIndicator({ styles }: { styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantAvatar}>
        <Text style={styles.avatarText}>G</Text>
      </View>
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
  const [headerHeight, setHeaderHeight] = useState(55);
  const listRef = useRef<FlatList>(null);

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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {/* Header */}
      <View style={styles.header} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>G</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>Asisten Ginnva</Text>
            <Text style={styles.headerSubtitle}>AI · Produk & Garansi</Text>
          </View>
        </View>
        <Pressable
          style={styles.waButton}
          onPress={() => Linking.openURL(WA_URL)}
        >
          <Ionicons name="logo-whatsapp" size={18} color="#ffffff" />
          <Text style={styles.waButtonText}>Sales</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + headerHeight : 0}
      >
        {/* Message list */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item, index) => item.id ?? String(index)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToBottom}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListFooterComponent={loading ? <TypingIndicator styles={styles} /> : null}
        />

        {/* Suggested questions — hanya tampil di awal */}
        {showSuggestions && !loading && (
          <View style={styles.suggestionsWrap}>
            <Text style={styles.suggestionsLabel}>Pertanyaan umum:</Text>
            <View style={styles.suggestionsRow}>
              {SUGGESTED_QUESTIONS.map((q) => (
                <Pressable key={q} style={styles.suggestionChip} onPress={() => sendMessage(q)}>
                  <Text style={styles.suggestionText}>{q}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Input */}
        <View style={[styles.inputWrap, { paddingBottom: insets.bottom > 0 ? insets.bottom : spacing.sm }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ketik pertanyaan Anda..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => sendMessage(input)}
            blurOnSubmit
          />
          <Pressable
            style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Ionicons name="send" size={18} color="#ffffff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function createStyles(colors: typeof darkColors) {
  return StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: fontSize.base,
  },
  headerTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  waButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#25d366',
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  waButtonText: {
    color: '#ffffff',
    fontSize: fontSize.xs,
    fontWeight: '700',
  },

  // List
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },

  // User bubble
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '78%',
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userText: {
    color: '#ffffff',
    fontSize: fontSize.sm,
    lineHeight: 20,
  },

  // Assistant bubble
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  assistantAvatar: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: fontSize.xs,
  },
  assistantBubble: {
    maxWidth: '78%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderBottomLeftRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorBubble: {
    backgroundColor: colors.dangerBg,
  },
  assistantText: {
    color: colors.textPrimary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
  },

  // Typing indicator
  typingDots: {
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 4,
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },

  // Suggested questions
  suggestionsWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  suggestionsLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  suggestionChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  suggestionText: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: '600',
  },

  // Input area
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendButtonDisabled: {
    backgroundColor: colors.textMuted,
  },
  });
}
