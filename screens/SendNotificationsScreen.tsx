import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";

import GlassCard from "../components/GlassCard";
import AppButton from "../components/AppButton";
import { useAppTheme } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { sendAdminNotifications } from "../lib/sendAdminNotifications";

type RootStackParamList = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  SendNotifications: undefined;
};

type Audience = "teachers" | "principals" | "both";

const AUDIENCE_OPTIONS: { id: Audience; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "teachers", label: "All teachers", hint: "Teachers and admins", icon: "people-outline" },
  { id: "principals", label: "All principals", hint: "Principal role only", icon: "ribbon-outline" },
  { id: "both", label: "Everyone", hint: "Teachers, admins & principals", icon: "globe-outline" },
];

export default function SendNotificationsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const [loading, setLoading] = useState(true);
  const [adminOk, setAdminOk] = useState<boolean | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("teachers");

  const [sending, setSending] = useState(false);
  const [sendingError, setSendingError] = useState<string | null>(null);

  const audienceLabel = useMemo(() => {
    switch (audience) {
      case "principals":
        return "All principals";
      case "both":
        return "Teachers and principals";
      default:
        return "All teachers";
    }
  }, [audience]);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      setLoading(true);
      setFatalError(null);
      setSendingError(null);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (!mounted) return;
          setAdminOk(false);
          setFatalError("No authenticated user found.");
          return;
        }

        const { data: teacher } = await (supabase.from("teachers") as any)
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();

        const role = (teacher?.role ?? "").toLowerCase();
        const isAdmin = role === "admin";

        if (!mounted) return;
        setAdminOk(isAdmin);
        if (!isAdmin) {
          setFatalError("Your account is not admin (role must be 'admin').");
        }
      } catch (e) {
        if (!mounted) return;
        const msg = e instanceof Error ? e.message : "Failed to load permissions.";
        setAdminOk(false);
        setFatalError(msg);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  const sendNotification = async () => {
    setSendingError(null);

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle) {
      setSendingError("Please enter a title.");
      return;
    }

    setSending(true);
    try {
      const result = await sendAdminNotifications({
        title: trimmedTitle,
        body: trimmedBody || null,
        audience,
      });

      Alert.alert(
        "Sent",
        result.sent > 0
          ? `Notification delivered to ${result.sent} recipient${result.sent === 1 ? "" : "s"}.`
          : result.message || "No recipients found."
      );
      setTitle("");
      setBody("");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const lower = raw.toLowerCase();
      const rlsBlocked =
        lower.includes("row-level security") ||
        lower.includes("rls") ||
        lower.includes("policy") ||
        raw.includes("42501");

      let msg = raw;
      if (rlsBlocked) {
        msg =
          "Insert was blocked by Row Level Security. If you haven’t already, apply the optional SQL policy in eluency-mobile/docs/optional-supabase-rls-admin-notifications-from-app.sql in the Supabase SQL editor, or send from the web dashboard.";
      }
      setSendingError(msg);
    } finally {
      setSending(false);
    }
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
          bottom: 120,
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
          paddingHorizontal: 20,
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
          activeOpacity={0.8}
          style={{
            height: 44,
            width: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceGlass,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>

        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <Text style={theme.typography.label}>Admin</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Notifications</Text>
        </View>

        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: Math.max(insets.top, 8) + 62,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <GlassCard style={{ borderRadius: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[theme.typography.body, { marginLeft: 12 }]}>Loading…</Text>
            </View>
          </GlassCard>
        ) : !adminOk ? (
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
              {fatalError ?? "You don’t have access to this screen."}
            </Text>
          </GlassCard>
        ) : (
          <GlassCard style={{ borderRadius: 12 }} padding={0}>
            <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
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
                  <Ionicons name="megaphone-outline" size={22} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[theme.typography.label, { color: theme.colors.primary }]}>Broadcast</Text>
                  <Text style={[theme.typography.title, { marginTop: 2, fontSize: 20, lineHeight: 26 }]}>
                    Send notification
                  </Text>
                </View>
              </View>
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted, lineHeight: 20 }]}>
                In-app message for your team. Recipients see it in the dashboard notification bell.
              </Text>
            </View>

            <View style={{ height: 1, backgroundColor: theme.colors.border, marginHorizontal: 20, opacity: 0.85 }} />

            <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 }}>
              <Text style={[theme.typography.label, { letterSpacing: 1.1 }]}>Audience</Text>
              <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]}>
                Currently: {audienceLabel}
              </Text>

              <View style={{ marginTop: 14, gap: 10 }}>
                {AUDIENCE_OPTIONS.map((opt) => {
                  const active = audience === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      onPress={() => setAudience(opt.id)}
                      activeOpacity={0.85}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        paddingVertical: 14,
                        paddingHorizontal: 14,
                      }}
                    >
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          backgroundColor: active ? theme.colors.background : theme.colors.surfaceGlass,
                          alignItems: "center",
                          justifyContent: "center",
                          marginRight: 12,
                          borderWidth: active ? 0 : 1,
                          borderColor: theme.colors.border,
                        }}
                      >
                        <Ionicons name={opt.icon} size={20} color={active ? theme.colors.primary : theme.colors.textMuted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[theme.typography.bodyStrong, { fontSize: 16 }]}>{opt.label}</Text>
                        <Text style={[theme.typography.caption, { marginTop: 2, color: theme.colors.textMuted }]}>{opt.hint}</Text>
                      </View>
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          borderWidth: 2,
                          borderColor: active ? theme.colors.primary : theme.colors.borderStrong,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {active ? (
                          <View
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 5,
                              backgroundColor: theme.colors.primary,
                            }}
                          />
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: theme.colors.border, marginHorizontal: 20, opacity: 0.85 }} />

            <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22 }}>
              <Text style={[theme.typography.label, { letterSpacing: 1.1 }]}>Content</Text>

              <Text style={[theme.typography.caption, { marginTop: 14, color: theme.colors.textMuted }]}>
                Title <Text style={{ color: theme.colors.danger }}>*</Text>
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Scheduled maintenance this weekend"
                placeholderTextColor={theme.colors.textMuted}
                maxLength={200}
                style={{
                  marginTop: 8,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceAlt,
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  color: theme.colors.text,
                  fontSize: 16,
                  lineHeight: 22,
                }}
              />
              <Text style={[theme.typography.caption, { marginTop: 6, alignSelf: "flex-end", color: theme.colors.textMuted }]}>
                {title.length}/200
              </Text>

              <Text style={[theme.typography.caption, { marginTop: 14, color: theme.colors.textMuted }]}>Message (optional)</Text>
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder="Details, links, or instructions…"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                textAlignVertical="top"
                style={{
                  marginTop: 8,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceAlt,
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  color: theme.colors.text,
                  fontSize: 16,
                  lineHeight: 22,
                  minHeight: 128,
                }}
              />

              {sendingError ? (
                <View
                  style={{
                    marginTop: 16,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.colors.dangerSoft,
                    backgroundColor: theme.colors.dangerSoft,
                    padding: 14,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
                    <Text style={{ color: theme.colors.danger, fontWeight: "700", fontSize: 14 }}>Something went wrong</Text>
                  </View>
                  <Text style={{ marginTop: 8, color: theme.colors.textMuted, fontSize: 14, lineHeight: 20 }}>{sendingError}</Text>
                </View>
              ) : null}

              <View style={{ marginTop: 20 }}>
                <AppButton
                  label={sending ? "Sending…" : "Send notification"}
                  onPress={sendNotification}
                  loading={sending}
                  disabled={!title.trim()}
                  variant="primary"
                  icon={<Ionicons name="send" size={18} color={theme.colors.primaryText} />}
                />
              </View>
            </View>
          </GlassCard>
        )}
      </ScrollView>
    </View>
  );
}
