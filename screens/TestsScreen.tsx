import { useCallback, useMemo, useState } from "react";
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
import Constants from "expo-constants";
import { NavigationProp, useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { normalizePlanUi } from "../lib/teacherRolePlanRules";

export type RootTestsStackParams = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Tests: undefined;
  TestForm: { testId?: string } | undefined;
  Subscription: undefined;
};

const VOCAB_TYPES = ["Vocabulary", "False Cognates", "Cognates", "Idioms & Expressions"];

type TestRow = {
  id: string;
  name: string | null;
  type: string | null;
  status?: string | null;
  description?: string | null;
  teacher_id?: string | null;
  config_json?: { words?: unknown[]; tests?: unknown[] } | null;
  teachers?: { name: string } | null;
};

type SortKey = "name" | "type" | "wordCount" | "questionCount";
type SortDir = "asc" | "desc";

const apiBaseUrl =
  Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

export default function TestsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootTestsStackParams>>();

  const [loading, setLoading] = useState(true);
  const [tests, setTests] = useState<TestRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState("");
  const [planRaw, setPlanRaw] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [teacherView, setTeacherView] = useState<"mine" | string>("mine");
  const [teacherMenuOpen, setTeacherMenuOpen] = useState(false);

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const planUi = normalizePlanUi(planRaw);
  const isFreePlan = planUi === "Free";

  const canManage = useMemo(() => {
    const r = (role ?? "").toLowerCase().trim();
    return r === "admin" || r === "teacher";
  }, [role]);

  const loadTests = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not logged in");

      setCurrentUserId(user.id);

      const { data: teacherRow, error: trErr } = await (supabase.from("teachers") as any)
        .select("role, plan")
        .eq("user_id", user.id)
        .maybeSingle();

      if (trErr) throw trErr;

      const admin = (teacherRow as { role?: string } | null)?.role === "admin";
      setIsAdmin(admin);
      setRole((teacherRow as { role?: string } | null)?.role ?? "");
      setPlanRaw((teacherRow as { plan?: string | null } | null)?.plan ?? null);

      const select = admin ? "*, teachers(name)" : "*";
      let query = (supabase.from("tests") as any).select(select).order("created_at", { ascending: false });
      if (!admin) {
        query = query.eq("teacher_id", user.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      setTests((data ?? []) as TestRow[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load tests";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTests();
    }, [loadTests])
  );

  const otherTeachers = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map<string, { name: string; count: number }>();
    for (const t of tests) {
      const tid = t.teacher_id;
      const tname = t.teachers?.name;
      if (tid && tname && tid !== currentUserId) {
        const existing = map.get(tid);
        map.set(tid, { name: tname, count: (existing?.count ?? 0) + 1 });
      }
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tests, isAdmin, currentUserId]);

  const viewingOtherTeacher = isAdmin && teacherView !== "mine";

  const testsForView = useMemo(() => {
    if (!isAdmin) return tests;
    if (teacherView === "mine") return tests.filter((t) => t.teacher_id === currentUserId);
    return tests.filter((t) => t.teacher_id === teacherView);
  }, [tests, isAdmin, teacherView, currentUserId]);

  const publishedCount = useMemo(() => testsForView.filter((t) => t.status === "published").length, [testsForView]);
  const draftCount = useMemo(() => testsForView.filter((t) => t.status === "draft").length, [testsForView]);
  const vocabCount = useMemo(
    () => testsForView.filter((t) => VOCAB_TYPES.includes(t.type ?? "")).length,
    [testsForView]
  );

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
    return [...testsForView]
      .filter(
        (t) =>
          (t.name ?? "").toLowerCase().includes(q) || (t.type ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortKey === "wordCount") {
          av = a.config_json?.words?.length ?? 0;
          bv = b.config_json?.words?.length ?? 0;
        } else if (sortKey === "questionCount") {
          av = a.config_json?.tests?.length ?? 0;
          bv = b.config_json?.tests?.length ?? 0;
        } else {
          av = ((a as any)[sortKey] ?? "").toString().toLowerCase();
          bv = ((b as any)[sortKey] ?? "").toString().toLowerCase();
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [testsForView, searchTerm, sortKey, sortDir]);

  const openWebEdit = async (id: string) => {
    const url = `${apiBaseUrl.replace(/\/$/, "")}/dashboard/tests/${id}/edit`;
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert("Open web", url);
  };

  const duplicateTest = async (test: TestRow) => {
    setActionLoadingId(test.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const base = apiBaseUrl.replace(/\/$/, "");
      const payload = {
        name: `${test.name ?? "Test"} (Copy)`,
        type: test.type ?? "Vocabulary",
        config_json: test.config_json ?? { tests: [], words: [], linked_lesson_ids: [] },
        status: "draft",
        teacher_id: currentUserId,
        created_by: currentUserId,
        description: test.description != null && test.description !== "" ? test.description : null,
      };

      let res = await fetch(`${base}/api/admin/tests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const ins = await (supabase.from("tests") as any).insert({
          name: payload.name,
          type: payload.type,
          config_json: payload.config_json,
          status: payload.status,
          teacher_id: currentUserId,
          created_by: currentUserId,
          description: payload.description,
        });
        if (ins.error) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data?.error ?? ins.error.message ?? "Duplicate failed");
        }
      }

      Alert.alert("Done", "Test duplicated as draft.");
      await loadTests();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Duplicate failed");
    } finally {
      setActionLoadingId(null);
    }
  };

  const deleteTest = (test: TestRow) => {
    Alert.alert("Delete test", `Remove "${test.name ?? "Untitled"}"? It will be unassigned from students.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setActionLoadingId(test.id);
          try {
            if (!isAdmin && test.teacher_id && test.teacher_id !== currentUserId) {
              throw new Error("You can only delete your own tests.");
            }

            // Keep mobile deletion independent from web cookies endpoint.
            // First, unassign the test from students that contain it.
            let studentsQuery = (supabase.from("students") as any)
              .select("id, assigned_tests")
              .contains("assigned_tests", [test.id]);
            if (!isAdmin) {
              studentsQuery = studentsQuery.eq("teacher_id", currentUserId);
            }
            const { data: studentsRows, error: studentsErr } = await studentsQuery;
            if (studentsErr) throw studentsErr;

            const students = (studentsRows ?? []) as { id: string; assigned_tests?: string[] | null }[];
            for (const s of students) {
              const current = Array.isArray(s.assigned_tests) ? s.assigned_tests : [];
              const next = current.filter((x) => x !== test.id);
              if (next.length !== current.length) {
                const { error: upErr } = await (supabase.from("students") as any)
                  .update({ assigned_tests: next })
                  .eq("id", s.id);
                if (upErr) throw upErr;
              }
            }

            // Then delete the test itself.
            let deleteQuery = (supabase.from("tests") as any).delete().eq("id", test.id);
            if (!isAdmin) {
              deleteQuery = deleteQuery.eq("teacher_id", currentUserId);
            }
            const { error: deleteErr } = await deleteQuery;
            if (deleteErr) throw deleteErr;

            setTests((prev) => prev.filter((t) => t.id !== test.id));
            Alert.alert("Deleted", "Test removed.");
          } catch (e: unknown) {
            Alert.alert("Error", e instanceof Error ? e.message : "Delete failed");
          } finally {
            setActionLoadingId(null);
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

  if (loading && tests.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[theme.typography.body, { marginTop: 12 }]}>Loading tests…</Text>
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
          <Text style={theme.typography.label}>Library</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Tests</Text>
        </View>
        {canManage ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("TestForm")}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: theme.colors.primary,
            }}
          >
            <Text style={{ color: theme.colors.primaryText, fontWeight: "800", fontSize: 12 }}>NEW</Text>
          </TouchableOpacity>
        ) : null}
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
          <Text style={[theme.typography.title, { fontSize: 22 }]}>Tests library</Text>
          <Text style={[theme.typography.body, { marginTop: 8, color: theme.colors.textMuted }]}>
            Manage grammar assessments and vocabulary configurations.
          </Text>
          {canManage ? (
            <Text style={[theme.typography.caption, { marginTop: 10, color: theme.colors.textMuted }]}>
              Create and edit tests in the app (tap New or Edit). Use Web for image/audio and advanced question types.
            </Text>
          ) : null}
        </GlassCard>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <StatCard
            theme={theme}
            label="Total"
            value={!isAdmin && isFreePlan ? `${testsForView.length}/5` : String(testsForView.length)}
            icon="grid-outline"
            accent="#D45917"
          />
          <StatCard theme={theme} label="Live" value={String(publishedCount)} icon="checkmark-circle-outline" accent={theme.colors.success} />
          <StatCard theme={theme} label="Drafts" value={String(draftCount)} icon="document-text-outline" accent="#FB7185" />
          <StatCard theme={theme} label="Vocab" value={String(vocabCount)} icon="language-outline" accent="#D45917" />
        </View>

        {!isAdmin && isFreePlan ? (
          <GlassCard style={{ borderRadius: 16, marginBottom: 14 }} padding={14}>
            <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
              Free plan includes up to 5 tests. Upgrade for unlimited.
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate("Subscription")} style={{ marginTop: 10 }}>
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
                  <Text style={{ fontWeight: "800", fontSize: 12 }}>My tests</Text>
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
            placeholder="Search tests…"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 12 }]}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
            {(
              [
                { key: "name" as SortKey, label: "Name" },
                { key: "type" as SortKey, label: "Type" },
                { key: "wordCount" as SortKey, label: "Words" },
                { key: "questionCount" as SortKey, label: "Questions" },
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

          {testsForView.length === 0 ? (
            <View style={{ paddingVertical: 32, alignItems: "center" }}>
              <Ionicons name="clipboard-outline" size={48} color={theme.colors.textMuted} style={{ opacity: 0.25 }} />
              <Text style={[theme.typography.body, { marginTop: 12, color: theme.colors.textMuted }]}>No tests found.</Text>
              {canManage ? (
                <TouchableOpacity
                  onPress={() => navigation.navigate("TestForm")}
                  style={{
                    marginTop: 16,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: theme.colors.primary,
                  }}
                >
                  <Text style={{ color: theme.colors.primaryText, fontWeight: "800", fontSize: 13 }}>Create test</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : filteredSorted.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <Text style={theme.typography.body}>No match for “{searchTerm}”</Text>
              <TouchableOpacity onPress={() => setSearchTerm("")} style={{ marginTop: 12 }}>
                <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>Clear search</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredSorted.map((test) => {
              const cfg = test.config_json ?? {};
              const wordCount = Array.isArray(cfg.words) ? cfg.words.length : 0;
              const questionCount = Array.isArray(cfg.tests) ? cfg.tests.length : 0;
              const busy = actionLoadingId === test.id;

              return (
                <View
                  key={test.id}
                  style={{
                    marginBottom: 12,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surfaceAlt,
                    padding: 14,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: "#A560E8",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                      }}
                    >
                      <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
                        {(test.name ?? "?").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <TouchableOpacity onPress={() => navigation.navigate("TestForm", { testId: test.id })}>
                        <Text style={[theme.typography.title, { fontSize: 17 }]} numberOfLines={2}>
                          {test.name ?? "Untitled"}
                        </Text>
                      </TouchableOpacity>
                      <Text style={[theme.typography.caption, { marginTop: 4, fontWeight: "800", textTransform: "uppercase" }]}>
                        {test.type ?? "Vocabulary"} · {test.status === "published" ? "Live" : "Draft"}
                      </Text>
                      {isAdmin ? (
                        <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                          {test.teachers?.name ?? "—"}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
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
                      <Text style={{ fontSize: 11, fontWeight: "800", color: "#2563EB" }}>{wordCount} words</Text>
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
                        {questionCount} questions
                      </Text>
                    </View>
                  </View>

                  {canManage ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 12, gap: 8, alignItems: "center" }}>
                      <TouchableOpacity
                        onPress={() => navigation.navigate("TestForm", { testId: test.id })}
                        disabled={busy}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surface,
                          opacity: busy ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.text }}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => duplicateTest(test)}
                        disabled={busy}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surface,
                          opacity: busy ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.text }}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => deleteTest(test)}
                        disabled={busy}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: theme.colors.danger,
                          backgroundColor: theme.colors.surface,
                          opacity: busy ? 0.5 : 1,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.danger }}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => openWebEdit(test.id)} style={{ marginTop: 12 }}>
                      <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>View on web →</Text>
                    </TouchableOpacity>
                  )}
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
              <Text style={{ padding: 16, color: theme.colors.textMuted }}>No other teachers with tests.</Text>
            ) : (
              otherTeachers.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => {
                    setTeacherView(t.id);
                    setTeacherMenuOpen(false);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <Text style={theme.typography.body}>{t.name}</Text>
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{t.count} tests</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function StatCard({
  theme,
  label,
  value,
  icon,
  accent,
}: {
  theme: ReturnType<typeof useAppTheme>;
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
}) {
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
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: `${accent}22`,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={22} color={accent} />
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
