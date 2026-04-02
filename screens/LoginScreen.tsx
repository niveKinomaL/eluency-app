import { ReactNode, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SvgUri } from "react-native-svg";
import AppButton from "../components/AppButton";
import { clearStoredStudentSessionId, setStoredStudentSessionId } from "../lib/studentSession";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";

type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Dashboard: { sessionId?: string } | undefined;
  StudyGame: { sessionId: string };
};

type LoginView = "student" | "teacher";

type VerifyAccessCodeResponse = {
  error?: string;
  session?: {
    id?: string;
  };
};

const apiBaseUrl =
  Constants.expoConfig?.extra?.apiBaseUrl || "https://www.eluency.com";

const LOGO_URI = "https://www.eluency.com/Logo.svg";

function mapTeacherError(message?: string): string {
  if (!message) return "Unable to sign in. Please try again.";
  if (message.toLowerCase().includes("invalid login")) {
    return "Email or password is incorrect.";
  }
  return message;
}

function LoginField({
  label,
  icon,
  error,
  helperText,
  ...props
}: {
  label: string;
  icon?: ReactNode;
  error?: string;
  helperText?: string;
} & React.ComponentProps<typeof TextInput>) {
  const theme = useAppTheme();

  return (
    <View style={{ gap: 8 }}>
      <Text style={theme.typography.label}>{label}</Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: error ? theme.colors.danger : theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        {icon ? <View pointerEvents="none">{icon}</View> : null}

        <TextInput
          placeholderTextColor={theme.colors.textSoft}
          style={{
            flex: 1,
            minHeight: 20,
            color: theme.colors.text,
            fontSize: 16,
            paddingVertical: 0,
          }}
          autoCorrect={false}
          underlineColorAndroid="transparent"
          {...props}
        />
      </View>

      {error ? (
        <Text style={[theme.typography.caption, { color: theme.colors.danger }]}>
          {error}
        </Text>
      ) : helperText ? (
        <Text style={theme.typography.caption}>{helperText}</Text>
      ) : null}
    </View>
  );
}

