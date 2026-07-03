/**
 * app/(tabs)/chat.tsx
 *
 * Asisten AI Ginnva — powered by Claude (claude-haiku-4-5).
 * Knowledge base: PPF & Window Film product info, garansi, perawatan, FAQ,
 * SOP after-sales, dan hand-off ke WhatsApp sales jika tidak bisa jawab.
 *
 * Catatan implementasi:
 * - API key TIDAK disimpan di sini. Request diroute lewat backend Laravel
 *   di endpoint POST /api/chat, yang kemudian forward ke Anthropic API.
 *   Ini supaya API key aman di server, tidak ter-bundle ke APK.
 * - Conversation history dikirim tiap request (stateless dari sisi server).
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  text: string;
  isError?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WA_NUMBER = '628118681678'; // TODO: ganti nomor WA sales Ginnva Indonesia
const WA_URL = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Halo, saya ingin bertanya lebih lanjut tentang produk Ginnva.')}`;

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

function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{text}</Text>
      </View>
    </View>
  );
}

function AssistantBubble({ text, isError }: { text: string; isError?: boolean }) {
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

function TypingIndicator() {
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantAvatar}>
        <Text style={styles.avatarText}>G</Text>
      </View>
      <View style={styles.assistantBubble}>
        <View style={styles.typingDots}>
          <View style={[styles.dot, styles.dot1]} />
          <View style={[styles.dot, styles.dot2]} />
          <View style={[styles.dot, styles.dot3]} />
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
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
      if (item.role === 'user') return <UserBubble text={item.text} />;
      return <AssistantBubble text={item.text} isError={item.isError} />;
    },
    []
  );

  const showSuggestions = messages.length === 1; // Hanya tampil saat baru buka

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
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
          onPress={() => {
            const { Linking } = require('react-native');
            Linking.openURL(WA_URL);
          }}
        >
          <Ionicons name="logo-whatsapp" size={18} color={colors.white} />
          <Text style={styles.waButtonText}>Sales</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Message list */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToBottom}
          ListFooterComponent={loading ? <TypingIndicator /> : null}
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
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ketik pertanyaan Anda..."
            placeholderTextColor={colors.mutedLight}
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
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons name="send" size={18} color={colors.white} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: colors.alt,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
    color: colors.white,
    fontWeight: '800',
    fontSize: fontSize.base,
  },
  headerTitle: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
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
    color: colors.white,
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
    color: colors.white,
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
    color: colors.white,
    fontWeight: '800',
    fontSize: fontSize.xs,
  },
  assistantBubble: {
    maxWidth: '78%',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderBottomLeftRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  errorBubble: {
    backgroundColor: '#fde8e8',
  },
  assistantText: {
    color: colors.ink,
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
    backgroundColor: colors.mutedLight,
  },
  dot1: { opacity: 1 },
  dot2: { opacity: 0.6 },
  dot3: { opacity: 0.3 },

  // Suggested questions
  suggestionsWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  suggestionsLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  suggestionChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
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
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    backgroundColor: colors.alt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: fontSize.sm,
    color: colors.ink,
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
    backgroundColor: colors.mutedLight,
  },
});