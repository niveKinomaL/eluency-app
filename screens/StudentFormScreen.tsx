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
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { NavigationProp, RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import type { RootStudentsStackParams } from "./StudentsScreen";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRandomCode(): string {
  return Array.from({ length: 6 }, () =>
    CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length))
  ).join("");
}

type LessonOpt = { id: string; title: string };
type TestOpt = { id: string; name: string };
type TeacherOpt = { id: string; name: string };

export default function StudentFormScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStudentsStackParams>>();
  const route = useRoute<RouteProp<RootStudentsStackParams, "StudentForm">>();
  const studentId = route.params?.studentId;
  const isEdit = !!studentId;

  const [bootLoading, setBootLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);

  const [teachers, setTeachers] = useState<TeacherOpt[]>([]);
  const [allLessons, setAllLessons] = useState<LessonOpt[]>([]);
  const [allTests, setAllTests] = useState<TestOpt[]>([]);
  const [contentLoading, setContentLoading] = useState(false);

  const [lessonSearch, setLessonSearch] = useState("");
  const [testSearch, setTestSearch] = useState("");
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);

  const filteredLessons = useMemo(
    () => allLessons.filter((l) => l.title.toLowerCase().includes(lessonSearch.toLowerCase())),
    [allLessons, lessonSearch]
  );
  const filteredTests = useMemo(
    () => allTests.filter((t) => (t.name ?? "").toLowerCase().includes(testSearch.toLowerCase())),
    [allTests, testSearch]
  );
  const filteredTeachers = useMemo(
    () => teachers.filter((t) => t.name.toLowerCase().includes(teacherSearch.toLowerCase())),
    [teachers, teacherSearch]
  );

  const loadListsForTeacher = useCallback(
    async (tid: string) => {
      if (!tid) {
        setAllLessons([]);
        setAllTests([]);
        return;
      }
      setContentLoading(true);
      try {
        const [l, t] = await Promise.all([
          supabase.from("lessons").select("id, title").eq("status", "published").eq("created_by", tid).order("created_at", { ascending: false }),
          supabase.from("tests").select("id, name").eq("status", "published").eq("teacher_id", tid).order("created_at", { ascending: false }),
        ]);
        setAllLessons((l.data as LessonOpt[]) || []);
        setAllTests((t.data as TestOpt[]) || []);
      } finally {
        setContentLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBootLoading(true);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          Alert.alert("Sign in required");
          navigation.goBack();
          return;
        }
        if (cancelled) return;
        setCurrentUserId(user.id);

        const { data: teacherRecord } = await supabase
          .from("teachers")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle();
        const admin = (teacherRecord as { role?: string } | null)?.role === "admin";
        if (cancelled) return;
        setIsAdmin(admin);

        if (isEdit && studentId) {
          const { data: student, error: se } = await (supabase.from("students") as any).select("*").eq("id", studentId).single();
          if (se || !student) {
            Alert.alert("Error", "Could not load student.");
            navigation.goBack();
            return;
          }
          if (!admin && student.teacher_id !== user.id) {
            Alert.alert("Access denied", "You cannot edit this student.");
            navigation.goBack();
            return;
          }
          setName(student.name ?? "");
          setEmail(student.email ?? "");
          setCode(student.code ?? "");
          setTeacherId(student.teacher_id ?? "");
          setSelectedLessons(Array.isArray(student.assigned_lessons) ? student.assigned_lessons : []);
          setSelectedTests(Array.isArray(student.assigned_tests) ? student.assigned_tests : []);

          const tidForContent = admin ? student.teacher_id || user.id : user.id;
          const [tr, lr, ter] = await Promise.all([
            admin
              ? (supabase.from("teachers") as any).select("user_id, name").order("name")
              : Promise.resolve({ data: [] }),
            tidForContent
              ? supabase.from("lessons").select("id, title").eq("status", "published").eq("created_by", tidForContent).order("created_at", { ascending: false })
              : Promise.resolve({ data: [] }),
            tidForContent
              ? supabase.from("tests").select("id, name").eq("status", "published").eq("teacher_id", tidForContent).order("created_at", { ascending: false })
              : Promise.resolve({ data: [] }),
          ]);
          if (admin && tr.data) {
            setTeachers(
              (tr.data as { user_id: string; name: string }[]).map((x) => ({ id: x.user_id, name: x.name }))
            );
          }
          setAllLessons((lr.data as LessonOpt[]) || []);
          setAllTests((ter.data as TestOpt[]) || []);
        } else {
          if (admin) {
            const { data: tr } = await (supabase.from("teachers") as any).select("user_id, name").order("name");
            if (!cancelled && tr) {
              setTeachers((tr as { user_id: string; name: string }[]).map((x) => ({ id: x.user_id, name: x.name })));
            }
          }
          let generated = generateRandomCode();
          for (let i = 0; i < 10; i++) {
            const { count } = await supabase.from("students").select("*", { count: "exact", head: true }).eq("code", generated);
            if (!count) break;
            generated = generateRandomCode();
          }
          if (!cancelled) setCode(generated);
          setTeacherId(user.id);
          await loadListsForTeacher(user.id);
        }
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to load");
        navigation.goBack();
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, studentId, navigation, loadListsForTeacher]);

  const toggleLesson = (id: string) => {
    setSelectedLessons((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleTest = (id: string) => {
    setSelectedTests((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const copyCode = async () => {
    try {
      await Clipboard.setStringAsync(code);
      Alert.alert("Copied", "Access code copied.");
    } catch {
      Alert.alert("Error", "Could not copy.");
    }
  };

  const regenCode = async () => {
    if (isEdit) return;
    let generated = generateRandomCode();
    for (let i = 0; i < 10; i++) {
      const { count } = await supabase.from("students").select("*", { count: "exact", head: true }).eq("code", generated);
      if (!count) break;
      generated = generateRandomCode();
    }
    setCode(generated);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    if (!currentUserId) return;
    const finalTeacherId = isAdmin ? teacherId || null : currentUserId;
    if (isAdmin && !isEdit && !finalTeacherId) {
      Alert.alert("Validation", "Select a teacher.");
      return;
    }

    setSaving(true);
    try {
      if (isEdit && studentId) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          email: email.trim() || null,
          assigned_lessons: selectedLessons,
          assigned_tests: selectedTests,
        };
        if (isAdmin) payload.teacher_id = finalTeacherId;
        const { error } = await (supabase.from("students") as any).update(payload).eq("id", studentId);
        if (error) throw error;
        Alert.alert("Saved", "Student updated.");
      } else {
        const { error } = await (supabase.from("students") as any).insert({
          name: name.trim(),
          email: email.trim() || null,
          code: code.trim().toUpperCase(),
          teacher_id: finalTeacherId,
          assigned_lessons: selectedLessons,
          assigned_tests: selectedTests,
          progress: {},
          is_active: true,
        });
        if (error) throw error;
        Alert.alert("Created", "Student added.");
      }
      navigation.goBack();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
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

  if (bootLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const selectedTeacherLabel = teachers.find((t) => t.id === teacherId)?.name ?? "Select teacher…";

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 10,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: theme.isDark ? theme.colors.background : "#FFFFFF",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingVertical: 8, paddingRight: 12 }}>
          <Text style={{ color: theme.colors.primary, fontWeight: "800" }}>Back</Text>
        </TouchableOpacity>
        <Text style={[theme.typography.title, { flex: 1, textAlign: "center", fontSize: 17 }]}>
          {isEdit ? "Edit student" : "New student"}
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
      >
        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 8 }]}>Profile</Text>
          <Text style={[theme.typography.caption, { marginBottom: 4 }]}>Full name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Jane Smith" placeholderTextColor={theme.colors.textMuted} style={[inputStyle, { marginBottom: 12 }]} />
          <Text style={[theme.typography.caption, { marginBottom: 4 }]}>Email (optional)</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="email@example.com"
            placeholderTextColor={theme.colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            style={inputStyle}
          />
        </GlassCard>

        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 8 }]}>Access code</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ fontFamily: "monospace", fontSize: 22, fontWeight: "900", flex: 1, color: theme.colors.primary }}>{code}</Text>
            <TouchableOpacity onPress={copyCode} style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border }}>
              <Ionicons name="copy-outline" size={20} color={theme.colors.primary} />
            </TouchableOpacity>
            {!isEdit ? (
              <TouchableOpacity onPress={regenCode} style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border }}>
                <Ionicons name="refresh-outline" size={20} color={theme.colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
        </GlassCard>

        {isAdmin ? (
          <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
            <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 8 }]}>Teacher</Text>
            <TouchableOpacity
              onPress={() => {
                setTeacherSearch("");
                setTeacherModalOpen(true);
              }}
              style={[inputStyle, { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
            >
              <Text style={{ color: teacherId ? theme.colors.text : theme.colors.textMuted }}>{selectedTeacherLabel}</Text>
              <Ionicons name="chevron-down" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </GlassCard>
        ) : null}

        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={[theme.typography.caption, { textTransform: "uppercase" }]}>Lessons</Text>
            {contentLoading ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
          </View>
          <TextInput
            value={lessonSearch}
            onChangeText={setLessonSearch}
            placeholder="Search lessons…"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 10 }]}
          />
          {filteredLessons.map((l) => (
            <TouchableOpacity
              key={l.id}
              onPress={() => toggleLesson(l.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Ionicons
                name={selectedLessons.includes(l.id) ? "checkbox" : "square-outline"}
                size={22}
                color={theme.colors.primary}
              />
              <Text style={[theme.typography.body, { marginLeft: 10, flex: 1 }]} numberOfLines={2}>
                {l.title}
              </Text>
            </TouchableOpacity>
          ))}
        </GlassCard>

        <GlassCard style={{ borderRadius: 16, marginBottom: 24 }} padding={16}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={[theme.typography.caption, { textTransform: "uppercase" }]}>Tests</Text>
          </View>
          <TextInput
            value={testSearch}
            onChangeText={setTestSearch}
            placeholder="Search tests…"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 10 }]}
          />
          {filteredTests.map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => toggleTest(t.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Ionicons
                name={selectedTests.includes(t.id) ? "checkbox" : "square-outline"}
                size={22}
                color={theme.colors.primary}
              />
              <Text style={[theme.typography.body, { marginLeft: 10, flex: 1 }]} numberOfLines={2}>
                {t.name}
              </Text>
            </TouchableOpacity>
          ))}
        </GlassCard>

        <AppButton label={isEdit ? "Save changes" : "Create student"} onPress={handleSave} loading={saving} />
      </ScrollView>

      <Modal visible={teacherModalOpen} animationType="slide" transparent onRequestClose={() => setTeacherModalOpen(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}
          activeOpacity={1}
          onPress={() => setTeacherModalOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View
              style={{
                backgroundColor: theme.colors.surface,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                paddingBottom: insets.bottom + 16,
                maxHeight: "75%",
              }}
            >
              <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text style={theme.typography.title}>Assign teacher</Text>
                <TextInput
                  value={teacherSearch}
                  onChangeText={setTeacherSearch}
                  placeholder="Search…"
                  placeholderTextColor={theme.colors.textMuted}
                  style={[inputStyle, { marginTop: 12 }]}
                />
              </View>
              <ScrollView style={{ maxHeight: 400 }}>
                {filteredTeachers.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={async () => {
                      setTeacherId(t.id);
                      setSelectedLessons([]);
                      setSelectedTests([]);
                      await loadListsForTeacher(t.id);
                      setTeacherModalOpen(false);
                    }}
                    style={{ paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
                  >
                    <Text style={theme.typography.bodyStrong}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
