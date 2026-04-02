import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";

type RootStackParamList = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Subscription: undefined;
};

type BillingCycle = "monthly" | "yearly";

type Tier = {
  id: string;
  name: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  description: string;
  badge?: string;
  features: {
    students: string | number;
    lessons: string | number;
    tests: string | number;
    presets: string | number;
    teachers: string;
    aiTools: boolean;
    uploadAssistance: boolean;
  };
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: "Get started at no cost",
    features: { students: 5, lessons: 5, tests: 5, presets: 5, teachers: "1", aiTools: false, uploadAssistance: false },
  },
  {
    id: "tutor",
    name: "Tutor",
    monthlyPrice: 14.99,
    yearlyPrice: 144.99,
    description: "Tutors & homeschoolers",
    features: { students: 10, lessons: "Unlimited", tests: "Unlimited", presets: "Unlimited", teachers: "1", aiTools: false, uploadAssistance: false },
  },
  {
    id: "standard",
    name: "Teacher",
    monthlyPrice: 29.99,
    yearlyPrice: 288.99,
    description: "One full class",
    badge: "Recommended",
    features: { students: 30, lessons: "Unlimited", tests: "Unlimited", presets: "Unlimited", teachers: "1", aiTools: true, uploadAssistance: false },
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 49.99,
    yearlyPrice: 479.99,
    description: "Multiple classes",
    features: { students: 60, lessons: "Unlimited", tests: "Unlimited", presets: "Unlimited", teachers: "1", aiTools: true, uploadAssistance: true },
  },
  {
    id: "school",
    name: "School",
    monthlyPrice: null,
    yearlyPrice: null,
    description: "60+ students & teachers",
    features: { students: "Unlimited", lessons: "Unlimited", tests: "Unlimited", presets: "Unlimited", teachers: "Contact us", aiTools: true, uploadAssistance: true },
  },
];

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function SubscriptionScreen() {
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const apiBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [currentTierId, setCurrentTierId] = useState("free");

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingPlan(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mounted || !user) {
          setCurrentTierId("free");
          return;
        }
        const { data: teacher } = await (supabase.from("teachers") as any)
          .select("plan")
          .eq("user_id", user.id)
          .maybeSingle();
        const plan = String(teacher?.plan ?? "free").toLowerCase().trim();
        setCurrentTierId(plan === "teacher" ? "standard" : plan);
      } catch {
        if (mounted) setCurrentTierId("free");
      } finally {
        if (mounted) setLoadingPlan(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const featureRows = useMemo(
    () => [
      { key: "students", label: "Students" },
      { key: "lessons", label: "Lessons" },
      { key: "tests", label: "Tests" },
      { key: "presets", label: "Presets" },
      { key: "teachers", label: "Teachers" },
      { key: "aiTools", label: "AI Images/Lessons/Tests" },
      { key: "uploadAssistance", label: "Upload Assistance" },
    ] as const,
    []
  );

  const priceFor = (tier: Tier) => {
    if (tier.id === "school") return null;
    return cycle === "yearly" ? tier.yearlyPrice : tier.monthlyPrice;
  };

  const handleUpgrade = async (tierId: string) => {
    if (tierId === currentTierId) return;

    if (tierId === "school") {
      const mailto = "mailto:nathan@eluency.com?subject=School%20Plan%20Quote";
      const ok = await Linking.canOpenURL(mailto);
      if (!ok) {
        Alert.alert("Unavailable", "No email app is available on this device.");
        return;
      }
      await Linking.openURL(mailto);
      return;
    }

    setUpgrading(tierId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const base = apiBaseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ tierId, cycle }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string };

      if (!res.ok) {
        const webUrl = `${base}/dashboard/settings/subscription`;
        Alert.alert(
          "Open web checkout",
          data?.error ?? "Could not start checkout in-app. Open web subscription page?",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open",
              onPress: async () => {
                const ok = await Linking.canOpenURL(webUrl);
                if (ok) await Linking.openURL(webUrl);
              },
            },
          ]
        );
        return;
      }

      if (data?.url) {
        const ok = await Linking.canOpenURL(data.url);
        if (!ok) throw new Error("Unable to open checkout URL.");
        await Linking.openURL(data.url);
        return;
      }

      Alert.alert("Done", "Plan update started.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upgrade failed.";
      Alert.alert("Error", msg);
    } finally {
      setUpgrading(null);
    }
  };

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
          <Text style={theme.typography.label}>Billing</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Subscription</Text>
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
        <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={14}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={theme.typography.caption}>Billing cycle</Text>
            <TouchableOpacity
              onPress={() => setCycle((c) => (c === "monthly" ? "yearly" : "monthly"))}
              activeOpacity={0.85}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderRadius: 999,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceAlt,
                padding: 4,
              }}
            >
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: cycle === "monthly" ? theme.colors.primarySoft : "transparent",
                }}
              >
                <Text style={[theme.typography.caption, { color: cycle === "monthly" ? theme.colors.primary : theme.colors.textMuted }]}>
                  Monthly
                </Text>
              </View>
              <View
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: cycle === "yearly" ? theme.colors.primarySoft : "transparent",
                }}
              >
                <Text style={[theme.typography.caption, { color: cycle === "yearly" ? theme.colors.primary : theme.colors.textMuted }]}>
                  Yearly
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted }]}>
            Yearly pricing includes savings vs monthly.
          </Text>
        </GlassCard>

        {loadingPlan ? (
          <GlassCard style={{ borderRadius: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14 }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[theme.typography.body, { marginLeft: 10 }]}>Loading your current plan…</Text>
            </View>
          </GlassCard>
        ) : (
          TIERS.map((tier) => {
            const isCurrent = tier.id === currentTierId;
            const isUpgrading = upgrading === tier.id;
            const price = priceFor(tier);
            return (
              <GlassCard key={tier.id} style={{ borderRadius: 12, marginBottom: 12 }} padding={16}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={theme.typography.bodyStrong}>{tier.name}</Text>
                      {isCurrent ? (
                        <View style={{ backgroundColor: theme.colors.successSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={[theme.typography.caption, { color: theme.colors.success, fontWeight: "700" }]}>Current</Text>
                        </View>
                      ) : tier.badge ? (
                        <View style={{ backgroundColor: theme.colors.primarySoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                          <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: "700" }]}>{tier.badge}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                      {tier.description}
                    </Text>
                  </View>
                  <Text style={[theme.typography.title, { fontSize: 22 }]}>
                    {price == null ? "Custom" : price === 0 ? "Free" : `$${formatMoney(price)}`}
                  </Text>
                </View>

                <View style={{ marginTop: 12, gap: 6 }}>
                  {featureRows.map((row) => {
                    const value = tier.features[row.key];
                    const label =
                      typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
                    return (
                      <View key={`${tier.id}-${row.key}`} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{row.label}</Text>
                        <Text style={[theme.typography.caption, { fontWeight: "700" }]}>{label}</Text>
                      </View>
                    );
                  })}
                </View>

                <View style={{ marginTop: 14 }}>
                  <AppButton
                    label={
                      isCurrent
                        ? "Current plan"
                        : isUpgrading
                        ? "Starting..."
                        : tier.id === "school"
                        ? "Get a quote"
                        : tier.id === "free"
                        ? "Free forever"
                        : "Upgrade"
                    }
                    onPress={() => handleUpgrade(tier.id)}
                    loading={isUpgrading}
                    variant={isCurrent || tier.id === "free" ? "secondary" : "primary"}
                    disabled={isCurrent || tier.id === "free" || isUpgrading}
                  />
                </View>
              </GlassCard>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

