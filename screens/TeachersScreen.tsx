import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassCard from "../components/GlassCard";
import AppButton from "../components/AppButton";
import { useAppTheme } from "../lib/theme";
import { supabase } from "../lib/supabase";
import {
  coercePlanForRole,
  getDefaultPlanForRole,
  getStudentLimitForPlan,
  getValidPlansForRole,
  normalizePlanUi,
} from "../lib/teacherRolePlanRules";

type RootStackParamList = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Teachers: undefined;
  Chats: undefined;
  SendNotifications: undefined;
  Login: undefined;
  Register: undefined;
};

type TeacherRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  plan: string | null;
  created_at: string;
  student_limit?: number | null;
  org_id?: string | null;
  active?: boolean | null;
};

const apiBaseUrl =
  Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

const PLAN_TYPES = [
  { id: "free" as const, label: "Free", icon: "person-outline" as const },
  { id: "tutor" as const, label: "Tutor", icon: "flame-outline" as const },
  { id: "standard" as const, label: "Teacher", icon: "star-outline" as const },
  { id: "pro" as const, label: "Pro", icon: "flash-outline" as const },
  { id: "school" as const, label: "School", icon: "school-outline" as const },
  { id: "internal" as const, label: "Internal", icon: "settings-outline" as const },
];

const PLAN_TO_LIMIT: Record<string, number> = {
  free: 5,
  tutor: 10,
  standard: 30,
  pro: 60,
  school: 999,
  internal: 999,
};

/** PLAN_TYPES `id` -> DB plan string (same as Eluency web / RLS checks). */
function planUiIdToDbPlan(uiId: string): string {
  const id = (uiId ?? "free").toLowerCase().trim();
  const map: Record<string, string> = {
    free: "Free",
    tutor: "Tutor",
    standard: "Standard",
    pro: "Pro",
    school: "School",
    internal: "Internal",
  };
  return map[id] ?? "Free";
}

const ROLE_OPTIONS = [
  { id: "teacher", label: "Teacher", icon: "school-outline" as const },
  { id: "principal", label: "Principal", icon: "shield-outline" as const },
  { id: "admin", label: "Admin", icon: "sparkles-outline" as const },
];

/** New account (web /dashboard/teachers/new): only teacher or principal — not admin. */
const NEW_ACCOUNT_ROLE_OPTIONS = ROLE_OPTIONS.filter((o) => o.id === "teacher" || o.id === "principal");