function RoleSwitch({
  value,
  onChange,
}: {
  value: LoginView;
  onChange: (value: LoginView) => void;
}) {
  const theme = useAppTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: 20,
        backgroundColor: theme.colors.surfaceAlt,
        padding: 4,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      {[
        { key: "teacher" as const, label: "Teacher" },
        { key: "student" as const, label: "Student" },
      ].map((item) => {
        const selected = item.key === value;

        return (
          <TouchableOpacity
            key={item.key}
            onPress={() => onChange(item.key)}
            activeOpacity={0.92}
            style={{
              flex: 1,
              borderRadius: 16,
              paddingVertical: 12,
              backgroundColor: selected ? theme.colors.primary : "transparent",
            }}
          >
            <Text
              style={[
                theme.typography.caption,
                {
                  textAlign: "center",
                  color: selected ? theme.colors.primaryText : theme.colors.textMuted,
                  fontWeight: "700",
                },
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function LoginScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<LoginView>("teacher");

  const [gameCode, setGameCode] = useState("");
  const [studentError, setStudentError] = useState("");
  const [studentLoading, setStudentLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teacherError, setTeacherError] = useState("");
  const [teacherLoading, setTeacherLoading] = useState(false);

  const isCodeComplete = useMemo(() => gameCode.trim().length === 6, [gameCode]);

  const switchView = (nextView: LoginView) => {
    setView(nextView);

    if (nextView === "teacher") {
      setStudentError("");
    } else {
      setTeacherError("");
    }
  };

  const handleStudentSubmit = async () => {
    const code = gameCode.trim().toUpperCase();
    if (!code) return;

    setStudentError("");
    setStudentLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/students/verify-access-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code }),
      });

      let result: VerifyAccessCodeResponse | null = null;
      try {
        result = (await response.json()) as VerifyAccessCodeResponse;
      } catch {
        result = null;
      }

      if (!response.ok || result?.error) {
        setStudentError(result?.error || "Unable to verify code. Please try again.");
        return;
      }

      const sessionId = result?.session?.id;
      if (!sessionId) {
        setStudentError("Invalid response from server.");
        return;
      }

      await setStoredStudentSessionId(sessionId);

      navigation.reset({
        index: 0,
        routes: [{ name: "StudyGame", params: { sessionId } }],
      });
    } catch {
      setStudentError("Network error. Check your connection and try again.");
    } finally {
      setStudentLoading(false);
    }
  };

  const handleTeacherLogin = async () => {
    const cleanedEmail = email.trim().toLowerCase();

    if (!cleanedEmail || !password) {
      setTeacherError("Please enter your email and password.");
      return;
    }

    setTeacherError("");
    setTeacherLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanedEmail,
        password,
      });

      if (error) {
        setTeacherError(mapTeacherError(error.message));
        return;
      }

      await clearStoredStudentSessionId();

      navigation.reset({
        index: 0,
        routes: [{ name: "Dashboard" }],
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again.";
      setTeacherError(message);
    } finally {
      setTeacherLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: Math.max(insets.top + 8, 24),
          paddingBottom: 40,
        }}
      >
        <View style={{ flex: 1 }}>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 10,
              right: -30,
              height: 180,
              width: 180,
              borderRadius: 999,
              backgroundColor: theme.colors.primarySoft,
            }}
          />

          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: 80,
              left: -40,
              height: 140,
              width: 140,
              borderRadius: 999,
              backgroundColor: theme.colors.violetSoft,
            }}
          />

          <View
            style={{ alignItems: "center", marginBottom: 22 }}
            pointerEvents="box-none"
          >
            <View style={{ transform: [{ translateX: -20 }] }} pointerEvents="none">
              <SvgUri uri={LOGO_URI} width={300} height={169} />
            </View>

            <Text
              style={[
                theme.typography.display,
                { marginTop: 6, textAlign: "center", fontSize: 30, lineHeight: 36 },
              ]}
            >
              {view === "teacher" ? "Login" : "Enter Code"}
            </Text>

            <Text
              style={[
                theme.typography.caption,
                { marginTop: 8, textAlign: "center", color: theme.colors.textMuted },
              ]}
            >
              {view === "teacher"
                ? "Sign in to your account"
                : "Use the code sent by your teacher"}
            </Text>
          </View>

          <View
            style={{
              alignSelf: "stretch",
              borderRadius: 24,
              padding: 20,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View style={{ gap: 20 }}>
              <RoleSwitch value={view} onChange={switchView} />

              <View
                style={{
                  display: view === "teacher" ? "flex" : "none",
                  gap: 16,
                }}
              >
                <LoginField
                  label="Email"
                  placeholder="teacher@school.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  value={email}
                  onChangeText={setEmail}
                  icon={<Feather name="mail" size={18} color={theme.colors.primary} />}
                />

                <LoginField
                  label="Password"
                  placeholder="••••••••"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  value={password}
                  onChangeText={setPassword}
                  error={teacherError || undefined}
                  icon={<Feather name="lock" size={18} color={theme.colors.primary} />}
                />

                <AppButton
                  label="Login"
                  onPress={handleTeacherLogin}
                  loading={teacherLoading}
                />
              </View>

              <View
                style={{
                  display: view === "student" ? "flex" : "none",
                  gap: 16,
                }}
              >
                <LoginField
                  label="Access Code"
                  value={gameCode}
                  onChangeText={(value) =>
                    setGameCode(value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
                  }
                  placeholder="ABC123"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  textContentType="none"
                  maxLength={6}
                  error={studentError || undefined}
                  icon={
                    <MaterialCommunityIcons
                      name="controller-classic-outline"
                      size={18}
                      color={theme.colors.primary}
                    />
                  }
                />

                <AppButton
                  label="Continue"
                  onPress={handleStudentSubmit}
                  loading={studentLoading}
                  disabled={!isCodeComplete}
                />
              </View>

              <TouchableOpacity
                onPress={() => navigation.navigate("Register")}
                activeOpacity={0.8}
                style={{ alignSelf: "center", paddingTop: 2 }}
              >
                <Text
                  style={[
                    theme.typography.caption,
                    {
                      color: theme.colors.textSoft,
                      fontSize: 12,
                      lineHeight: 16,
                    },
                  ]}
                >
                  Need an account?{" "}
                  <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>
                    Create account
                  </Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ alignItems: "center", marginTop: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="ellipse" size={6} color={theme.colors.primary} />
              <Text style={[theme.typography.caption, { color: theme.colors.textSoft }]}>
                {view === "teacher" ? "Teacher access" : "Student access"}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}