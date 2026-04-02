import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";

type RootStackParamList = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Settings: undefined;
  Subscription: undefined;
};

type SettingsTab = "profile" | "security" | "notifications" | "preferences" | "plan";
type LanguagePairCode = "en-pt" | "en-es" | "en-fr" | "pt-es";

type PlanInfo = {
  plan: string;
  student_limit: number | null;
  lesson_limit?: number | null;
  test_limit?: number | null;
  preset_limit?: number | null;
};

const LANGUAGE_PAIRS: { code: LanguagePairCode; fullLabel: string }[] = [
  { code: "en-pt", fullLabel: "English ↔ Portuguese" },
  { code: "en-es", fullLabel: "English ↔ Spanish" },
  { code: "en-fr", fullLabel: "English ↔ French" },
  { code: "pt-es", fullLabel: "Portuguese ↔ Spanish" },
];

export default function SettingsScreen() {
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({ name: "", email: "" });
  const [originalEmail, setOriginalEmail] = useState("");
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [studentCount, setStudentCount] = useState(0);
  const [defaultLanguagePair, setDefaultLanguagePair] = useState<LanguagePairCode>("en-pt");
  const [passwords, setPasswords] = useState({ newPassword: "", confirmPassword: "" });

  const passwordsMatch =
    passwords.confirmPassword.length > 0 && passwords.confirmPassword === passwords.newPassword;

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProfileLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mounted || !user) return;

        let displayName = (user.user_metadata?.name as string) || "";
        const { data: teacher } = await (supabase.from("teachers") as any)
          .select("name, plan, student_limit, lesson_limit, test_limit, preset_limit, default_language_pair")
          .eq("user_id", user.id)
          .maybeSingle();

        if (teacher?.name) displayName = teacher.name;
        const email = user.email ?? "";

        if (!mounted) return;
        setProfile({ name: displayName, email });
        setOriginalEmail(email);

        if (teacher) {
          setPlanInfo({
            plan: teacher.plan ?? "Free",
            student_limit: teacher.student_limit ?? null,
            lesson_limit: teacher.lesson_limit ?? null,
            test_limit: teacher.test_limit ?? null,
            preset_limit: teacher.preset_limit ?? null,
          });
          const dbPair = (teacher.default_language_pair ?? "").trim() as LanguagePairCode;
          if (LANGUAGE_PAIRS.some((p) => p.code === dbPair)) setDefaultLanguagePair(dbPair);
        }

        const { count } = await (supabase.from("students") as any)
          .select("*", { count: "exact", head: true })
          .eq("teacher_id", user.id);
        if (!mounted) return;
        setStudentCount(count ?? 0);
      } catch (err) {
        if (!mounted) return;
        const msg = err instanceof Error ? err.message : "Failed to load settings.";
        Alert.alert("Error", msg);
      } finally {
        if (mounted) setProfileLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const updateProfile = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: authError } = await supabase.auth.updateUser({
        email: profile.email.trim(),
        data: { name: profile.name.trim() },
      });
      if (authError) throw authError;

      if (user?.id && profile.name.trim()) {
        const { error: teacherError } = await (supabase.from("teachers") as any)
          .update({ name: profile.name.trim() })
          .eq("user_id", user.id);
        if (teacherError) throw teacherError;
      }

      Alert.alert(
        "Saved",
        profile.email.trim() !== originalEmail
          ? "Profile saved. Check your new email address to confirm the change."
          : "Profile saved."
      );
      setOriginalEmail(profile.email.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update profile.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  const updatePassword = async () => {
    if (saving) return;
    if (passwords.newPassword.length < 8) {
      Alert.alert("Password", "Password must be at least 8 characters.");
      return;
    }
    if (passwords.newPassword !== passwords.confirmPassword) {
      Alert.alert("Password", "Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwords.newPassword });
      if (error) throw error;
      setPasswords({ newPassword: "", confirmPassword: "" });
      Alert.alert("Saved", "Password updated successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update password.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  const saveDefaultLanguagePair = async (value: LanguagePairCode) => {
    setDefaultLanguagePair(value);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await (supabase.from("teachers") as any).update({ default_language_pair: value }).eq("user_id", user.id);
      Alert.alert("Saved", "Default language pair updated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save preference.";
      Alert.alert("Error", msg);
    }
  };

  const openDeleteMail = async () => {
    const url =
      "mailto:nathan@eluency.com?subject=Account%20Deletion%20Request&body=Please%20delete%20my%20Eluency%20account%20and%20all%20associated%20data.";
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert("Not available", "No email app available on this device.");
      return;
    }
    await Linking.openURL(url);
  };

  const tabs = useMemo(
    () => [
      { id: "profile" as const, label: "Profile", icon: "person-outline" as const },
      { id: "security" as const, label: "Security", icon: "shield-outline" as const },
      { id: "notifications" as const, label: "Notifications", icon: "notifications-outline" as const },
      { id: "preferences" as const, label: "Preferences", icon: "language-outline" as const },
      { id: "plan" as const, label: "Plan", icon: "diamond-outline" as const },
    ],
    []
  );

  const limitRows = [
    { label: "Lessons", value: planInfo?.lesson_limit },
    { label: "Tests", value: planInfo?.test_limit },
    { label: "Presets", value: planInfo?.preset_limit },
  ].filter((r) => r.value != null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          position: "absolute",
          top: 34,
          right: -52,
          width: 170,
          height: 170,
          borderRadius: 85,
          backgroundColor: theme.colors.primarySoft,
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
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 10,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
        }}
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
            backgroundColor: theme.colors.surfaceGlass,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 10 }}>
          <Text style={theme.typography.label}>Account</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Settings</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 8) + 62,
          paddingHorizontal: 20,
          paddingBottom: 34,
        }}
      >
        {profileLoading ? (
          <GlassCard style={{ borderRadius: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[theme.typography.body, { marginLeft: 10 }]}>Loading settings…</Text>
            </View>
          </GlassCard>
        ) : (
          <>
            <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={12}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {tabs.map((tab) => {
                  const active = activeTab === tab.id;
                  return (
                    <TouchableOpacity
                      key={tab.id}
                      onPress={() => setActiveTab(tab.id)}
                      activeOpacity={0.85}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: active ? theme.colors.primary : theme.colors.border,
                        backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                    >
                      <Ionicons
                        name={tab.icon}
                        size={16}
                        color={active ? theme.colors.primary : theme.colors.textMuted}
                      />
                      <Text
                        style={[
                          theme.typography.caption,
                          { marginLeft: 6, color: active ? theme.colors.primary : theme.colors.text },
                        ]}
                      >
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </GlassCard>

            {activeTab === "profile" && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={16}>
                <Text style={theme.typography.label}>Profile</Text>
                <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]}>
                  Update your account information.
                </Text>

                <View style={{ marginTop: 14 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Full name</Text>
                  <TextInput
                    value={profile.name}
                    onChangeText={(v) => setProfile((p) => ({ ...p, name: v }))}
                    placeholder="e.g. Maria Santos"
                    placeholderTextColor={theme.colors.textMuted}
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
                    }}
                  />
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Email</Text>
                  <TextInput
                    value={profile.email}
                    onChangeText={(v) => setProfile((p) => ({ ...p, email: v }))}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholder="email@example.com"
                    placeholderTextColor={theme.colors.textMuted}
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
                    }}
                  />
                  {profile.email.trim() !== originalEmail ? (
                    <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.primary }]}>
                      You will need to confirm the new email address.
                    </Text>
                  ) : null}
                </View>

                <View style={{ marginTop: 16 }}>
                  <AppButton
                    label={saving ? "Saving..." : "Save profile"}
                    onPress={updateProfile}
                    loading={saving}
                    icon={<Ionicons name="save-outline" size={18} color={theme.colors.primaryText} />}
                  />
                </View>
              </GlassCard>
            )}

            {activeTab === "security" && (
              <>
                <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={16}>
                  <Text style={theme.typography.label}>Change password</Text>
                  <TextInput
                    value={passwords.newPassword}
                    onChangeText={(v) => setPasswords((p) => ({ ...p, newPassword: v }))}
                    secureTextEntry
                    placeholder="New password (min 8 chars)"
                    placeholderTextColor={theme.colors.textMuted}
                    style={{
                      marginTop: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surfaceAlt,
                      paddingHorizontal: 14,
                      paddingVertical: 14,
                      color: theme.colors.text,
                      fontSize: 16,
                    }}
                  />
                  <TextInput
                    value={passwords.confirmPassword}
                    onChangeText={(v) => setPasswords((p) => ({ ...p, confirmPassword: v }))}
                    secureTextEntry
                    placeholder="Confirm password"
                    placeholderTextColor={theme.colors.textMuted}
                    style={{
                      marginTop: 10,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: passwords.confirmPassword.length
                        ? passwordsMatch
                          ? theme.colors.success
                          : theme.colors.danger
                        : theme.colors.border,
                      backgroundColor: theme.colors.surfaceAlt,
                      paddingHorizontal: 14,
                      paddingVertical: 14,
                      color: theme.colors.text,
                      fontSize: 16,
                    }}
                  />
                  {passwords.confirmPassword.length ? (
                    <Text
                      style={[
                        theme.typography.caption,
                        { marginTop: 8, color: passwordsMatch ? theme.colors.success : theme.colors.danger },
                      ]}
                    >
                      {passwordsMatch ? "Passwords match." : "Passwords do not match."}
                    </Text>
                  ) : null}
                  <View style={{ marginTop: 16 }}>
                    <AppButton
                      label={saving ? "Updating..." : "Update password"}
                      onPress={updatePassword}
                      loading={saving}
                      icon={<Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.primaryText} />}
                    />
                  </View>
                </GlassCard>

                <GlassCard
                  style={{ borderRadius: 12, marginBottom: 12, borderColor: theme.colors.dangerSoft, borderWidth: 1 }}
                  padding={16}
                >
                  <Text style={[theme.typography.label, { color: theme.colors.danger }]}>Danger zone</Text>
                  <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted }]}>
                    To request account deletion, send an email to support.
                  </Text>
                  <View style={{ marginTop: 14 }}>
                    <AppButton
                      label="Request account deletion"
                      variant="secondary"
                      onPress={openDeleteMail}
                      icon={<Ionicons name="trash-outline" size={18} color={theme.colors.text} />}
                    />
                  </View>
                </GlassCard>
              </>
            )}

            {activeTab === "notifications" && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={20}>
                <View style={{ alignItems: "center" }}>
                  <Ionicons name="notifications-outline" size={34} color={theme.colors.textMuted} />
                  <Text style={[theme.typography.bodyStrong, { marginTop: 10 }]}>Coming soon</Text>
                  <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]}>
                    Notification preferences will be available here.
                  </Text>
                </View>
              </GlassCard>
            )}

            {activeTab === "preferences" && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={16}>
                <Text style={theme.typography.label}>Preferences</Text>
                <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]}>
                  Default language pair used when creating lessons.
                </Text>
                <View style={{ marginTop: 12, gap: 8 }}>
                  {LANGUAGE_PAIRS.map((pair) => {
                    const active = defaultLanguagePair === pair.code;
                    return (
                      <TouchableOpacity
                        key={pair.code}
                        onPress={() => saveDefaultLanguagePair(pair.code)}
                        activeOpacity={0.85}
                        style={{
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                          paddingHorizontal: 12,
                          paddingVertical: 12,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text style={[theme.typography.caption, { color: active ? theme.colors.primary : theme.colors.text }]}>
                          {pair.fullLabel}
                        </Text>
                        {active ? <Ionicons name="checkmark" size={18} color={theme.colors.primary} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </GlassCard>
            )}

            {activeTab === "plan" && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={16}>
                <Text style={theme.typography.label}>Plan details</Text>

                <View style={{ marginTop: 12, gap: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={theme.typography.caption}>Current plan</Text>
                    <Text style={[theme.typography.caption, { fontWeight: "700" }]}>{planInfo?.plan ?? "Free"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={theme.typography.caption}>Students</Text>
                    <Text style={[theme.typography.caption, { fontWeight: "700" }]}>
                      {studentCount} /{" "}
                      {planInfo?.student_limit === 999
                        ? "Unlimited"
                        : planInfo?.student_limit != null
                        ? String(planInfo.student_limit)
                        : "—"}
                    </Text>
                  </View>
                </View>

                {planInfo?.student_limit != null && planInfo.student_limit !== 999 ? (
                  <View
                    style={{
                      marginTop: 12,
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: theme.colors.surfaceAlt,
                      overflow: "hidden",
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width: `${Math.min(100, (studentCount / Math.max(planInfo.student_limit, 1)) * 100)}%`,
                        backgroundColor: theme.colors.primary,
                      }}
                    />
                  </View>
                ) : null}

                {limitRows.length > 0 ? (
                  <View style={{ marginTop: 14, gap: 8 }}>
                    {limitRows.map((row) => (
                      <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={theme.typography.caption}>{row.label}</Text>
                        <Text style={[theme.typography.caption, { fontWeight: "700" }]}>
                          {row.value === 999 || row.value === -1 ? "Unlimited" : String(row.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={{ marginTop: 16 }}>
                  <AppButton
                    label="View all plans"
                    variant="secondary"
                    onPress={() => navigation.navigate("Subscription")}
                    icon={<Ionicons name="wallet-outline" size={18} color={theme.colors.text} />}
                  />
                </View>
              </GlassCard>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