function formatJoined(dateIso: string) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TeachersScreen() {
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentTeacher, setCurrentTeacher] = useState<TeacherRow | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingTeacher, setEditingTeacher] = useState<TeacherRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("teacher");
  const [editPlan, setEditPlan] = useState("free");
  const [editStudentLimit, setEditStudentLimit] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addAccountRole, setAddAccountRole] = useState<"teacher" | "principal">("teacher");
  const [addPlanUi, setAddPlanUi] = useState("free");
  const [addPrincipalUserId, setAddPrincipalUserId] = useState("");
  const [addPrincipals, setAddPrincipals] = useState<
    { user_id: string; name: string | null; email: string | null; org_id: string | null }[]
  >([]);
  const [addPrincipalsLoading, setAddPrincipalsLoading] = useState(false);

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);

      if (!user) {
        setTeachers([]);
        setCurrentTeacher(null);
        return;
      }

      const { data: me, error: meError } = await (supabase.from("teachers") as any)
        .select("user_id, name, role, plan, student_limit, org_id")
        .eq("user_id", user.id)
        .single();

      if (meError) {
        console.warn("Teachers: current teacher", meError);
      }

      const meRow = me
        ? { ...(me as object), id: (me as { user_id: string }).user_id }
        : null;
      setCurrentTeacher(meRow as TeacherRow | null);

      const { data: teacherData, error: teachersError } = await (supabase.from("teachers") as any)
        .select("user_id, name, email, role, plan, created_at, student_limit, org_id, active")
        .order("created_at", { ascending: false });

      if (teachersError) {
        console.warn("Teachers: list", teachersError);
        throw teachersError;
      }

      const rows: TeacherRow[] = (teacherData || []).map(
        (t: {
          user_id: string;
          name: string | null;
          email?: string | null;
          role: string | null;
          plan: string | null;
          created_at: string;
          student_limit?: number | null;
          org_id?: string | null;
          active?: boolean | null;
        }) => ({
          id: t.user_id,
          name: t.name,
          email: t.email ?? null,
          role: t.role,
          plan: t.plan,
          created_at: t.created_at,
          student_limit: t.student_limit,
          org_id: t.org_id,
          active: t.active,
        })
      );
      setTeachers(rows);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load teachers.";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  const role = useMemo(() => (currentTeacher?.role ?? "teacher").toLowerCase(), [currentTeacher?.role]);
  const isAdmin = role === "admin";
  const isPrincipal = role === "principal";

  // When admin changes role, snap plan chip to a valid option for that role (matches web behavior).
  useEffect(() => {
    if (!editingTeacher || !isAdmin) return;
    const validPlans = getValidPlansForRole(editRole);
    const selectedDb = planUiIdToDbPlan(editPlan);
    if (!validPlans.includes(selectedDb)) {
      setEditPlan(validPlans[0].toLowerCase());
    }
  }, [editRole, editPlan, editingTeacher?.id, isAdmin]);

  // Keep student limit in sync with coerced plan (same as Eluency web edit page).
  useEffect(() => {
    if (!editingTeacher || !isAdmin) return;
    const plan = coercePlanForRole(editRole, planUiIdToDbPlan(editPlan));
    setEditStudentLimit(String(getStudentLimitForPlan(plan)));
  }, [editRole, editPlan, editingTeacher?.id, isAdmin]);

  useEffect(() => {
    if (!addModalVisible || !isAdmin) return;
    setAddPlanUi(getDefaultPlanForRole(addAccountRole).toLowerCase());
    if (addAccountRole === "principal") setAddPrincipalUserId("");
  }, [addAccountRole, addModalVisible, isAdmin]);

  useEffect(() => {
    if (!addModalVisible || !isAdmin) return;
    let cancelled = false;
    (async () => {
      setAddPrincipalsLoading(true);
      const { data, error } = await (supabase.from("teachers") as any)
        .select("user_id, name, email, org_id, created_at")
        .eq("role", "principal")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) console.warn("Add teacher: principals list", error);
      const rows = ((data ?? []) as any[])
        .map((r) => ({
          user_id: r.user_id as string,
          name: (r.name ?? null) as string | null,
          email: (r.email ?? null) as string | null,
          org_id: (r.org_id ?? null) as string | null,
        }))
        .sort((a, b) => Number(Boolean(b.org_id)) - Number(Boolean(a.org_id)));
      setAddPrincipals(rows);
      setAddPrincipalsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [addModalVisible, isAdmin]);

  const adminTeachersOnly = useMemo(
    () => teachers.filter((t) => (t.role ?? "").toLowerCase() === "teacher"),
    [teachers]
  );

  const getPlanCount = useCallback(
    (plan: string) => {
      const p = plan.toLowerCase();
      return adminTeachersOnly.filter((t) => (t.plan?.toLowerCase() || "free") === p).length;
    },
    [adminTeachersOnly]
  );

  const stats = useMemo(
    () => ({
      school: getPlanCount("school"),
      pro: getPlanCount("pro"),
      standard: getPlanCount("standard"),
      tutor: getPlanCount("tutor"),
      free: getPlanCount("free"),
      internal: getPlanCount("internal"),
    }),
    [getPlanCount]
  );

  const adminVisibleTeachers = useMemo(() => teachers, [teachers]);

  const filteredTeachers = useMemo(() => {
    if (!isAdmin) return teachers;
    if (!filter) return adminVisibleTeachers;
    return adminVisibleTeachers.filter((t) => (t.plan?.toLowerCase() || "free") === filter.toLowerCase());
  }, [adminVisibleTeachers, filter, isAdmin, teachers]);

  const principalTeacherLimit = useMemo(() => {
    if (!isPrincipal) return null;
    const plan = (currentTeacher?.plan ?? "").toLowerCase().trim();
    if (plan && PLAN_TO_LIMIT[plan] != null) return PLAN_TO_LIMIT[plan];
    return 3;
  }, [currentTeacher?.plan, isPrincipal]);

  const principalTeacherCount = useMemo(() => {
    if (!isPrincipal) return 0;
    return teachers.filter((t) => (t.role ?? "").toLowerCase() === "teacher").length;
  }, [isPrincipal, teachers]);

  const principalLimit = principalTeacherLimit ?? 3;
  const principalRemaining = Math.max(principalLimit - principalTeacherCount, 0);
  const principalPct = principalLimit > 0 ? Math.min((principalTeacherCount / principalLimit) * 100, 100) : 0;

  const progressColor =
    principalPct >= 90 ? theme.colors.danger : principalPct >= 70 ? theme.colors.primary : theme.colors.success;

  const searchedTeachers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return filteredTeachers;
    return filteredTeachers.filter(
      (t) =>
        (t.name ?? "").toLowerCase().includes(q) ||
        (t.email ?? "").toLowerCase().includes(q)
    );
  }, [filteredTeachers, searchTerm]);

  const planTotal =
    stats.free + stats.tutor + stats.standard + stats.pro + stats.school + stats.internal;

  const openAddTeacher = () => {
    setAddName("");
    setAddEmail("");
    setAddPassword("");
    setAddAccountRole("teacher");
    setAddPlanUi("free");
    setAddPrincipalUserId("");
    setAddModalVisible(true);
  };

  const closeAddModal = () => {
    if (savingAdd) return;
    setAddModalVisible(false);
  };

  const submitCreateTeacher = async () => {
    if (!addModalVisible || savingAdd) return;
    const name = addName.trim();
    const email = addEmail.trim();
    if (!name) {
      Alert.alert("Missing name", "Please enter a full name.");
      return;
    }
    if (!email) {
      Alert.alert("Missing email", "Please enter an email address.");
      return;
    }
    if (addPassword.length < 6) {
      Alert.alert("Password", "Use at least 6 characters (same as web).");
      return;
    }

    setSavingAdd(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const base = apiBaseUrl.replace(/\/$/, "");
      const body: Record<string, unknown> = {
        name,
        email,
        password: addPassword,
      };
      if (isAdmin) {
        body.role = addAccountRole;
        body.plan = coercePlanForRole(addAccountRole, planUiIdToDbPlan(addPlanUi));
        if (addAccountRole === "teacher" && addPrincipalUserId.trim() !== "") {
          body.principal_user_id = addPrincipalUserId.trim();
        }
      }

      const res = await fetch(`${base}/api/admin/teachers/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data?.error ?? `Failed to create (${res.status})`);

      await fetchTeachers();
      setAddModalVisible(false);
      Alert.alert("Done", isAdmin ? "Account created and confirmed." : "Teacher created and confirmed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create account.";
      Alert.alert("Error", msg);
    } finally {
      setSavingAdd(false);
    }
  };

  const openEditTeacher = (teacher: TeacherRow) => {
    setEditingTeacher(teacher);
    setEditName(teacher.name ?? "");
    const r = (teacher.role ?? "teacher").toLowerCase();
    const coerced = coercePlanForRole(r, normalizePlanUi(teacher.plan));
    setEditRole(r);
    setEditPlan(coerced.toLowerCase());
    setEditStudentLimit(String(getStudentLimitForPlan(coerced)));
    setEditActive(teacher.active !== false);
  };

  const closeEditModal = () => {
    if (savingEdit) return;
    setEditingTeacher(null);
  };

  const saveTeacherEdit = async () => {
    if (!editingTeacher || savingEdit) return;

    const trimmedName = editName.trim();
    if (!trimmedName) {
      Alert.alert("Missing name", "Please enter a teacher name.");
      return;
    }

    setSavingEdit(true);
    try {
      if (isAdmin) {
        // Same flow as Eluency web: PATCH /api/admin/teachers/:id (service role; correct plan + limits).
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) {
          throw new Error("Not authenticated.");
        }

        const plan = coercePlanForRole(editRole, planUiIdToDbPlan(editPlan));
        const student_limit = getStudentLimitForPlan(plan);

        const updatePayload = {
          name: trimmedName,
          role: editRole,
          plan,
          active: editActive,
          student_limit,
        };

        const base = apiBaseUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/api/admin/teachers/${editingTeacher.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(updatePayload),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data?.error ?? `Failed to update (${res.status})`);
        }
      } else {
        // Principal / others: same payload shape as web non-admin (name + student_limit from coerced plan).
        const targetRole = (editingTeacher.role ?? "teacher").toLowerCase();
        const plan = coercePlanForRole(targetRole, normalizePlanUi(editingTeacher.plan));
        const updatePayload: Record<string, unknown> = {
          name: trimmedName,
          student_limit: getStudentLimitForPlan(plan),
        };

        const { error } = await (supabase.from("teachers") as any)
          .update(updatePayload)
          .eq("user_id", editingTeacher.id);

        if (error) throw error;
      }

      await fetchTeachers();
      setEditingTeacher(null);
      Alert.alert("Saved", "Teacher information updated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update teacher.";
      Alert.alert("Error", msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = (teacher: TeacherRow) => {
    if (teacher.id === currentUserId) {
      Alert.alert("Not allowed", "You cannot delete your own account.");
      return;
    }
    if (!isAdmin) {
      Alert.alert("Not allowed", "Only admins can delete accounts from this list.");
      return;
    }

    Alert.alert(
      "Delete account",
      `Permanently remove ${teacher.name ?? "this teacher"}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(teacher.id);
            try {
              const {
                data: { session },
              } = await supabase.auth.getSession();
              const accessToken = session?.access_token;
              if (!accessToken) throw new Error("Not authenticated.");

              const base = apiBaseUrl.replace(/\/$/, "");
              const res = await fetch(`${base}/api/admin/teachers/${teacher.id}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              });
              const data = (await res.json().catch(() => ({}))) as { error?: string };
              if (!res.ok) throw new Error(data?.error ?? `Failed to delete (${res.status})`);

              await fetchTeachers();
              Alert.alert("Done", "Teacher account and login removed.");
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Delete failed.";
              Alert.alert("Error", msg);
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const subtitle = isAdmin
    ? filter
      ? `Showing ${PLAN_TYPES.find((p) => p.id === filter)?.label ?? filter} plans`
      : "Platform distribution & directory"
    : isPrincipal
    ? "Manage your teachers and capacity"
    : "Teacher directory";

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
          <Text style={theme.typography.label}>{isAdmin ? "Admin" : isPrincipal ? "Principal" : "Workspace"}</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Teachers</Text>
        </View>
        {(isAdmin || isPrincipal) && (
          <TouchableOpacity
            onPress={openAddTeacher}
            activeOpacity={0.85}
            style={{
              height: 44,
              width: 44,
              borderRadius: 12,
              backgroundColor: theme.colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="add" size={26} color={theme.colors.primaryText} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 8) + 62,
          paddingHorizontal: 20,
          paddingBottom: 36,
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <GlassCard style={{ borderRadius: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 16 }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[theme.typography.body, { marginLeft: 12 }]}>Loading directory…</Text>
            </View>
          </GlassCard>
        ) : (
          <>
            <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={0}>
              <View style={{ padding: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
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
                    <Ionicons name="people-outline" size={24} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.label, { color: theme.colors.primary }]}>Directory</Text>
                    <Text style={[theme.typography.title, { marginTop: 2, fontSize: 20, lineHeight: 26 }]}>
                      Team & plans
                    </Text>
                  </View>
                </View>
                <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.textMuted, lineHeight: 18 }]}>
                  {subtitle}
                </Text>
              </View>
            </GlassCard>

            {isAdmin && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={0}>
                <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Text style={[theme.typography.label, { letterSpacing: 1, color: theme.colors.primary }]}>Plan filters</Text>
                    <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                      Tap a plan to narrow the directory.
                    </Text>
                  </View>
                  {filter ? (
                    <TouchableOpacity onPress={() => setFilter(null)} activeOpacity={0.7}>
                      <Text style={{ color: theme.colors.danger, fontWeight: "700", fontSize: 12 }}>Clear</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    paddingHorizontal: 16,
                    paddingBottom: 14,
                  }}
                >
                  {PLAN_TYPES.map((plan) => {
                    const count =
                      plan.id === "free"
                        ? stats.free
                        : plan.id === "tutor"
                        ? stats.tutor
                        : plan.id === "standard"
                        ? stats.standard
                        : plan.id === "pro"
                        ? stats.pro
                        : plan.id === "school"
                        ? stats.school
                        : stats.internal;
                    const active = filter === plan.id;
                    return (
                      <TouchableOpacity
                        key={plan.id}
                        onPress={() => setFilter(active ? null : plan.id)}
                        activeOpacity={0.85}
                        style={{
                          width: "48.5%",
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: active ? theme.colors.primary : theme.colors.border,
                          backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                          padding: 14,
                          marginBottom: 10,
                          overflow: "hidden",
                        }}
                      >
                        <View
                          style={{
                            position: "absolute",
                            top: -20,
                            right: -20,
                            width: 70,
                            height: 70,
                            borderRadius: 35,
                            backgroundColor: active ? "rgba(212,89,23,0.14)" : "rgba(37,42,46,0.05)",
                          }}
                        />
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <View
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 10,
                              backgroundColor: active ? theme.colors.primary : theme.colors.surfaceGlass,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Ionicons
                              name={plan.icon}
                              size={20}
                              color={active ? theme.colors.primaryText : theme.colors.primary}
                            />
                          </View>
                          {active ? (
                            <View
                              style={{
                                height: 24,
                                width: 24,
                                borderRadius: 8,
                                backgroundColor: theme.colors.primary,
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Ionicons name="checkmark" size={14} color={theme.colors.primaryText} />
                            </View>
                          ) : null}
                        </View>
                        <Text style={[theme.typography.caption, { marginTop: 14, color: theme.colors.textMuted, fontWeight: "700" }]}>
                          {plan.label}
                        </Text>
                        <Text style={[theme.typography.title, { marginTop: 2, fontSize: 28, lineHeight: 32 }]}>
                          {count}
                        </Text>
                        <View
                          style={{
                            marginTop: 12,
                            height: 6,
                            borderRadius: 999,
                            backgroundColor: theme.colors.background,
                            overflow: "hidden",
                          }}
                        >
                          <View
                            style={{
                              height: "100%",
                              width: `${planTotal > 0 ? Math.max((count / planTotal) * 100, count > 0 ? 8 : 0) : 0}%`,
                              backgroundColor: active ? theme.colors.primary : theme.colors.borderStrong,
                            }}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                  <View
                    style={{
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: theme.colors.surfaceAlt,
                      overflow: "hidden",
                      flexDirection: "row",
                    }}
                  >
                    {planTotal > 0 ? (
                      <>
                        <View style={{ height: "100%", width: `${(stats.free / planTotal) * 100}%`, backgroundColor: "#94a3b8" }} />
                        <View style={{ height: "100%", width: `${(stats.tutor / planTotal) * 100}%`, backgroundColor: "#f97316" }} />
                        <View style={{ height: "100%", width: `${(stats.standard / planTotal) * 100}%`, backgroundColor: theme.colors.primary }} />
                        <View style={{ height: "100%", width: `${(stats.pro / planTotal) * 100}%`, backgroundColor: "#06b6d4" }} />
                        <View style={{ height: "100%", width: `${(stats.school / planTotal) * 100}%`, backgroundColor: "#6366f1" }} />
                        <View style={{ height: "100%", width: `${(stats.internal / planTotal) * 100}%`, backgroundColor: "#475569" }} />
                      </>
                    ) : (
                      <View style={{ flex: 1, backgroundColor: theme.colors.border }} />
                    )}
                  </View>
                </View>
              </GlassCard>
            )}

            {isPrincipal && !isAdmin && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={18}>
                <Text style={[theme.typography.label, { marginBottom: 12 }]}>Teacher capacity</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      padding: 14,
                      backgroundColor: theme.colors.surfaceAlt,
                    }}
                  >
                    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Total teachers</Text>
                    <Text style={[theme.typography.title, { marginTop: 6, fontSize: 24 }]}>
                      {principalTeacherCount} / {principalLimit}
                    </Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      padding: 14,
                      backgroundColor: theme.colors.surfaceAlt,
                    }}
                  >
                    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Slots left</Text>
                    <Text style={[theme.typography.title, { marginTop: 6, fontSize: 24 }]}>{principalRemaining}</Text>
                  </View>
                </View>
                <View
                  style={{
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: theme.colors.surfaceAlt,
                    overflow: "hidden",
                    marginTop: 14,
                  }}
                >
                  <View style={{ height: "100%", width: `${principalPct}%`, backgroundColor: progressColor }} />
                </View>
              </GlassCard>
            )}

            <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={14}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="search-outline" size={20} color={theme.colors.textMuted} style={{ marginRight: 10 }} />
                <TextInput
                  value={searchTerm}
                  onChangeText={setSearchTerm}
                  placeholder="Search by name or email…"
                  placeholderTextColor={theme.colors.textMuted}
                  style={{
                    flex: 1,
                    fontSize: 16,
                    color: theme.colors.text,
                    paddingVertical: 10,
                  }}
                />
              </View>
            </GlassCard>

            {isPrincipal && !isAdmin && principalTeacherCount === 0 && (
              <GlassCard style={{ borderRadius: 12, marginBottom: 12 }} padding={18}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: theme.colors.primary,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="add" size={24} color={theme.colors.primaryText} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[theme.typography.bodyStrong, { fontSize: 15 }]}>Add your first teacher</Text>
                    <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted, lineHeight: 18 }]}>
                      Create accounts so your team can build lessons and assign work.
                    </Text>
                    <View style={{ marginTop: 12 }}>
                      <AppButton
                        label="Add teacher"
                        onPress={openAddTeacher}
                        icon={<Ionicons name="person-add-outline" size={18} color={theme.colors.primaryText} />}
                      />
                    </View>
                  </View>
                </View>
              </GlassCard>
            )}

            <Text style={[theme.typography.caption, { marginBottom: 10, marginLeft: 4, color: theme.colors.textMuted }]}>
              {searchedTeachers.length} shown
            </Text>

            {searchedTeachers.length === 0 ? (
              <GlassCard style={{ borderRadius: 12 }} padding={24}>
                <Text style={[theme.typography.body, { color: theme.colors.textMuted, textAlign: "center" }]}>
                  No teachers match your search or filters.
                </Text>
              </GlassCard>
            ) : (
              searchedTeachers.map((t) => {
                const isSelf = t.id === currentUserId;
                const isActive = t.active !== false;
                const roleLower = (t.role ?? "").toLowerCase();
                return (
                  <GlassCard key={t.id} style={{ borderRadius: 12, marginBottom: 10 }} padding={16}>
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 12,
                          backgroundColor: theme.colors.primary,
                          alignItems: "center",
                          justifyContent: "center",
                          marginRight: 12,
                        }}
                      >
                        <Text style={{ color: theme.colors.primaryText, fontSize: 18, fontWeight: "800" }}>
                          {(t.name ?? "T").charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                          <Text style={[theme.typography.bodyStrong, { fontSize: 17 }]} numberOfLines={1}>
                            {t.name ?? "—"}
                          </Text>
                          {isSelf ? (
                            <View
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: 6,
                                backgroundColor: theme.colors.primarySoft,
                              }}
                            >
                              <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.primary }}>YOU</Text>
                            </View>
                          ) : null}
                        </View>
                        {t.email ? (
                          <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]} numberOfLines={1}>
                            {t.email}
                          </Text>
                        ) : null}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                          <View
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: 8,
                              backgroundColor: roleLower === "admin" ? "rgba(245,158,11,0.15)" : "rgba(59,130,246,0.12)",
                              borderWidth: 1,
                              borderColor: roleLower === "admin" ? "rgba(245,158,11,0.35)" : "rgba(59,130,246,0.25)",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: "800",
                                color: roleLower === "admin" ? "#d97706" : "#2563eb",
                                textTransform: "capitalize",
                              }}
                            >
                              {t.role ?? "teacher"}
                            </Text>
                          </View>
                          <View
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: 8,
                              backgroundColor: theme.colors.primarySoft,
                              borderWidth: 1,
                              borderColor: theme.colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>
                              {(t.plan ?? "Free").toString()}
                            </Text>
                          </View>
                          <View
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 4,
                              borderRadius: 8,
                              backgroundColor: isActive ? theme.colors.successSoft : theme.colors.dangerSoft,
                              borderWidth: 1,
                              borderColor: isActive ? theme.colors.success : theme.colors.danger,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: "800",
                                color: isActive ? theme.colors.success : theme.colors.danger,
                              }}
                            >
                              {isActive ? "Active" : "Inactive"}
                            </Text>
                          </View>
                        </View>
                        <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.textMuted }]}>
                          Joined {formatJoined(t.created_at)}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                      <TouchableOpacity
                        onPress={() => openEditTeacher(t)}
                        activeOpacity={0.85}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surfaceAlt,
                        }}
                      >
                        <Ionicons name="create-outline" size={18} color={theme.colors.text} />
                        <Text style={[theme.typography.caption, { fontWeight: "700", color: theme.colors.text }]}>Edit</Text>
                      </TouchableOpacity>
                      {isAdmin && !isSelf ? (
                        <TouchableOpacity
                          onPress={() => handleDelete(t)}
                          disabled={deletingId === t.id}
                          activeOpacity={0.85}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: theme.colors.dangerSoft,
                            backgroundColor: theme.colors.dangerSoft,
                          }}
                        >
                          {deletingId === t.id ? (
                            <ActivityIndicator size="small" color={theme.colors.danger} />
                          ) : (
                            <>
                              <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                              <Text style={[theme.typography.caption, { fontWeight: "700", color: theme.colors.danger }]}>
                                Delete
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </GlassCard>
                );
              })
            )}

          </>
        )}
      </ScrollView>

      <Modal transparent visible={!!editingTeacher} animationType="fade" onRequestClose={closeEditModal}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            paddingHorizontal: 20,
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={closeEditModal}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <GlassCard style={{ borderRadius: 12, maxHeight: "82%" }} padding={0}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ padding: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[theme.typography.label, { color: theme.colors.primary }]}>Edit teacher</Text>
                    <Text style={[theme.typography.title, { marginTop: 4 }]}>
                      {editingTeacher?.name ?? "Teacher"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeEditModal}
                    activeOpacity={0.85}
                    style={{
                      height: 40,
                      width: 40,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surfaceAlt,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted }]}>
                  Update the main account details directly in the app.
                </Text>

                <View style={{ marginTop: 18 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Name</Text>
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Teacher name"
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

                {isAdmin ? (
                  <>
                    <View style={{ marginTop: 16 }}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Role</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                        {ROLE_OPTIONS.map((option) => {
                          const active = editRole === option.id;
                          return (
                            <TouchableOpacity
                              key={option.id}
                              onPress={() => setEditRole(option.id)}
                              activeOpacity={0.85}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: active ? theme.colors.primary : theme.colors.border,
                                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                              }}
                            >
                              <Ionicons
                                name={option.icon}
                                size={16}
                                color={active ? theme.colors.primary : theme.colors.textMuted}
                              />
                              <Text
                                style={[
                                  theme.typography.caption,
                                  { marginLeft: 8, color: active ? theme.colors.primary : theme.colors.text },
                                ]}
                              >
                                {option.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <View style={{ marginTop: 16 }}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Plan</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 }}>
                        {PLAN_TYPES.filter((p) =>
                          getValidPlansForRole(editRole).includes(planUiIdToDbPlan(p.id))
                        ).map((plan) => {
                          const active = editPlan === plan.id;
                          return (
                            <TouchableOpacity
                              key={plan.id}
                              onPress={() => setEditPlan(plan.id)}
                              activeOpacity={0.85}
                              style={{
                                width: "48.5%",
                                marginBottom: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: active ? theme.colors.primary : theme.colors.border,
                                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                                paddingHorizontal: 12,
                                paddingVertical: 12,
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                            >
                              <Ionicons
                                name={plan.icon}
                                size={18}
                                color={active ? theme.colors.primary : theme.colors.textMuted}
                              />
                              <Text
                                style={[
                                  theme.typography.caption,
                                  { marginLeft: 8, color: active ? theme.colors.primary : theme.colors.text },
                                ]}
                              >
                                {plan.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <View style={{ marginTop: 6 }}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Student limit</Text>
                      <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                        Follows plan (same as web dashboard).
                      </Text>
                      <TextInput
                        value={editStudentLimit}
                        onChangeText={setEditStudentLimit}
                        placeholder="e.g. 30"
                        placeholderTextColor={theme.colors.textMuted}
                        keyboardType="numeric"
                        editable={false}
                        style={{
                          marginTop: 8,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surfaceAlt,
                          paddingHorizontal: 14,
                          paddingVertical: 14,
                          color: theme.colors.textMuted,
                          fontSize: 16,
                        }}
                      />
                    </View>

                    <View
                      style={{
                        marginTop: 16,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        backgroundColor: theme.colors.surfaceAlt,
                        paddingHorizontal: 14,
                        paddingVertical: 14,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={[theme.typography.bodyStrong, { fontSize: 15 }]}>Account status</Text>
                        <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                          {editActive ? "This account can access the platform." : "This account is disabled."}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => setEditActive((prev) => !prev)}
                        activeOpacity={0.85}
                        style={{
                          width: 62,
                          height: 34,
                          borderRadius: 999,
                          backgroundColor: editActive ? theme.colors.primary : theme.colors.borderStrong,
                          padding: 4,
                          justifyContent: "center",
                        }}
                      >
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            backgroundColor: "#FFFFFF",
                            transform: [{ translateX: editActive ? 28 : 0 }],
                          }}
                        />
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
                  <View style={{ flex: 1 }}>
                    <AppButton label="Cancel" variant="secondary" onPress={closeEditModal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      label={savingEdit ? "Saving..." : "Save"}
                      onPress={saveTeacherEdit}
                      loading={savingEdit}
                    />
                  </View>
                </View>
              </View>
            </ScrollView>
          </GlassCard>
        </View>
      </Modal>

      <Modal transparent visible={addModalVisible} animationType="fade" onRequestClose={closeAddModal}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            paddingHorizontal: 20,
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={closeAddModal}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <GlassCard style={{ borderRadius: 12, maxHeight: "88%" }} padding={0}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={{ padding: 18 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
                      {isAdmin ? "Add account" : "Add teacher"}
                    </Text>
                    <Text style={[theme.typography.title, { marginTop: 4 }]}>
                      {isAdmin ? "New teacher or principal" : "New teacher"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeAddModal}
                    activeOpacity={0.85}
                    style={{
                      height: 40,
                      width: 40,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surfaceAlt,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted }]}>
                  Same flow as the web dashboard. The user can sign in with this email and password.
                </Text>

                <View style={{ marginTop: 18 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Full name</Text>
                  <TextInput
                    value={addName}
                    onChangeText={setAddName}
                    placeholder="Teacher name"
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

                <View style={{ marginTop: 14 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Email</Text>
                  <TextInput
                    value={addEmail}
                    onChangeText={setAddEmail}
                    placeholder="teacher@example.com"
                    placeholderTextColor={theme.colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
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

                <View style={{ marginTop: 14 }}>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Temporary password</Text>
                  <TextInput
                    value={addPassword}
                    onChangeText={setAddPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor={theme.colors.textMuted}
                    secureTextEntry
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

                {isAdmin ? (
                  <>
                    <View style={{ marginTop: 16 }}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Role</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                        {NEW_ACCOUNT_ROLE_OPTIONS.map((option) => {
                          const active = addAccountRole === option.id;
                          return (
                            <TouchableOpacity
                              key={option.id}
                              onPress={() => setAddAccountRole(option.id as "teacher" | "principal")}
                              activeOpacity={0.85}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                paddingHorizontal: 12,
                                paddingVertical: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: active ? theme.colors.primary : theme.colors.border,
                                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                              }}
                            >
                              <Ionicons
                                name={option.icon}
                                size={16}
                                color={active ? theme.colors.primary : theme.colors.textMuted}
                              />
                              <Text
                                style={[
                                  theme.typography.caption,
                                  { marginLeft: 8, color: active ? theme.colors.primary : theme.colors.text },
                                ]}
                              >
                                {option.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    <View style={{ marginTop: 16 }}>
                      <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>Plan</Text>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          marginTop: 10,
                        }}
                      >
                        {PLAN_TYPES.filter((p) =>
                          getValidPlansForRole(addAccountRole).includes(planUiIdToDbPlan(p.id))
                        ).map((plan) => {
                          const active = addPlanUi === plan.id;
                          return (
                            <TouchableOpacity
                              key={plan.id}
                              onPress={() => setAddPlanUi(plan.id)}
                              activeOpacity={0.85}
                              style={{
                                width: "48.5%",
                                marginBottom: 10,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: active ? theme.colors.primary : theme.colors.border,
                                backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                                paddingHorizontal: 12,
                                paddingVertical: 12,
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                            >
                              <Ionicons
                                name={plan.icon}
                                size={18}
                                color={active ? theme.colors.primary : theme.colors.textMuted}
                              />
                              <Text
                                style={[
                                  theme.typography.caption,
                                  { marginLeft: 8, color: active ? theme.colors.primary : theme.colors.text },
                                ]}
                              >
                                {plan.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                        Teacher: Free/Tutor/Standard/Pro. Principal: School only.
                      </Text>
                    </View>

                    {addAccountRole === "teacher" ? (
                      <View style={{ marginTop: 12 }}>
                        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                          Assign to principal (optional)
                        </Text>
                        {addPrincipalsLoading ? (
                          <View style={{ marginTop: 12, alignItems: "center" }}>
                            <ActivityIndicator color={theme.colors.primary} />
                          </View>
                        ) : (
                          <View style={{ marginTop: 10, gap: 8 }}>
                            <TouchableOpacity
                              onPress={() => setAddPrincipalUserId("")}
                              activeOpacity={0.85}
                              style={{
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: addPrincipalUserId === "" ? theme.colors.primary : theme.colors.border,
                                backgroundColor: addPrincipalUserId === "" ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                                paddingHorizontal: 12,
                                paddingVertical: 12,
                              }}
                            >
                              <Text
                                style={[
                                  theme.typography.caption,
                                  {
                                    fontWeight: "700",
                                    color: addPrincipalUserId === "" ? theme.colors.primary : theme.colors.text,
                                  },
                                ]}
                              >
                                — Not assigned (no school/org) —
                              </Text>
                            </TouchableOpacity>
                            {addPrincipals.map((p) => {
                              const active = addPrincipalUserId === p.user_id;
                              const label = `${p.name ?? "Principal"}${p.org_id ? "" : " (missing org)"}${
                                p.email ? ` — ${p.email}` : ""
                              }`;
                              return (
                                <TouchableOpacity
                                  key={p.user_id}
                                  onPress={() => setAddPrincipalUserId(p.user_id)}
                                  activeOpacity={0.85}
                                  style={{
                                    borderRadius: 12,
                                    borderWidth: 1,
                                    borderColor: active ? theme.colors.primary : theme.colors.border,
                                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                                    paddingHorizontal: 12,
                                    paddingVertical: 12,
                                  }}
                                >
                                  <Text
                                    style={[
                                      theme.typography.caption,
                                      { color: active ? theme.colors.primary : theme.colors.text },
                                    ]}
                                    numberOfLines={2}
                                  >
                                    {label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                        <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted }]}>
                          Assigning links this teacher to the principal&apos;s organization.
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View
                    style={{
                      marginTop: 16,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.primarySoft,
                      padding: 14,
                    }}
                  >
                    <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                      Principal: new teachers use plan Free and join your school (org). Capacity limits apply like on
                      the web.
                    </Text>
                    {currentTeacher?.plan ? (
                      <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.text }]}>
                        Your plan: {currentTeacher.plan}
                      </Text>
                    ) : null}
                  </View>
                )}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 22 }}>
                  <View style={{ flex: 1 }}>
                    <AppButton label="Cancel" variant="secondary" onPress={closeAddModal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppButton
                      label={savingAdd ? "Creating…" : "Create"}
                      onPress={submitCreateTeacher}
                      loading={savingAdd}
                    />
                  </View>
                </View>
              </View>
            </ScrollView>
          </GlassCard>
        </View>
      </Modal>
    </View>
  );
}
