import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";

import GlassCard from "../components/GlassCard";
import { useAppTheme } from "../lib/theme";
import { supabase } from "../lib/supabase";

type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Chats: undefined;
};

type PublicConversationMessagesResponse = {
  messages?: ChatMessage[];
  error?: string;
};

const apiBaseUrl =
  Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

async function fetchConversationMessages(conversationId: string): Promise<ChatMessage[]> {
  const urls = [
    `${apiBaseUrl}/api/chat/conversations/${conversationId}/messages`,
    `${apiBaseUrl}/api/chat/conversation/${conversationId}`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      const data = (await res.json()) as PublicConversationMessagesResponse;
      if (res.ok && Array.isArray(data?.messages)) {
        return data.messages;
      }
    } catch {
      // Try next endpoint
    }
  }

  throw new Error("Failed to load messages");
}

type Conversation = {
  id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  created_at: string;
  updated_at: string;
};

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

function formatDate(dateIso?: string) {
  if (!dateIso) return "";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function visitorInitials(c: Conversation | null) {
  if (!c) return "?";
  const name = (c.visitor_name || "").trim();
  const email = (c.visitor_email || "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    const local = email.split("@")[0] || email;
    return local.slice(0, 2).toUpperCase();
  }
  return "V";
}

export default function ChatsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const messagesScrollRef = useRef<ScrollView | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");

  const [loadingConv, setLoadingConv] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [updatingAi, setUpdatingAi] = useState(false);
  const [hasAdminAccess, setHasAdminAccess] = useState<boolean | null>(null);
  const [convError, setConvError] = useState<string>("");

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  const loadChatSettings = async () => {
    try {
      const { data, error } = await (supabase.from("chat_settings") as any)
        .select("ai_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (!error) setAiEnabled(data?.ai_enabled !== false);
    } catch {
      // Silent fail
    }
  };

  const loadConversations = async () => {
    setLoadingConv(true);
    setConvError("");
    try {
      const { data, error } = await (supabase.from("chat_conversations") as any)
        .select("id, visitor_name, visitor_email, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setConversations((data ?? []) as Conversation[]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load conversations.";
      setConvError(message);
      Alert.alert("Error", message);
    } finally {
      setLoadingConv(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    setLoadingMsg(true);
    setMessages([]);
    try {
      const messagesData = await fetchConversationMessages(conversationId);
      setMessages(messagesData);
    } catch {
      Alert.alert("Error", "Failed to load messages.");
    } finally {
      setLoadingMsg(false);
    }
  };

  useEffect(() => {
    async function bootstrap() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setHasAdminAccess(false);
        setConvError("No authenticated user found.");
        return;
      }

      const { data: teacher } = await (supabase.from("teachers") as any)
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      const isAdmin = (teacher?.role ?? "").toLowerCase() === "admin";
      setHasAdminAccess(isAdmin);
      if (!isAdmin) {
        setConvError("Your account is not admin (role must be 'admin').");
      }

      if (isAdmin) {
        loadChatSettings();
        loadConversations();
      }
    }

    bootstrap();
  }, []);

  useEffect(() => {
    if (!hasAdminAccess) return;
    const interval = setInterval(() => {
      (supabase.from("chat_conversations") as any)
        .select("id, visitor_name, visitor_email, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100)
        .then(({ data }: { data: Conversation[] | null }) => setConversations((data ?? []) as Conversation[]))
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [hasAdminAccess]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !hasAdminAccess) return;
    const interval = setInterval(() => {
      fetchConversationMessages(selectedId)
        .then((messagesData) => setMessages(messagesData))
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [selectedId, hasAdminAccess]);

  const toggleAi = async () => {
    const next = !aiEnabled;
    setUpdatingAi(true);
    try {
      const { error } = await (supabase.from("chat_settings") as any)
        .update({ ai_enabled: next })
        .eq("id", 1);
      if (error) throw error;
      setAiEnabled(next);
    } catch {
      Alert.alert("Error", "Failed to update AI setting.");
    } finally {
      setUpdatingAi(false);
    }
  };

  const sendReply = async () => {
    const text = reply.trim();
    if (!selectedId || !text || sending) return;
    setSending(true);
    setReply("");

    try {
      const { error } = await (supabase.from("chat_messages") as any).insert({
        conversation_id: selectedId,
        role: "admin",
        content: text,
      });
      if (error) throw error;

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          role: "admin",
          content: text,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch {
      setReply(text);
      Alert.alert("Error", "Failed to send reply.");
    } finally {
      setSending(false);
    }
  };

  const deleteConversation = async () => {
    if (!selectedId || deleting) return;
    Alert.alert("Delete conversation", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await (supabase.from("chat_conversations") as any)
              .delete()
              .eq("id", selectedId);
            if (error) throw error;

            setConversations((prev) => prev.filter((c) => c.id !== selectedId));
            setSelectedId(null);
            setMessages([]);
          } catch {
            Alert.alert("Error", "Failed to delete conversation.");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          position: "absolute",
          top: 36,
          right: -48,
          width: 160,
          height: 160,
          borderRadius: 80,
          backgroundColor: theme.colors.primarySoft,
        }}
        pointerEvents="none"
      />
      <View
        style={{
          position: "absolute",
          bottom: 100,
          left: -56,
          width: 140,
          height: 140,
          borderRadius: 70,
          backgroundColor: theme.colors.violetSoft,
        }}
        pointerEvents="none"
      />

      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          backgroundColor: theme.isDark ? theme.colors.background : "#FFFFFF",
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          paddingHorizontal: 16,
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          onPress={() => navigation.navigate("Dashboard", { openDrawer: true })}
          activeOpacity={0.85}
          style={{
            height: 44,
            width: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.surfaceGlass,
          }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>

        <View style={{ flex: 1, paddingHorizontal: 10 }}>
          <Text style={theme.typography.label}>Admin</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Chats</Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            borderRadius: 12,
            paddingLeft: 4,
            paddingRight: 4,
            paddingVertical: 6,
            gap: 6,
            opacity: hasAdminAccess === false ? 0.45 : 1,
          }}
        >
          <Ionicons name="sparkles-outline" size={16} color={theme.colors.primary} />
          <Text style={[theme.typography.caption, { color: theme.colors.text, fontWeight: "700", fontSize: 11 }]}>
            AI
          </Text>
          <Switch
            value={aiEnabled}
            onValueChange={toggleAi}
            disabled={updatingAi || hasAdminAccess === false}
            thumbColor={aiEnabled ? theme.colors.primary : "#F8FAFC"}
            trackColor={{ false: "#CBD5E1", true: theme.colors.primarySoft }}
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: Math.max(insets.top, 8) + 62, paddingBottom: 12 }}>
        {hasAdminAccess === false ? (
          <GlassCard style={{ borderRadius: 12 }} padding={20}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: theme.colors.dangerSoft,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <Ionicons name="lock-closed-outline" size={24} color={theme.colors.danger} />
            </View>
            <Text style={theme.typography.title}>Admin only</Text>
            <Text style={[theme.typography.body, { marginTop: 8, color: theme.colors.textMuted }]}>
              You need an admin account to access support chats.
            </Text>
            {convError ? (
              <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.danger, lineHeight: 18 }]}>
                {convError}
              </Text>
            ) : null}
          </GlassCard>
        ) : null}

        {hasAdminAccess !== false ? (
          <>
            <GlassCard style={{ marginBottom: 12, borderRadius: 12 }} padding={0}>
              <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      backgroundColor: theme.colors.primarySoft,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Ionicons name="chatbubbles-outline" size={22} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.label, { color: theme.colors.primary }]}>Inbox</Text>
                    <Text style={[theme.typography.title, { marginTop: 2, fontSize: 20, lineHeight: 26 }]}>
                      Conversations
                    </Text>
                  </View>
                  {!loadingConv ? (
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: theme.colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <Text style={[theme.typography.caption, { fontWeight: "700", color: theme.colors.textMuted }]}>
                        {conversations.length}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted, lineHeight: 18 }]}>
                  Visitor threads from the site widget. Tap one to open messages.
                </Text>
              </View>

              <View style={{ height: 1, backgroundColor: theme.colors.border, marginHorizontal: 18, opacity: 0.85 }} />

              <View style={{ paddingVertical: 14, paddingHorizontal: 14 }}>
                {loadingConv ? (
                  <View style={{ paddingVertical: 20, alignItems: "center" }}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.textMuted }]}>
                      Loading conversations…
                    </Text>
                  </View>
                ) : conversations.length === 0 ? (
                  <View style={{ paddingVertical: 16, alignItems: "center" }}>
                    <View
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 12,
                        backgroundColor: theme.colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 10,
                      }}
                    >
                      <Ionicons name="mail-open-outline" size={26} color={theme.colors.textMuted} />
                    </View>
                    <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]}>No conversations yet</Text>
                    <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted, textAlign: "center" }]}>
                      New visitor chats will show up here.
                    </Text>
                    {convError ? (
                      <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.danger, textAlign: "center" }]}>
                        {convError}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 10, paddingVertical: 2, paddingHorizontal: 4 }}
                  >
                    {conversations.map((c) => {
                      const active = selectedId === c.id;
                      const label = c.visitor_name || c.visitor_email || "Visitor";
                      return (
                        <TouchableOpacity
                          key={c.id}
                          onPress={() => setSelectedId(c.id)}
                          activeOpacity={0.85}
                          style={{
                            minWidth: 168,
                            maxWidth: 220,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: active ? theme.colors.primary : theme.colors.border,
                            backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                            padding: 12,
                            flexDirection: "row",
                            alignItems: "center",
                          }}
                        >
                          <View
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 10,
                              backgroundColor: active ? theme.colors.background : theme.colors.surfaceGlass,
                              borderWidth: active ? 0 : 1,
                              borderColor: theme.colors.border,
                              alignItems: "center",
                              justifyContent: "center",
                              marginRight: 10,
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: "800", color: theme.colors.primary }}>
                              {visitorInitials(c)}
                            </Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[theme.typography.bodyStrong, { fontSize: 15 }]} numberOfLines={1}>
                              {label}
                            </Text>
                            <Text style={[theme.typography.caption, { marginTop: 3, color: theme.colors.textMuted }]} numberOfLines={1}>
                              {formatDate(c.updated_at)}
                            </Text>
                          </View>
                          {active ? (
                            <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} style={{ marginLeft: 4 }} />
                          ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </GlassCard>

            <GlassCard style={{ flex: 1, borderRadius: 12, minHeight: 280 }} contentStyle={{ flex: 1 }} padding={0}>
              {!selectedId ? (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 16,
                      backgroundColor: theme.colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 14,
                    }}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={30} color={theme.colors.textMuted} />
                  </View>
                  <Text style={[theme.typography.title, { fontSize: 18 }]}>Select a conversation</Text>
                  <Text
                    style={[
                      theme.typography.caption,
                      { marginTop: 8, color: theme.colors.textMuted, textAlign: "center", maxWidth: 260, lineHeight: 20 },
                    ]}
                  >
                    Choose a thread above to read and reply. Messages refresh every few seconds.
                  </Text>
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View
                    style={{
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                      paddingHorizontal: 18,
                      paddingVertical: 14,
                      flexDirection: "row",
                      alignItems: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: theme.colors.primarySoft,
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}
                    >
                      <Text style={{ fontSize: 15, fontWeight: "800", color: theme.colors.primary }}>
                        {visitorInitials(selectedConversation)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                      <Text style={[theme.typography.bodyStrong, { fontSize: 17 }]} numberOfLines={1}>
                        {selectedConversation?.visitor_name || selectedConversation?.visitor_email || "Visitor"}
                      </Text>
                      {selectedConversation?.visitor_email ? (
                        <Text
                          style={[theme.typography.caption, { marginTop: 3, color: theme.colors.textMuted }]}
                          numberOfLines={1}
                        >
                          {selectedConversation.visitor_email}
                        </Text>
                      ) : (
                        <Text style={[theme.typography.caption, { marginTop: 3, color: theme.colors.textMuted }]}>
                          Active chat
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity onPress={deleteConversation} activeOpacity={0.85} disabled={deleting}>
                      <View
                        style={{
                          height: 44,
                          width: 44,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: theme.colors.surfaceAlt,
                        }}
                      >
                        {deleting ? (
                          <ActivityIndicator size="small" color={theme.colors.textMuted} />
                        ) : (
                          <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    ref={messagesScrollRef}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}
                    onContentSizeChange={() => messagesScrollRef.current?.scrollToEnd({ animated: true })}
                  >
                    {loadingMsg ? (
                      <View style={{ paddingVertical: 28, alignItems: "center" }}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                        <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.textMuted }]}>
                          Loading messages…
                        </Text>
                      </View>
                    ) : messages.length === 0 ? (
                      <View
                        style={{
                          minHeight: 140,
                          alignItems: "center",
                          justifyContent: "center",
                          paddingVertical: 24,
                        }}
                      >
                        <Ionicons name="document-text-outline" size={28} color={theme.colors.textMuted} />
                        <Text style={[theme.typography.caption, { marginTop: 12, color: theme.colors.textMuted, textAlign: "center" }]}>
                          No message history for this conversation yet.
                        </Text>
                      </View>
                    ) : (
                      messages.map((m) => {
                        const isVisitor = m.role === "user";
                        const isAdminMessage = m.role === "admin";
                        const bubbleBg = isAdminMessage ? theme.colors.primary : theme.colors.surfaceAlt;
                        const bubbleText = isAdminMessage ? theme.colors.primaryText : theme.colors.text;
                        const roleLabel = m.role === "user" ? "Visitor" : m.role === "admin" ? "You" : "AI";

                        return (
                          <View
                            key={m.id}
                            style={{
                              alignItems: isVisitor ? "flex-start" : "flex-end",
                            }}
                          >
                            <View
                              style={{
                                maxWidth: "88%",
                                borderRadius: 12,
                                paddingHorizontal: 14,
                                paddingVertical: 10,
                                backgroundColor: bubbleBg,
                                borderWidth: isAdminMessage ? 0 : 1,
                                borderColor: theme.colors.border,
                              }}
                            >
                              <Text
                                style={[
                                  theme.typography.caption,
                                  {
                                    color: isAdminMessage ? "rgba(255,255,255,0.85)" : theme.colors.textSoft,
                                    marginBottom: 4,
                                    fontWeight: "700",
                                    fontSize: 11,
                                    letterSpacing: 0.5,
                                    textTransform: "uppercase",
                                  },
                                ]}
                              >
                                {roleLabel}
                              </Text>
                              <Text style={[theme.typography.body, { color: bubbleText, lineHeight: 22 }]}>{m.content}</Text>
                              <Text
                                style={[
                                  theme.typography.caption,
                                  {
                                    marginTop: 6,
                                    fontSize: 11,
                                    color: isAdminMessage ? "rgba(255,255,255,0.65)" : theme.colors.textMuted,
                                  },
                                ]}
                              >
                                {formatDate(m.created_at)}
                              </Text>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </ScrollView>

                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: theme.colors.border,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      backgroundColor: theme.colors.surfaceAlt,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
                      <TextInput
                        value={reply}
                        onChangeText={setReply}
                        placeholder="Write a reply…"
                        placeholderTextColor={theme.colors.textMuted}
                        multiline
                        style={{
                          flex: 1,
                          minHeight: 48,
                          maxHeight: 120,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.background,
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          color: theme.colors.text,
                          fontSize: 16,
                          lineHeight: 22,
                        }}
                      />
                      <TouchableOpacity
                        onPress={sendReply}
                        activeOpacity={0.85}
                        disabled={sending || !reply.trim()}
                        style={{
                          height: 48,
                          width: 48,
                          borderRadius: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor:
                            sending || !reply.trim() ? theme.colors.borderStrong : theme.colors.primary,
                        }}
                      >
                        {sending ? (
                          <ActivityIndicator size="small" color={theme.colors.primaryText} />
                        ) : (
                          <Ionicons name="send" size={20} color={theme.colors.primaryText} />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </GlassCard>
          </>
        ) : null}
      </View>
    </View>
  );
}
