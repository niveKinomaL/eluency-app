import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { NavigationProp, useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassCard from "../components/GlassCard";
import AppButton from "../components/AppButton";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import {
  coercePlanForRole,
  getStudentLimitForPlan,
  normalizePlanUi,
} from "../lib/teacherRolePlanRules";

export type RootStudentsStackParams = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Students: undefined;
  StudentForm: { studentId?: string } | undefined;
  Subscription: undefined;
};

type StudentRow = {
  id: string;
  name: string;
  code: string;
  email?: string | null;
  teacher_id: string | null;
  is_active?: boolean | null;
  last_active: string | null;
  created_at: string;
  assigned_lessons?: string[] | null;
  assigned_tests?: string[] | null;
  progress?: { totalCorrect?: number; totalClose?: number } | null;
  teacher?: { name: string } | null;
};

type SortKey = "name" | "last_active" | "created_at";
type SortDir = "asc" | "desc";

function formatShortDate(dateIso?: string | null) {
  if (!dateIso) return "Never";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function StudentsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStudentsStackParams>>();

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [planName, setPlanName] = useState("Free");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [teacherView, setTeacherView] = useState<"mine" | string>("mine");
  const [teacherMenuOpen, setTeacherMenuOpen] = useState(false);

  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not logged in");

      setCurrentUserId(user.id);

      const { data: me, error: meError } = await (supabase.from("teachers") as any)
        .select("user_id, name, role, plan")
        .eq("user_id", user.id)
        .maybeSingle();

      if (meError) throw meError;

      const admin = (me?.role ?? "").toLowerCase().trim() === "admin";
      setIsAdmin(admin);
      const coerced = coercePlanForRole(me?.role ?? "teacher", me?.plan ?? "Free");
      setPlanName(normalizePlanUi(coerced));

      let query = (supabase.from("students") as any)
        .select("*, assigned_lessons, assigned_tests, teacher:teachers(name)")
        .order("created_at", { ascending: false });

      if (!admin) {
        query = query.eq("teacher_id", user.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      setStudents((data ?? []) as StudentRow[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load students";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStudents();
    }, [loadStudents])
  );

  const studentLimit = useMemo(() => getStudentLimitForPlan(planName), [planName]);
  const isUnlimited = isAdmin || studentLimit >= 999;

  const activeCount = useMemo(
    () => students.filter((s) => s.is_active !== false).length,
    [students]
  );
  const totalRecordCount = students.length;
  const deactivatedCount = totalRecordCount - activeCount;
  const isMaxed = !isUnlimited && activeCount >= studentLimit;

  const totals = useMemo(
    () =>
      students.reduce(
        (acc, s) => ({
          correct: acc.correct + (s.progress?.totalCorrect ?? 0),
          close: acc.close + (s.progress?.totalClose ?? 0),
        }),
        { correct: 0, close: 0 }
      ),
    [students]
  );

  const otherTeachers = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map<string, { name: string; count: number }>();
    for (const s of students) {
      const tid = s.teacher_id;
      const tname = (s.teacher as { name?: string } | null)?.name;
      if (tid && tname && tid !== currentUserId) {
        const existing = map.get(tid);
        map.set(tid, { name: tname, count: (existing?.count ?? 0) + 1 });
      }
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students, isAdmin, currentUserId]);

  const studentsForView = useMemo(() => {
    if (!isAdmin) return students;
    if (teacherView === "mine") return students.filter((s) => s.teacher_id === currentUserId);
    return students.filter((s) => s.teacher_id === teacherView);
  }, [students, isAdmin, teacherView, currentUserId]);

  const viewingOtherTeacher = isAdmin && teacherView !== "mine";

  const cycleSort = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  };

  const filteredSorted = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const base = studentsForView.filter((s) => (s.name ?? "").toLowerCase().includes(q));
    return [...base].sort((a, b) => {
      const av = (a as any)[sortKey] ?? "";
      const bv = (b as any)[sortKey] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [studentsForView, searchTerm, sortKey, sortDir]);

  const copyCode = async (code: string) => {
    if (!code) return;
    try {
      await Clipboard.setStringAsync(code);
      Alert.alert("Copied", "Access code copied to clipboard.");
    } catch {
      Alert.alert("Error", "Could not copy.");
    }
  };

  const handleToggleStatus = async (student: StudentRow) => {
    const currentlyActive = student.is_active !== false;
    const newStatus = !currentlyActive;
    if (newStatus && isMaxed && !isAdmin) {
      Alert.alert(
        "Capacity reached",
        `You can have up to ${studentLimit} active students. Deactivate another student first.`
      );
      return;
    }
    setToggleLoadingId(student.id);
    try {
      const { error } = await (supabase.from("students") as any)
        .update({ is_active: newStatus })
        .eq("id", student.id);
      if (error) throw error;
      setStudents((prev) =>
        prev.map((s) => (s.id === student.id ? { ...s, is_active: newStatus } : s))
      );
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setToggleLoadingId(null);
    }
  };

  const handleDelete = (student: StudentRow) => {
    Alert.alert("Delete student", `Remove "${student.name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleteLoadingId(student.id);
          try {
            const { error } = await supabase.from("students").delete().eq("id", student.id);
            if (error) throw error;
            setStudents((prev) => prev.filter((s) => s.id !== student.id));
          } catch (e: unknown) {
            Alert.alert("Error", e instanceof Error ? e.message : "Delete failed");
          } finally {
            setDeleteLoadingId(null);
          }
        },
      },
    ]);
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
  };

  if (loading && students.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[theme.typography.body, { marginTop: 12 }]}>Loading students…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
          <Text style={theme.typography.label}>Directory</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Students</Text>
        </View>
        {isMaxed && !isAdmin ? (
          <View style={{ alignItems: "flex-end" }}>
            <View style={{ opacity: 0.6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border }}>
              <Text style={{ fontSize: 10, fontWeight: "800" }}>MAX</Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => navigation.navigate("StudentForm")}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: theme.colors.primary,
            }}
          >
            <Text style={{ color: theme.colors.primaryText, fontWeight: "800", fontSize: 12 }}>NEW</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 8) + 62,
          paddingHorizontal: 20,
          paddingBottom: 40,
        }}
      >
        <GlassCard style={{ borderRadius: 16, marginBottom: 14 }} padding={16}>
          <Text style={[theme.typography.title, { fontSize: 22 }]}>Students directory</Text>
          <Text style={[theme.typography.body, { marginTop: 8, color: theme.colors.textMuted }]}>
            {isAdmin
              ? "Global student management for all teachers."
              : `Managing ${activeCount} active students. Cap: ${isUnlimited ? "∞" : `${activeCount} / ${studentLimit}`}.`}
          </Text>
        </GlassCard>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          {isAdmin ? (
            <>
              <KpiTile theme={theme} label="Total" value={String(totalRecordCount)} icon="people-outline" />
              <KpiTile theme={theme} label="Active" value={String(activeCount)} icon="checkmark-circle-outline" tone="success" />
              <KpiTile theme={theme} label="Deactivated" value={String(deactivatedCount)} icon="person-remove-outline" tone="danger" />
            </>
          ) : (
            <>
              <KpiTile
                theme={theme}
                label="Student cap"
                value={`${activeCount}/${isUnlimited ? "∞" : studentLimit}`}
                icon="people-outline"
                danger={isMaxed}
              />
              <KpiTile theme={theme} label="Correct" value={String(totals.correct)} icon="checkmark-done-outline" />
              <KpiTile theme={theme} label="Close" value={String(totals.close)} icon="alert-circle-outline" />
              <KpiTile theme={theme} label="Total record" value={String(totalRecordCount)} icon="layers-outline" />
            </>
          )}
        </View>

        {!isAdmin && planName === "Free" ? (
          <GlassCard style={{ borderRadius: 16, marginBottom: 14 }} padding={14}>
            <Text style={theme.typography.bodyStrong}>You are on the Free plan</Text>
            <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]}>
              Higher plans include more students and unlimited lessons.
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Subscription")}
              style={{ marginTop: 12, alignSelf: "flex-start" }}
            >
              <Text style={{ color: theme.colors.primary, fontWeight: "800" }}>View plans →</Text>
            </TouchableOpacity>
          </GlassCard>
        ) : null}

        <GlassCard style={{ borderRadius: 16 }} padding={16}>
          {isAdmin ? (
            <View style={{ marginBottom: 14 }}>
              <Text style={[theme.typography.caption, { marginBottom: 8, textTransform: "uppercase" }]}>Filter by teacher</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setTeacherView("mine")}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: teacherView === "mine" ? theme.colors.primary : theme.colors.border,
                    backgroundColor: teacherView === "mine" ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 12 }}>My students</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setTeacherMenuOpen(true)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: viewingOtherTeacher ? theme.colors.primary : theme.colors.border,
                    backgroundColor: viewingOtherTeacher ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 12 }}>
                    {viewingOtherTeacher
                      ? otherTeachers.find((t) => t.id === teacherView)?.name ?? "Teacher"
                      : "Other teacher…"}
                  </Text>
                </TouchableOpacity>
                {viewingOtherTeacher ? (
                  <TouchableOpacity onPress={() => setTeacherView("mine")} style={{ justifyContent: "center" }}>
                    <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}

          <TextInput
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholder="Search students…"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 12 }]}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {(
              [
                { key: "name" as SortKey, label: "Name" },
                { key: "last_active" as SortKey, label: "Last active" },
                { key: "created_at" as SortKey, label: "Created" },
              ] as const
            ).map(({ key, label }) => {
              const active = sortKey === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => cycleSort(key)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.border,
                    backgroundColor: active ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "800" }}>{label}</Text>
                  {active ? (
                    <Ionicons
                      name={sortDir === "asc" ? "arrow-up" : "arrow-down"}
                      size={14}
                      color={theme.colors.primary}
                      style={{ marginLeft: 4 }}
                    />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>

          {studentsForView.length === 0 ? (
            <View style={{ paddingVertical: 32, alignItems: "center" }}>
              <Ionicons name="school-outline" size={48} color={theme.colors.textMuted} style={{ opacity: 0.25 }} />
              <Text style={[theme.typography.body, { marginTop: 12, color: theme.colors.textMuted }]}>No students found.</Text>
            </View>
          ) : filteredSorted.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={theme.typography.body}>No match for “{searchTerm}”</Text>
              <TouchableOpacity onPress={() => setSearchTerm("")} style={{ marginTop: 12 }}>
                <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>Clear search</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredSorted.map((student) => {
              const isActive = student.is_active !== false;
              const lessonsN = Array.isArray(student.assigned_lessons) ? student.assigned_lessons.length : 0;
              const testsN = Array.isArray(student.assigned_tests) ? student.assigned_tests.length : 0;
              return (
                <View
                  key={student.id}
                  style={{
                    marginBottom: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surfaceAlt,
                    padding: 14,
                    opacity: isActive ? 1 : 0.72,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: isActive ? "#2563EB" : theme.colors.border,
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
                        {(student.name ?? "?").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <TouchableOpacity onPress={() => navigation.navigate("StudentForm", { studentId: student.id })}>
                        <Text style={[theme.typography.title, { fontSize: 17 }]} numberOfLines={2}>
                          {student.name}
                        </Text>
                      </TouchableOpacity>
                      {!isActive ? (
                        <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.danger, marginTop: 4 }}>INACTIVE</Text>
                      ) : null}
                      {isAdmin ? (
                        <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                          Teacher: {(student.teacher as any)?.name ?? "—"}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      onPress={() => handleToggleStatus(student)}
                      disabled={toggleLoadingId === student.id}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: isActive ? theme.colors.success : theme.colors.danger,
                        backgroundColor: isActive ? theme.colors.successSoft : theme.colors.dangerSoft,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {toggleLoadingId === student.id ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      ) : (
                        <Ionicons
                          name={isActive ? "checkmark-circle" : "close-circle"}
                          size={16}
                          color={isActive ? theme.colors.success : theme.colors.danger}
                        />
                      )}
                      <Text style={{ fontSize: 11, fontWeight: "800" }}>{isActive ? "Active" : "Inactive"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => copyCode(student.code)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Text style={{ fontFamily: "monospace", fontWeight: "800", fontSize: 14, color: theme.colors.primary }}>
                        {student.code}
                      </Text>
                      <Ionicons name="copy-outline" size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: "rgba(59,130,246,0.12)",
                        borderWidth: 1,
                        borderColor: "rgba(59,130,246,0.25)",
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#2563EB" }}>{lessonsN} lessons</Text>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 8,
                        backgroundColor: "rgba(234,179,8,0.15)",
                        borderWidth: 1,
                        borderColor: "rgba(234,179,8,0.3)",
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#CA8A04" }}>{testsN} tests</Text>
                    </View>
                    <Text style={[theme.typography.caption, { alignSelf: "center", color: theme.colors.textMuted }]}>
                      Last: {formatShortDate(student.last_active)}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", marginTop: 14, gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <AppButton
                        label="Edit"
                        onPress={() => navigation.navigate("StudentForm", { studentId: student.id })}
                        variant="secondary"
                        fullWidth
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppButton
                        label="Remove"
                        onPress={() => handleDelete(student)}
                        loading={deleteLoadingId === student.id}
                        variant="secondary"
                        fullWidth
                      />
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </GlassCard>
      </ScrollView>

      {isAdmin && teacherMenuOpen ? (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            top: Math.max(insets.top, 8) + 200,
            maxHeight: 320,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            zIndex: 100,
            paddingVertical: 8,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingBottom: 8 }}>
            <Text style={theme.typography.bodyStrong}>Pick teacher</Text>
            <TouchableOpacity onPress={() => setTeacherMenuOpen(false)}>
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 260 }}>
            {otherTeachers.length === 0 ? (
              <Text style={{ padding: 16, color: theme.colors.textMuted }}>No other teachers with students.</Text>
            ) : (
              otherTeachers.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => {
                    setTeacherView(t.id);
                    setTeacherMenuOpen(false);
                  }}
                  style={{ paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
                >
                  <Text style={theme.typography.body}>{t.name}</Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{t.count} students</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function KpiTile({
  theme,
  label,
  value,
  icon,
  tone,
  danger,
}: {
  theme: ReturnType<typeof useAppTheme>;
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "success" | "danger";
  danger?: boolean;
}) {
  const bg =
    danger ? theme.colors.dangerSoft : tone === "success" ? theme.colors.successSoft : tone === "danger" ? theme.colors.dangerSoft : theme.colors.primarySoft;
  const fg = danger ? theme.colors.danger : tone === "success" ? theme.colors.success : tone === "danger" ? theme.colors.danger : theme.colors.primary;
  return (
    <View
      style={{
        flexGrow: 1,
        minWidth: "42%",
        flexBasis: "42%",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: theme.colors.surfaceAlt,
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={22} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[theme.typography.caption, { textTransform: "uppercase", fontSize: 10 }]}>{label}</Text>
        <Text style={[theme.typography.title, { fontSize: 22, marginTop: 2 }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}
