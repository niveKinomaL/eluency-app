import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AppButton from "../components/AppButton";
import AppTextField from "../components/AppTextField";
import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";

type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Dashboard: undefined;
};

type Option = { value: string; label: string };

function guessTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

const PROFESSIONS: Option[] = [
  { value: "teacher", label: "Teacher" },
  { value: "tutor", label: "Tutor" },
  { value: "school", label: "School" },
];

const STUDENT_COUNTS: Option[] = [
  { value: "1-10", label: "1 - 10" },
  { value: "10-29", label: "11 - 29" },
  { value: "30-59", label: "30 - 59" },
  { value: "60+", label: "60+" },
];

const COUNTRY_OPTIONS: Option[] = [
  { value: "BR", label: "Brazil" },
  { value: "CA", label: "Canada" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "PT", label: "Portugal" },
];

const LANGUAGE_OPTIONS: Option[] = [
  { value: "pt-BR", label: "Portuguese" },
  { value: "en-US", label: "English" },
  { value: "es-ES", label: "Spanish" },
  { value: "fr-FR", label: "French" },
];

const REFERRAL_SOURCES: Option[] = [
  { value: "search", label: "Search" },
  { value: "social", label: "Social" },
  { value: "colleague", label: "Friend" },
  { value: "other", label: "Other" },
];

