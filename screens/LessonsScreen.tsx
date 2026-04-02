import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { NavigationProp, useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";

export type RootLessonsStackParams = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Lessons: undefined;
  LessonForm: { lessonId?: string } | undefined;
  Subscription: undefined;
};

type LessonRow = {
  id: string;
  title: string | null;
  status: string | null;
  created_at: string | null;
  cover_image_url?: string | null;
  created_by?: string | null;
  language?: string | null;
  teachers?: { name: string } | null;
};

const apiBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

export default function LessonsScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootLessonsStackParams>>();

  const [loading, setLoading] = useState(true);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [teacherView, setTeacherView] = useState<"mine" | string>("mine");
  const [teacherMenuOpen, setTeacherMenuOpen] = useState(false);
  const [lessonPackNames, setLessonPackNames] = useState<Record<string, string[]>>({});

  const PAGE_SIZE = 10;

  const canManage = useMemo(() => {
    const r = role.toLowerCase().trim();
    return r === "admin" || r === "teacher";
  }, [role]);

  const loadLessons = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");
      setCurrentUserId(user.id);

      const { data: teacherRow, error: trErr } = await (supabase.from("teachers") as any)
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (trErr) throw trErr;

      const admin = (teacherRow as { role?: string } | null)?.role === "admin";
      setIsAdmin(admin);
      setRole((teacherRow as { role?: string } | null)?.role ?? "");

      let query = (supabase.from("lessons") as any)
        .select("id, title, status, created_at, cover_image_url, created_by, language")
        .order("created_at", { ascending: false });
      if (!admin) query = query.eq("created_by", user.id);

      const { data, error } = await query;
      if (error) throw error;
      let rows = (data ?? []) as LessonRow[];

      if (admin && rows.length) {
        const ownerIds = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean))) as string[];
        if (ownerIds.length) {
          const { data: teachersData, error: teachersErr } = await (supabase.from("teachers") as any)
            .select("user_id, name")
            .in("user_id", ownerIds);
          if (teachersErr) throw teachersErr;
          const byId = new Map<string, string>(
            ((teachersData ?? []) as { user_id: string; name: string }[]).map((t) => [t.user_id, t.name])
          );
          rows = rows.map((r) => ({
            ...r,
            teachers: r.created_by ? { name: byId.get(r.created_by) ?? "" } : null,
          }));
        }
      }

      setLessons(rows);

      // Fetch pack memberships for these lessons
      if (rows.length) {
        const lessonIds = rows.map((r) => r.id);
        const { data: linkData } = await (supabase.from("lesson_pack_lessons") as any)
          .select("pack_id, lesson_id")
          .in("lesson_id", lessonIds);
        const links = (linkData ?? []) as { pack_id: string; lesson_id: string }[];
        if (links.length) {
          const packIds = Array.from(new Set(links.map((l) => l.pack_id)));
          const { data: packData } = await (supabase.from("lesson_packs") as any)
            .select("id, name")
            .in("id", packIds);
          const packNameById = new Map<string, string>(
            ((packData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
          );
          const map: Record<string, string[]> = {};
          for (const link of links) {
            const name = packNameById.get(link.pack_id);
            if (!name) continue;
            if (!map[link.lesson_id]) map[link.lesson_id] = [];
            map[link.lesson_id].push(name);
          }
          setLessonPackNames(map);
        } else {
          setLessonPackNames({});
        }
      }
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to load lessons");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLessons();
    }, [loadLessons])
  );

  const otherTeachers = useMemo(() => {
    if (!isAdmin) return [];
    const map = new Map<string, { name: string; count: number }>();
    for (const l of lessons) {
      const tid = l.created_by;
      const tname = l.teachers?.name;
      if (tid && tname && tid !== currentUserId) {
        const cur = map.get(tid);
        map.set(tid, { name: tname, count: (cur?.count ?? 0) + 1 });
      }
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [isAdmin, lessons, currentUserId]);

  const viewingOtherTeacher = isAdmin && teacherView !== "mine";
  const lessonsForView = useMemo(() => {
    if (!isAdmin) return lessons;
    if (teacherView === "mine") return lessons.filter((l) => l.created_by === currentUserId);
    return lessons.filter((l) => l.created_by === teacherView);
  }, [isAdmin, lessons, teacherView, currentUserId]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return lessonsForView.filter((l) => (l.title ?? "").toLowerCase().includes(q));
  }, [lessonsForView, searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, lessonsForView.length, teacherView]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pagedLessons = useMemo(
    () => filtered.slice(pageStart, pageStart + PAGE_SIZE),
    [filtered, pageStart]
  );

  const openWebNew = async () => {
    const url = `${apiBaseUrl.replace(/\/$/, "")}/dashboard/lessons/new`;
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert("Open web", url);
  };

  const openWebEdit = async (id: string) => {
    const url = `${apiBaseUrl.replace(/\/$/, "")}/dashboard/lessons/${id}/edit`;
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else Alert.alert("Open web", url);
  };

  if (loading && lessons.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {/* Header */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          backgroundColor: theme.isDark ? theme.colors.background : "#FFF",
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
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Lessons</Text>
        </View>
        {canManage ? (
          <TouchableOpacity
            onPress={() => navigation.navigate("LessonForm")}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.primary }}
          >
            <Text style={{ color: theme.colors.primaryText, fontWeight: "800", fontSize: 12 }}>NEW</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 8) + 62, paddingHorizontal: 20, paddingBottom: 40 }}
      >
        {/* Lesson Library pill — coloured */}
        <View
          style={{
            borderRadius: 16,
            marginBottom: 14,
            padding: 16,
            backgroundColor: theme.colors.primarySoft,
            borderWidth: 1,
            borderColor: theme.colors.primary,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: theme.colors.primary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="library-outline" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[theme.typography.title, { fontSize: 18, color: theme.colors.primary }]}>Lesson Library</Text>
              <Text style={[theme.typography.caption, { color: theme.colors.primary, opacity: 0.7, marginTop: 2 }]}>
                Create and manage your lessons.
              </Text>
            </View>
          </View>
        </View>

        {/* Lessons list pill — contrasted */}
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.isDark ? "#1a1a2e" : "#F8F9FF",
            padding: 16,
          }}
        >
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
                  <Text style={{ fontWeight: "800", fontSize: 12 }}>My lessons</Text>
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
            placeholder="Search lessons..."
            placeholderTextColor={theme.colors.textMuted}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
              marginBottom: 12,
            }}
          />

          {filtered.length === 0 ? (
            <View style={{ paddingVertical: 28, alignItems: "center" }}>
              <Ionicons name="book-outline" size={44} color={theme.colors.textMuted} style={{ opacity: 0.3 }} />
              <Text style={[theme.typography.body, { marginTop: 10, color: theme.colors.textMuted }]}>No lessons found.</Text>
              {canManage ? (
                <TouchableOpacity
                  onPress={() => navigation.navigate("LessonForm")}
                  style={{ marginTop: 14, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.primary }}
                >
                  <Text style={{ color: theme.colors.primaryText, fontWeight: "800" }}>Create lesson</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                  Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
                </Text>
                <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>
                  Page {safePage}/{totalPages}
                </Text>
              </View>

              {pagedLessons.map((lesson) => {
                const packs = lessonPackNames[lesson.id] ?? [];
                return (
                  <View
                    key={lesson.id}
                    style={{
                      marginBottom: 10,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface,
                      padding: 12,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      {/* Image */}
                      {lesson.cover_image_url?.trim() ? (
                        <Image
                          source={{ uri: lesson.cover_image_url.trim() }}
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 10,
                            marginRight: 12,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            backgroundColor: theme.colors.surfaceAlt,
                          }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: 10,
                            marginRight: 12,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            backgroundColor: theme.colors.surfaceAlt,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Ionicons name="image-outline" size={22} color={theme.colors.textMuted} />
                        </View>
                      )}

                      {/* Title + tags */}
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => navigation.navigate("LessonForm", { lessonId: lesson.id })}
                      >
                        <Text style={{ fontSize: 16, fontWeight: "900", color: theme.colors.text }} numberOfLines={2}>
                          {lesson.title ?? "Untitled"}
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                          {lesson.language ? (
                            <View style={{
                              borderRadius: 999,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              backgroundColor: theme.colors.primarySoft,
                              borderWidth: 1,
                              borderColor: theme.colors.primary,
                            }}>
                              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.primary }}>{lesson.language}</Text>
                            </View>
                          ) : null}
                          {packs.map((packName) => (
                            <View key={packName} style={{
                              borderRadius: 999,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              backgroundColor: theme.colors.violetSoft ?? "#EDE9FE",
                              borderWidth: 1,
                              borderColor: "#7C3AED",
                            }}>
                              <Text style={{ fontSize: 11, fontWeight: "700", color: "#7C3AED" }}>📦 {packName}</Text>
                            </View>
                          ))}
                          {isAdmin && lesson.teachers?.name ? (
                            <Text style={{ fontSize: 11, color: theme.colors.textMuted, alignSelf: "center" }}>· {lesson.teachers.name}</Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>

                      {/* Web button — top right */}
                      {canManage ? (
                        <TouchableOpacity
                          onPress={() => openWebEdit(lesson.id)}
                          style={{
                            marginLeft: 8,
                            paddingVertical: 5,
                            paddingHorizontal: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: theme.colors.border,
                            backgroundColor: theme.colors.surfaceAlt,
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.textMuted }}>Web</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {/* Edit button below */}
                    {canManage ? (
                      <TouchableOpacity
                        onPress={() => navigation.navigate("LessonForm", { lessonId: lesson.id })}
                        style={{
                          marginTop: 10,
                          paddingVertical: 7,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surfaceAlt,
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.text }}>Edit</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}

              {totalPages > 1 ? (
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <TouchableOpacity
                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface,
                      opacity: safePage <= 1 ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.text }}>Previous</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface,
                      opacity: safePage >= totalPages ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.text }}>Next</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          )}
        </View>
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
              <Text style={{ padding: 16, color: theme.colors.textMuted }}>No other teachers with lessons.</Text>
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
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{t.count} lessons</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