function ChoiceGroup({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = useAppTheme();

  return (
    <View style={{ gap: 10 }}>
      <Text style={theme.typography.label}>{title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => onChange(option.value)}
              activeOpacity={0.9}
              style={{
                minWidth: 100,
                flexGrow: 1,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                paddingHorizontal: 14,
                paddingVertical: 12,
              }}
            >
              <Text
                style={[
                  theme.typography.caption,
                  {
                    color: selected ? theme.colors.primary : theme.colors.textMuted,
                    textAlign: "center",
                    fontWeight: "700",
                  },
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ConsentRow({
  value,
  onValueChange,
  label,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label: string;
}) {
  const theme = useAppTheme();

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor={value ? theme.colors.primary : "#F8FAFC"}
        trackColor={{ false: "#CBD5E1", true: theme.colors.primarySoft }}
      />
      <Text style={[theme.typography.body, { flex: 1 }]}>{label}</Text>
    </View>
  );
}

export default function TrialTeacherRegistrationScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [countryCode, setCountryCode] = useState("CA");
  const [primaryLang, setPrimaryLang] = useState("en-US");
  const [teachingLang, setTeachingLang] = useState("en-US");

  const [profession, setProfession] = useState("teacher");
  const [studentCount, setStudentCount] = useState("1-10");
  const [referralSource, setReferralSource] = useState("");

  const [consentTerms, setConsentTerms] = useState(false);
  const [consentSecurity, setConsentSecurity] = useState(false);
  const [error, setError] = useState("");

  const apiBaseUrl =
    Constants.expoConfig?.extra?.apiBaseUrl || "https://www.eluency.com";

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

  useEffect(() => {
    if (!supabaseUrl || !anonKey) {
      console.warn(
        "[Register] Supabase env vars are missing. Registration will fail until they are configured."
      );
    }
  }, [supabaseUrl, anonKey]);

  const selectedLanguages = useMemo(() => {
    const langs = [primaryLang];
    if (teachingLang !== primaryLang) langs.push(teachingLang);
    return langs;
  }, [primaryLang, teachingLang]);

  const handleRegister = async () => {
    if (loading) return;
    setError("");

    const cleanedEmail = email.trim().toLowerCase();
    const cleanedName = fullName.trim();

    if (!cleanedName) return setError("Please enter your name.");
    if (!cleanedEmail) return setError("Please enter a valid email.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    if (!consentTerms) return setError("You must agree to the Terms and Conditions.");
    if (!consentSecurity) {
      return setError("You must agree to the Privacy & Security Policy.");
    }

    setLoading(true);
    const timezone = guessTimezone();

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: cleanedEmail,
        password,
        options: {
          data: {
            role: "teacher",
            name: cleanedName,
            active: true,
            country_code: countryCode || undefined,
            timezone: timezone || undefined,
            profession,
            student_count: studentCount,
            referral_source: referralSource || undefined,
            teaching_languages: selectedLanguages.map((code, index) => ({
              code,
              isPrimary: index === 0,
            })),
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (supabaseUrl && anonKey) {
        const edgeUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/send-registration-email`;
        fetch(edgeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
          },
          body: JSON.stringify({
            email: cleanedEmail,
            name: cleanedName || undefined,
          }),
        }).catch(() => {});
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        const payload = {
          fullName: cleanedName,
          countryCode: countryCode || null,
          timezone: timezone || null,
          profession,
          studentCount,
          referralSource: referralSource || null,
          teachingLanguages: selectedLanguages.map((code, index) => ({
            code,
            isPrimary: index === 0,
          })),
        };

        const res = await fetch(`${apiBaseUrl}/api/onboarding/teacher/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.detail || body?.error || "Unable to complete profile setup");
        }

        navigation.reset({
          index: 0,
          routes: [{ name: "Dashboard" }],
        });
      } else {
        navigation.navigate("Login");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to create account";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: Math.max(insets.top + 8, 24),
            paddingBottom: 40,
          }}
        >
          <View
            style={{
              position: "absolute",
              top: 0,
              right: -30,
              height: 180,
              width: 180,
              borderRadius: 999,
              backgroundColor: theme.colors.primarySoft,
            }}
            pointerEvents="none"
          />
          <View
            style={{
              position: "absolute",
              bottom: 80,
              left: -40,
              height: 140,
              width: 140,
              borderRadius: 999,
              backgroundColor: theme.colors.violetSoft,
            }}
            pointerEvents="none"
          />

          <View style={{ alignItems: "center", marginBottom: 22 }}>
            <View
              style={{
                borderRadius: 999,
                paddingHorizontal: 14,
                paddingVertical: 8,
                backgroundColor: theme.colors.primarySoft,
              }}
            >
              <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
                Eluency
              </Text>
            </View>
            <Text
              style={[
                theme.typography.display,
                { marginTop: 18, textAlign: "center", fontSize: 30, lineHeight: 36 },
              ]}
            >
              Create account
            </Text>
            <View
              style={{
                marginTop: 8,
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                Already have an account?{" "}
              </Text>
              <TouchableOpacity onPress={() => navigation.navigate("Login")} activeOpacity={0.8}>
                <Text
                  style={[
                    theme.typography.caption,
                    { color: theme.colors.primary, fontWeight: "700" },
                  ]}
                >
                  Login
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <GlassCard>
            <View style={{ gap: 18 }}>
              <AppTextField
                label="Full Name"
                placeholder="Your name"
                value={fullName}
                onChangeText={setFullName}
                icon={<Feather name="user" size={18} color={theme.colors.primary} />}
              />
              <AppTextField
                label="Email"
                placeholder="teacher@school.com"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                icon={<Feather name="mail" size={18} color={theme.colors.primary} />}
              />
              <AppTextField
                label="Password"
                placeholder="Minimum 8 characters"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                icon={<Feather name="lock" size={18} color={theme.colors.primary} />}
              />
              <AppTextField
                label="Confirm Password"
                placeholder="Repeat password"
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
                icon={<Feather name="check-circle" size={18} color={theme.colors.primary} />}
              />

              <ChoiceGroup
                title="Role"
                options={PROFESSIONS}
                value={profession}
                onChange={setProfession}
              />
              <ChoiceGroup
                title="Students"
                options={STUDENT_COUNTS}
                value={studentCount}
                onChange={setStudentCount}
              />
              <ChoiceGroup
                title="Country"
                options={COUNTRY_OPTIONS}
                value={countryCode}
                onChange={setCountryCode}
              />
              <ChoiceGroup
                title="Primary Language"
                options={LANGUAGE_OPTIONS}
                value={primaryLang}
                onChange={setPrimaryLang}
              />
              <ChoiceGroup
                title="Teaching Language"
                options={LANGUAGE_OPTIONS}
                value={teachingLang}
                onChange={setTeachingLang}
              />
              <ChoiceGroup
                title="How did you hear about us?"
                options={REFERRAL_SOURCES}
                value={referralSource}
                onChange={setReferralSource}
              />

              <View
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceAlt,
                  padding: 16,
                  gap: 14,
                }}
              >
                <ConsentRow
                  value={consentTerms}
                  onValueChange={setConsentTerms}
                  label="I agree to the Terms and Conditions."
                />
                <ConsentRow
                  value={consentSecurity}
                  onValueChange={setConsentSecurity}
                  label="I agree to the Privacy & Security Policy."
                />
              </View>

              {error ? (
                <View
                  style={{
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: theme.colors.danger,
                    backgroundColor: theme.colors.dangerSoft,
                    padding: 14,
                  }}
                >
                  <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
                    {error}
                  </Text>
                </View>
              ) : null}

              <AppButton
                label="Create Account"
                onPress={handleRegister}
                loading={loading}
                icon={
                  <MaterialCommunityIcons
                    name="account-plus-outline"
                    size={18}
                    color={theme.colors.primaryText}
                  />
                }
              />
            </View>
          </GlassCard>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

