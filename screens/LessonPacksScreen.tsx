import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import GlassCard from "../components/GlassCard";
import AppButton from "../components/AppButton";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { coercePlanForRole } from "../lib/teacherRolePlanRules";
import {
  AccessType,
  ADVANCED_LEVELS,
  BEGINNER_LEVELS,
  CATEGORY_OPTIONS,
  CEFR_OPTIONS,
  getTeacherPackAction,
  INTERMEDIATE_LEVELS,
  LessonRow,
  PackCardType,
  PackLessonDetail,
  PackStatus,
  PACK_LANGUAGES,
  slugifyTitle,
  TeacherPackAction,
} from "../lib/lessonPacksHelpers";

type RootStackParamList = {
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  LessonPacks: undefined;
};

type LessonPackLessonRow = { pack_id: string; lesson_id: string; sort_order: number | null };
type LessonPackRow = {
  id: string;
  title: string;
  slug: string | null;
  description: string | null;
  category: string | null;
  cefr_level: string | null;
  access_type: AccessType | null;
  price_label: string | null;
  cover_image_url: string | null;
  is_featured: boolean | null;
  status: PackStatus | null;
  created_by: string | null;
  language: string | null;
  created_at?: string | null;
};

const apiBaseUrl =
  Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

const NEW_PACK_CEFR = ["A1", "A1–A2", "A2", "A2–B1", "B1", "B1–B2", "B2", "C1"];

const ACCESS_OPTIONS: AccessType[] = ["free", "included", "paid"];

function accessPillStyle(
  theme: ReturnType<typeof useAppTheme>,
  access: AccessType
): { bg: string; text: string; border: string } {
  if (access === "free")
    return { bg: theme.colors.successSoft, text: theme.colors.success, border: theme.colors.success };
  if (access === "included")
    return { bg: "rgba(14,165,233,0.12)", text: "#0284C7", border: "rgba(14,165,233,0.35)" };
  return { bg: theme.colors.violetSoft, text: theme.colors.violet, border: theme.colors.borderStrong };
}

async function uploadPackCoverFromUri(uri: string, mimeType?: string | null): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  if (blob.size > 2 * 1024 * 1024) throw new Error("Image must be under 2MB");
  const lower = uri.toLowerCase();
  const ext = lower.endsWith(".png") ? "png" : lower.endsWith(".webp") ? "webp" : lower.endsWith(".gif") ? "gif" : "jpg";
  const filePath = `pack-covers/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
  const { error } = await supabase.storage.from("lesson-assets").upload(filePath, blob, {
    contentType: mimeType || "image/jpeg",
  });
  if (error) throw error;
  const { data } = supabase.storage.from("lesson-assets").getPublicUrl(filePath);
  return data.publicUrl;
}

function Pill({
  children,
  colors,
}: {
  children: ReactNode;
  colors: { bg: string; text: string; border: string };
}) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: colors.bg,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: "800", color: colors.text, textTransform: "uppercase" }}>
        {children}
      </Text>
    </View>
  );
}

function CollapsibleSection({
  label,
  count,
  defaultOpen,
  theme,
  children,
}: {
  label: string;
  count: number;
  defaultOpen: boolean;
  theme: ReturnType<typeof useAppTheme>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={{ marginBottom: 20 }}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.85}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}
      >
        <Text style={[theme.typography.bodyStrong, { fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }]}>
          {label}
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor: theme.colors.primarySoft,
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>{count}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.textMuted} />
      </TouchableOpacity>
      {open ? children : null}
    </View>
  );
}

function LanguagePickerModal({
  visible,
  title,
  value,
  allowEmpty,
  onClose,
  onSelect,
  theme,
}: {
  visible: boolean;
  title: string;
  value: string;
  allowEmpty: boolean;
  onClose: () => void;
  onSelect: (lang: string) => void;
  theme: ReturnType<typeof useAppTheme>;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: 28,
              maxHeight: "70%",
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <Text style={theme.typography.title}>{title}</Text>
            </View>
            <FlatList
              data={allowEmpty ? ["", ...PACK_LANGUAGES] : PACK_LANGUAGES}
              keyExtractor={(item, i) => `${item}-${i}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                  style={{
                    paddingVertical: 14,
                    paddingHorizontal: 20,
                    backgroundColor: value === item ? theme.colors.primarySoft : "transparent",
                  }}
                >
                  <Text style={[theme.typography.body, item === "" ? { color: theme.colors.textMuted } : {}]}>
                    {item === "" ? "— None —" : item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

export default function LessonPacksScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] = useState("teacher");
  const [currentPlan, setCurrentPlan] = useState("Free");
  const [currentName, setCurrentName] = useState("Teacher");

  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [packs, setPacks] = useState<PackCardType[]>([]);
  const [packLessonMap, setPackLessonMap] = useState<Record<string, string[]>>({});

  const [query, setQuery] = useState("");
  const [filterAccess, setFilterAccess] = useState<"all" | AccessType>("all");
  const [filterCefr, setFilterCefr] = useState("all");
  const [filterLanguage, setFilterLanguage] = useState("all");
  const [editModal, setEditModal] = useState<PackCardType | null>(null);
  const [viewLessonsPack, setViewLessonsPack] = useState<PackCardType | null>(null);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [installingPackId, setInstallingPackId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const canManage = (currentRole ?? "").toLowerCase().trim() === "admin";

  const loadData = useCallback(async (showInitial: boolean) => {
    try {
      if (showInitial) setLoading(true);
      else setRefreshing(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not logged in");

      setCurrentUserId(user.id);

      const { data: me, error: meError } = await (supabase.from("teachers") as any)
        .select("user_id, role, name, plan")
        .eq("user_id", user.id)
        .single();
      if (meError) throw meError;

      const normalizedRole = (me?.role ?? "teacher") as string;
      const normalizedPlan = coercePlanForRole(me?.role ?? "teacher", me?.plan ?? "Free");
      setCurrentRole(normalizedRole);
      setCurrentPlan(normalizedPlan);
      setCurrentName(me?.name || "Teacher");

      let packsQuery = (supabase.from("lesson_packs") as any)
        .select(
          "id, title, slug, description, category, cefr_level, access_type, price_label, cover_image_url, is_featured, status, created_by, created_at, language"
        )
        .order("created_at", { ascending: false });

      if ((me?.role ?? "").toLowerCase().trim() !== "admin") {
        packsQuery = packsQuery.eq("status", "published");
      }

      const lessonsQuery = (supabase.from("lessons") as any)
        .select("id, title, status, grade_range, language_level, created_by")
        .order("created_at", { ascending: false });

      const [packsRes, lessonsRes, linksRes] = await Promise.all([
        packsQuery,
        lessonsQuery,
        (supabase.from("lesson_pack_lessons") as any)
          .select("pack_id, lesson_id, sort_order")
          .order("sort_order", { ascending: true }),
      ]);

      if (packsRes.error) throw packsRes.error;
      if (lessonsRes.error) throw lessonsRes.error;
      if (linksRes.error) throw linksRes.error;

      const lessonRows = (lessonsRes.data || []) as LessonRow[];
      const packRows = (packsRes.data || []) as LessonPackRow[];
      const linkRows = (linksRes.data || []) as LessonPackLessonRow[];

      const creatorIds = Array.from(
        new Set(packRows.map((r) => r.created_by).filter((id): id is string => Boolean(id)))
      );
      const creatorNameMap = new Map<string, string>();
      if (creatorIds.length > 0) {
        const { data: creatorRows } = await (supabase.from("teachers") as any)
          .select("user_id, name")
          .in("user_id", creatorIds);
        ((creatorRows || []) as { user_id: string; name: string | null }[]).forEach((t) => {
          creatorNameMap.set(t.user_id, t.name || "Unknown");
        });
      }

      const nextPackLessonMap: Record<string, string[]> = {};
      for (const row of linkRows) {
        if (!nextPackLessonMap[row.pack_id]) nextPackLessonMap[row.pack_id] = [];
        nextPackLessonMap[row.pack_id].push(row.lesson_id);
      }

      const nextPacks: PackCardType[] = packRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
        lessonCount: nextPackLessonMap[row.id]?.length || 0,
        cefrLevel: row.cefr_level || "",
        creator: creatorNameMap.get(row.created_by || "") || "Unknown",
        accessType: (row.access_type || "free") as AccessType,
        priceLabel: row.price_label || null,
        coverImageUrl: row.cover_image_url || null,
        isFeatured: !!row.is_featured,
        category: row.category || "",
        language: row.language || "",
        status: (row.status || "draft") as PackStatus,
      }));

      setLessons(lessonRows);
      setPacks(nextPacks);
      setPackLessonMap(nextPackLessonMap);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load packs";
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const filteredPacks = useMemo(() => {
    return packs
      .filter(
        (pack) =>
          (filterAccess === "all" || pack.accessType === filterAccess) &&
          (filterCefr === "all" || pack.cefrLevel === filterCefr) &&
          (filterLanguage === "all" || pack.language === filterLanguage) &&
          (pack.title.toLowerCase().includes(query.toLowerCase()) ||
            pack.description.toLowerCase().includes(query.toLowerCase()) ||
            pack.creator.toLowerCase().includes(query.toLowerCase()))
      )
      .sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
  }, [packs, query, filterAccess, filterCefr, filterLanguage]);

  const lessonDetailMap = useMemo(() => new Map(lessons.map((l) => [l.id, l])), [lessons]);

  const featuredPacks = useMemo(() => filteredPacks.filter((p) => p.isFeatured), [filteredPacks]);
  const beginnerPacks = useMemo(
    () => filteredPacks.filter((p) => !p.isFeatured && BEGINNER_LEVELS.has(p.cefrLevel)),
    [filteredPacks]
  );
  const intermediatePacks = useMemo(
    () => filteredPacks.filter((p) => !p.isFeatured && INTERMEDIATE_LEVELS.has(p.cefrLevel)),
    [filteredPacks]
  );
  const advancedPacks = useMemo(
    () => filteredPacks.filter((p) => !p.isFeatured && ADVANCED_LEVELS.has(p.cefrLevel)),
    [filteredPacks]
  );
  const otherPacks = useMemo(
    () =>
      filteredPacks.filter(
        (p) =>
          !p.isFeatured &&
          !BEGINNER_LEVELS.has(p.cefrLevel) &&
          !INTERMEDIATE_LEVELS.has(p.cefrLevel) &&
          !ADVANCED_LEVELS.has(p.cefrLevel)
      ),
    [filteredPacks]
  );

  const myLessonTitles = useMemo(() => {
    return new Set(
      lessons.filter((l) => l.created_by === currentUserId).map((l) => l.title.toLowerCase().trim())
    );
  }, [lessons, currentUserId]);

  const addedPackIds = useMemo(() => {
    const result = new Set<string>();
    for (const pack of packs) {
      const lessonIds = packLessonMap[pack.id] || [];
      if (lessonIds.length === 0) continue;
      const packTitles = lessonIds
        .map((id) => lessonDetailMap.get(id)?.title.toLowerCase().trim())
        .filter((t): t is string => Boolean(t));
      if (packTitles.length > 0 && packTitles.every((t) => myLessonTitles.has(t))) {
        result.add(pack.id);
      }
    }
    return result;
  }, [packs, packLessonMap, lessonDetailMap, myLessonTitles]);

  const availableCefrLevels = useMemo(
    () => Array.from(new Set(packs.map((p) => p.cefrLevel).filter(Boolean))).sort(),
    [packs]
  );
  const availableLanguages = useMemo(
    () => Array.from(new Set(packs.map((p) => p.language).filter(Boolean))).sort(),
    [packs]
  );

  const getLessonsForPack = (packId: string): PackLessonDetail[] => {
    const lessonIds = packLessonMap[packId] || [];
    return lessonIds
      .map((id) => {
        const l = lessonDetailMap.get(id);
        if (!l) return null;
        return {
          id: l.id,
          title: l.title,
          level: l.language_level ?? null,
          gradeRange: l.grade_range ?? null,
          status: l.status,
        };
      })
      .filter((x): x is PackLessonDetail => x !== null);
  };

  const duplicatePackLessonsToTeacher = async (pack: PackCardType) => {
    if (!currentUserId) {
      Alert.alert("Error", "Missing current user");
      return;
    }
    const lessonIds = packLessonMap[pack.id] || [];
    if (lessonIds.length === 0) {
      Alert.alert("Error", "This pack has no lessons");
      return;
    }
    setInstallingPackId(pack.id);
    try {
      const { data: originalLessons, error: lessonsError } = await (supabase.from("lessons") as any)
        .select("*")
        .in("id", lessonIds);
      if (lessonsError) throw lessonsError;
      if (!originalLessons || originalLessons.length === 0) throw new Error("No lessons found to duplicate");

      const sortIndex = new Map(lessonIds.map((id, index) => [id, index]));
      const orderedLessons = [...originalLessons].sort(
        (a: { id: string }, b: { id: string }) => (sortIndex.get(a.id) ?? 0) - (sortIndex.get(b.id) ?? 0)
      );

      const clonedRows = orderedLessons.map((lesson: Record<string, unknown>) => {
        const { id: _id, slug: _slug, teacher_id: _tid, created_at: _ca, updated_at: _ua, deleted_at: _da, ...rest } =
          lesson as Record<string, unknown> & { id: string; slug?: string };
        const titleStr = (lesson.title as string) ?? "Lesson";
        const baseSlug = slugifyTitle(titleStr) || "lesson-copy";
        const uniqueSlug = `${baseSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return {
          ...rest,
          title: titleStr,
          slug: uniqueSlug,
          teacher_id: currentUserId,
          created_by: currentUserId,
          updated_by: currentUserId,
          status: "published",
        };
      });

      const { data: insertedLessons, error: insertError } = await (supabase.from("lessons") as any)
        .insert(clonedRows)
        .select("id");
      if (insertError) throw insertError;

      if (insertedLessons && insertedLessons.length > 0) {
        const packLessonRows = insertedLessons.map((l: { id: string }) => ({
          pack_id: pack.id,
          lesson_id: l.id,
        }));
        const { error: linkError } = await (supabase.from("lesson_pack_lessons") as any).insert(packLessonRows);
        if (linkError) console.warn("Failed to link lessons to pack:", linkError);
      }

      await loadData(false);
      const count = insertedLessons?.length || clonedRows.length;
      Alert.alert(
        "Added to your library",
        `${count} lesson${count === 1 ? "" : "s"} copied from this pack. Open Lessons on the web to edit them.`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add lessons";
      Alert.alert("Error", msg);
    } finally {
      setInstallingPackId(null);
    }
  };

  const handleTeacherAction = async (pack: PackCardType, action: TeacherPackAction) => {
    if (action.kind === "upgrade") {
      const ok = await Linking.canOpenURL(action.href);
      if (ok) await Linking.openURL(action.href);
      else Alert.alert("Subscription", "Open your account on the web to manage your plan.");
      return;
    }
    if (action.kind === "checkout") {
      Alert.alert(
        "Paid packs",
        "Paid packs are coming soon. Contact support@eluency.com for early access."
      );
      return;
    }
    if (action.kind === "disabled") {
      Alert.alert("Unavailable", "This pack is unavailable for your account.");
      return;
    }
    await duplicatePackLessonsToTeacher(pack);
  };

  const clearFilters = () => {
    setFilterAccess("all");
    setFilterCefr("all");
    setFilterLanguage("all");
    setQuery("");
  };

  const winW = Dimensions.get("window").width;
  /** RN flexWrap+gap+fixed width is unreliable; real grid = two flex:1 columns. */
  const GRID_COLUMN_GAP = 10;
  const LIST_THUMB_SIZE = 56;

  const renderPackCard = (pack: PackCardType) => {
    const action = getTeacherPackAction(pack.accessType, currentRole, currentPlan, apiBaseUrl);
    const isAdded = addedPackIds.has(pack.id);
    const installing = installingPackId === pack.id;
    const acc = accessPillStyle(theme, pack.accessType);

    return (
      <View
        key={`grid-${pack.id}`}
        style={{
          width: "100%",
          marginBottom: 12,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: 120,
            backgroundColor: pack.isFeatured ? "rgba(251,191,36,0.2)" : theme.colors.surfaceGlass,
            alignItems: "center",
            justifyContent: "center",
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          {pack.coverImageUrl ? (
            <Image
              key={pack.coverImageUrl}
              source={{ uri: pack.coverImageUrl }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="contain"
            />
          ) : (
            <Ionicons name="layers-outline" size={36} color={theme.colors.textMuted} style={{ opacity: 0.35 }} />
          )}
          {pack.isFeatured ? (
            <View style={{ position: "absolute", top: 8, left: 8 }}>
              <Pill colors={{ bg: "rgba(245,158,11,0.95)", text: "#fff", border: "#D97706" }}>Featured</Pill>
            </View>
          ) : null}
          <View style={{ position: "absolute", top: 8, right: 8 }}>
            <Pill colors={acc}>
              {pack.accessType}
              {pack.priceLabel ? ` ${pack.priceLabel}` : ""}
            </Pill>
          </View>
          {isAdded && !canManage ? (
            <View style={{ position: "absolute", bottom: 8, right: 8 }}>
              <Pill colors={{ bg: theme.colors.successSoft, text: theme.colors.success, border: theme.colors.success }}>
                Added
              </Pill>
            </View>
          ) : null}
        </View>
        <View style={{ padding: 10 }}>
          <Text style={[theme.typography.bodyStrong, { fontSize: 14 }]} numberOfLines={2}>
            {pack.title}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            <Pill
              colors={
                pack.lessonCount === 0
                  ? { bg: "rgba(249,115,22,0.15)", text: "#EA580C", border: "rgba(249,115,22,0.35)" }
                  : { bg: "rgba(14,165,233,0.12)", text: "#0284C7", border: "rgba(14,165,233,0.35)" }
              }
            >
              {pack.lessonCount} lessons
            </Pill>
            {pack.cefrLevel ? (
              <Pill colors={{ bg: "rgba(14,165,233,0.12)", text: "#0284C7", border: "rgba(14,165,233,0.35)" }}>
                {pack.cefrLevel}
              </Pill>
            ) : null}
          </View>
          <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]} numberOfLines={1}>
            {pack.creator}
            {pack.language ? ` · ${pack.language}` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TouchableOpacity
              onPress={() => setViewLessonsPack(pack)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "800" }}>VIEW</Text>
            </TouchableOpacity>
            {canManage ? (
              <TouchableOpacity
                onPress={() => setEditModal(pack)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800" }}>EDIT</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => handleTeacherAction(pack, action)}
                disabled={installing || action.kind === "disabled"}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor:
                    action.kind === "add"
                      ? theme.colors.primary
                      : action.kind === "upgrade"
                        ? "#0284C7"
                        : action.kind === "checkout"
                          ? "#7C3AED"
                          : theme.colors.border,
                  opacity: installing || action.kind === "disabled" ? 0.5 : 1,
                }}
              >
                {installing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ fontSize: 10, fontWeight: "800", color: "#fff" }} numberOfLines={2}>
                    {action.label}
                    {action.kind === "checkout" && pack.priceLabel ? ` · ${pack.priceLabel}` : ""}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderTwoColumnPackGrid = (packs: PackCardType[]) => {
    const left = packs.filter((_, i) => i % 2 === 0);
    const right = packs.filter((_, i) => i % 2 === 1);
    const half = GRID_COLUMN_GAP / 2;
    return (
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0, paddingRight: half }}>
          {left.map((p) => renderPackCard(p))}
        </View>
        <View style={{ flex: 1, minWidth: 0, paddingLeft: half }}>
          {right.map((p) => renderPackCard(p))}
        </View>
      </View>
    );
  };

  const renderPackSections = () => (
    <View>
      {featuredPacks.length > 0 ? (
        <View style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Ionicons name="star" size={16} color="#D97706" />
            <Text style={[theme.typography.bodyStrong, { fontSize: 13, color: "#D97706", textTransform: "uppercase" }]}>
              Featured
            </Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.colors.primarySoft }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>{featuredPacks.length}</Text>
            </View>
          </View>
          {renderTwoColumnPackGrid(featuredPacks)}
        </View>
      ) : null}

      <CollapsibleSection label="Beginner" count={beginnerPacks.length} defaultOpen={beginnerPacks.length > 0} theme={theme}>
        {renderTwoColumnPackGrid(beginnerPacks)}
      </CollapsibleSection>
      <CollapsibleSection
        label="Intermediate"
        count={intermediatePacks.length}
        defaultOpen={intermediatePacks.length > 0}
        theme={theme}
      >
        {renderTwoColumnPackGrid(intermediatePacks)}
      </CollapsibleSection>
      <CollapsibleSection label="Advanced" count={advancedPacks.length} defaultOpen={advancedPacks.length > 0} theme={theme}>
        {renderTwoColumnPackGrid(advancedPacks)}
      </CollapsibleSection>
      {otherPacks.length > 0 ? (
        <CollapsibleSection label="Other" count={otherPacks.length} defaultOpen theme={theme}>
          {renderTwoColumnPackGrid(otherPacks)}
        </CollapsibleSection>
      ) : null}
    </View>
  );

  const renderListPackRow = (pack: PackCardType) => {
    const action = getTeacherPackAction(pack.accessType, currentRole, currentPlan, apiBaseUrl);
    const isAdded = addedPackIds.has(pack.id);
    const installing = installingPackId === pack.id;
    const acc = accessPillStyle(theme, pack.accessType);
    const thumb = LIST_THUMB_SIZE;
    return (
      <View
        key={`list-${pack.id}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 10,
          paddingHorizontal: 12,
          marginBottom: 10,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surfaceAlt,
        }}
      >
        <View
          style={{
            width: thumb,
            height: thumb,
            borderRadius: 12,
            overflow: "hidden",
            marginRight: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pack.isFeatured ? "rgba(251,191,36,0.2)" : theme.colors.surfaceGlass,
          }}
        >
          {pack.coverImageUrl ? (
            <Image
              key={`${pack.id}-thumb-${pack.coverImageUrl}`}
              source={{ uri: pack.coverImageUrl }}
              style={{ width: thumb, height: thumb }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: thumb,
                height: thumb,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="layers-outline" size={22} color={theme.colors.textMuted} />
            </View>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, marginRight: 8, justifyContent: "center" }}>
          <Text style={[theme.typography.bodyStrong, { fontSize: 14 }]} numberOfLines={2}>
            {pack.title}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6, marginHorizontal: -3 }}>
            {pack.isFeatured ? (
              <View style={{ marginHorizontal: 3, marginBottom: 4 }}>
                <Pill colors={{ bg: "rgba(245,158,11,0.2)", text: "#D97706", border: "#F59E0B" }}>Featured</Pill>
              </View>
            ) : null}
            {isAdded && !canManage ? (
              <View style={{ marginHorizontal: 3, marginBottom: 4 }}>
                <Pill colors={{ bg: theme.colors.successSoft, text: theme.colors.success, border: theme.colors.success }}>
                  Added
                </Pill>
              </View>
            ) : null}
            <View style={{ marginHorizontal: 3, marginBottom: 4 }}>
              <Pill colors={acc}>{pack.accessType}</Pill>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", flexShrink: 0, alignItems: "center" }}>
          <TouchableOpacity
            onPress={() => setViewLessonsPack(pack)}
            style={{
              padding: 10,
              marginRight: 6,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Ionicons name="list-outline" size={18} color={theme.colors.primary} />
          </TouchableOpacity>
          {canManage ? (
            <TouchableOpacity
              onPress={() => setEditModal(pack)}
              style={{
                padding: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Ionicons name="settings-outline" size={18} color={theme.colors.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => handleTeacherAction(pack, action)}
              disabled={installing || action.kind === "disabled"}
              style={{
                maxWidth: 112,
                paddingHorizontal: 10,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: theme.colors.primary,
                opacity: installing || action.kind === "disabled" ? 0.45 : 1,
              }}
            >
              {installing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ fontSize: 9, fontWeight: "800", color: "#fff", textAlign: "center" }} numberOfLines={3}>
                  {action.label}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderPackSectionsList = () => (
    <View>
      {featuredPacks.length > 0 ? (
        <View style={{ marginBottom: 20 }}>
          <Text style={[theme.typography.bodyStrong, { marginBottom: 10, textTransform: "uppercase", fontSize: 12 }]}>
            Featured · {featuredPacks.length}
          </Text>
          {featuredPacks.map((p) => renderListPackRow(p))}
        </View>
      ) : null}
      <CollapsibleSection label="Beginner" count={beginnerPacks.length} defaultOpen={beginnerPacks.length > 0} theme={theme}>
        <View>{beginnerPacks.map((p) => renderListPackRow(p))}</View>
      </CollapsibleSection>
      <CollapsibleSection
        label="Intermediate"
        count={intermediatePacks.length}
        defaultOpen={intermediatePacks.length > 0}
        theme={theme}
      >
        <View>{intermediatePacks.map((p) => renderListPackRow(p))}</View>
      </CollapsibleSection>
      <CollapsibleSection label="Advanced" count={advancedPacks.length} defaultOpen={advancedPacks.length > 0} theme={theme}>
        <View>{advancedPacks.map((p) => renderListPackRow(p))}</View>
      </CollapsibleSection>
      {otherPacks.length > 0 ? (
        <CollapsibleSection label="Other" count={otherPacks.length} defaultOpen theme={theme}>
          <View>{otherPacks.map((p) => renderListPackRow(p))}</View>
        </CollapsibleSection>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={[theme.typography.body, { marginTop: 12 }]}>Loading packs…</Text>
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
          <Text style={theme.typography.label}>Library</Text>
          <Text style={[theme.typography.title, { marginTop: 2, fontSize: 18, lineHeight: 22 }]}>Lesson Packs</Text>
        </View>
        {canManage ? (
          <TouchableOpacity
            onPress={() => setNewModalOpen(true)}
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
        {refreshing ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={theme.typography.caption}>Refreshing…</Text>
          </View>
        ) : null}

        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <Text style={[theme.typography.title, { fontSize: 22 }]}>Lesson Packs</Text>
          <Text style={[theme.typography.body, { marginTop: 8, color: theme.colors.textMuted }]}>
            {canManage
              ? `Welcome back, ${currentName}. You can create and manage all packs.`
              : `Welcome back, ${currentName}. Browse published packs and add those available on your plan.`}
          </Text>
          {!canManage ? (
            <View style={{ marginTop: 10 }}>
              <Pill colors={accessPillStyle(theme, "included")}>Plan: {currentPlan}</Pill>
            </View>
          ) : null}
          <TouchableOpacity onPress={() => loadData(false)} style={{ marginTop: 14, alignSelf: "flex-start" }}>
            <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>Refresh</Text>
          </TouchableOpacity>
        </GlassCard>

        <GlassCard style={{ borderRadius: 16 }} padding={16}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <Text style={[theme.typography.title, { fontSize: 18 }]}>Available packs</Text>
            <View style={{ flexDirection: "row", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12 }}>
              <TouchableOpacity
                onPress={() => setViewMode("grid")}
                style={{
                  padding: 8,
                  borderRadius: 10,
                  backgroundColor: viewMode === "grid" ? theme.colors.primary : "transparent",
                }}
              >
                <Ionicons name="grid-outline" size={18} color={viewMode === "grid" ? "#fff" : theme.colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setViewMode("list")}
                style={{
                  padding: 8,
                  borderRadius: 10,
                  backgroundColor: viewMode === "list" ? theme.colors.primary : "transparent",
                }}
              >
                <Ionicons name="list-outline" size={18} color={viewMode === "list" ? "#fff" : theme.colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <Text style={[theme.typography.caption, { marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }]}>
            What language are you teaching?
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <TouchableOpacity
              onPress={() => setFilterLanguage("all")}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 10,
                marginRight: 8,
                borderWidth: 1,
                borderColor: filterLanguage === "all" ? theme.colors.primary : theme.colors.border,
                backgroundColor: filterLanguage === "all" ? theme.colors.primarySoft : theme.colors.surfaceAlt,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 12 }}>All</Text>
            </TouchableOpacity>
            {availableLanguages.map((lang) => (
              <TouchableOpacity
                key={lang}
                onPress={() => setFilterLanguage(lang)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 10,
                  marginRight: 8,
                  borderWidth: 1,
                  borderColor: filterLanguage === lang ? theme.colors.primary : theme.colors.border,
                  backgroundColor: filterLanguage === lang ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontWeight: "700", fontSize: 12 }}>{lang}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search packs, descriptions, creators…"
            placeholderTextColor={theme.colors.textMuted}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              marginBottom: 12,
              color: theme.colors.text,
              backgroundColor: theme.colors.surfaceAlt,
            }}
          />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {(["all", "free", "included", "paid"] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => setFilterAccess(v)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: filterAccess === v ? theme.colors.primary : theme.colors.border,
                  backgroundColor: filterAccess === v ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "800" }}>{v === "all" ? "ALL ACCESS" : v.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
            {availableCefrLevels.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxWidth: winW - 80 }}>
                <TouchableOpacity
                  onPress={() => setFilterCefr("all")}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    marginRight: 8,
                    borderWidth: 1,
                    borderColor: filterCefr === "all" ? theme.colors.primary : theme.colors.border,
                    backgroundColor: filterCefr === "all" ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: "800" }}>ALL LEVELS</Text>
                </TouchableOpacity>
                {availableCefrLevels.map((lv) => (
                  <TouchableOpacity
                    key={lv}
                    onPress={() => setFilterCefr(lv)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      marginRight: 8,
                      borderWidth: 1,
                      borderColor: filterCefr === lv ? theme.colors.primary : theme.colors.border,
                      backgroundColor: filterCefr === lv ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: "800" }}>{lv}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
          </View>

          {(filterAccess !== "all" || filterCefr !== "all" || filterLanguage !== "all" || query.length > 0) && (
            <TouchableOpacity onPress={clearFilters} style={{ marginBottom: 16 }}>
              <Text style={{ color: theme.colors.danger, fontWeight: "700", fontSize: 12 }}>Clear filters</Text>
            </TouchableOpacity>
          )}

          {filteredPacks.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <Ionicons name="layers-outline" size={48} color={theme.colors.textMuted} style={{ opacity: 0.25 }} />
              <Text style={[theme.typography.caption, { marginTop: 12, textTransform: "uppercase" }]}>
                {packs.length === 0 ? "No packs yet" : "No packs match your filters"}
              </Text>
              {packs.length === 0 && canManage ? (
                <View style={{ marginTop: 16, alignSelf: "stretch" }}>
                  <AppButton label="Create first pack" onPress={() => setNewModalOpen(true)} />
                </View>
              ) : null}
              {packs.length > 0 ? (
                <TouchableOpacity onPress={clearFilters} style={{ marginTop: 12 }}>
                  <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>Clear filters</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <View key={viewMode} collapsable={false} style={{ width: "100%" }}>
              {viewMode === "grid" ? renderPackSections() : renderPackSectionsList()}
            </View>
          )}
        </GlassCard>
      </ScrollView>

      <ViewLessonsModal
        visible={!!viewLessonsPack}
        pack={viewLessonsPack}
        lessons={viewLessonsPack ? getLessonsForPack(viewLessonsPack.id) : []}
        onClose={() => setViewLessonsPack(null)}
        theme={theme}
      />

      {editModal && currentUserId && canManage ? (
        <EditPackModal
          pack={editModal}
          lessons={lessons}
          initialLessonIds={packLessonMap[editModal.id] || []}
          currentUserId={currentUserId}
          onClose={() => setEditModal(null)}
          onSaved={() => loadData(false)}
          theme={theme}
        />
      ) : null}

      {newModalOpen && currentUserId && canManage ? (
        <NewPackModal
          lessons={lessons}
          currentUserId={currentUserId}
          onClose={() => setNewModalOpen(false)}
          onSaved={() => loadData(false)}
          theme={theme}
        />
      ) : null}
    </View>
  );
}

function ViewLessonsModal({
  visible,
  pack,
  lessons,
  onClose,
  theme,
}: {
  visible: boolean;
  pack: PackCardType | null;
  lessons: PackLessonDetail[];
  onClose: () => void;
  theme: ReturnType<typeof useAppTheme>;
}) {
  if (!pack) return null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: 48 }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 12 }}>
          <TouchableOpacity onPress={onClose} style={{ padding: 8 }}>
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={theme.typography.caption}>Pack lessons</Text>
            <Text style={theme.typography.title}>{pack.title}</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {lessons.length === 0 ? (
            <Text style={[theme.typography.body, { color: theme.colors.textMuted }]}>No lessons in this pack.</Text>
          ) : (
            lessons.map((lesson, index) => (
              <View
                key={lesson.id}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  padding: 14,
                  marginBottom: 10,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surfaceAlt,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: theme.colors.primary }}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={theme.typography.bodyStrong}>{lesson.title}</Text>
                  {lesson.level || lesson.gradeRange ? (
                    <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                      {[lesson.level, lesson.gradeRange].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function EditPackModal({
  pack,
  lessons,
  initialLessonIds,
  currentUserId,
  onClose,
  onSaved,
  theme,
}: {
  pack: PackCardType;
  lessons: LessonRow[];
  initialLessonIds: string[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  theme: ReturnType<typeof useAppTheme>;
}) {
  const [title, setTitle] = useState(pack.title);
  const [description, setDescription] = useState(pack.description || "");
  const [cefrLevel, setCefrLevel] = useState(pack.cefrLevel || "");
  const [accessType, setAccessType] = useState<AccessType>(pack.accessType);
  const [priceLabel, setPriceLabel] = useState(pack.priceLabel || "");
  const [isFeatured, setIsFeatured] = useState(pack.isFeatured);
  const [status, setStatus] = useState<PackStatus>(pack.status);
  const [coverImageUrl, setCoverImageUrl] = useState(pack.coverImageUrl || "");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialLessonIds));
  const [lessonQuery, setLessonQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [language, setLanguage] = useState(pack.language || "");
  const [langModal, setLangModal] = useState(false);

  const levels = useMemo(() => {
    const unique = Array.from(
      new Set(lessons.map((l) => l.language_level).filter((v): v is string => Boolean(v)))
    );
    return ["all", ...unique];
  }, [lessons]);

  const filteredLessons = useMemo(() => {
    return lessons.filter(
      (l) =>
        l.title.toLowerCase().includes(lessonQuery.toLowerCase()) &&
        (level === "all" || l.language_level === level)
    );
  }, [lessons, lessonQuery, level]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission", "Allow photo library access to upload a cover.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize != null && asset.fileSize > 2 * 1024 * 1024) {
      Alert.alert("Too large", "Image must be under 2MB");
      return;
    }
    setCoverUploading(true);
    try {
      const url = await uploadPackCoverFromUri(asset.uri, asset.mimeType);
      setCoverImageUrl(url);
    } catch (e: unknown) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCoverUploading(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert("Validation", "Pack title is required");
      return;
    }
    setSaving(true);
    try {
      const slug = slugifyTitle(title.trim()) || null;
      const { error: updateError } = await (supabase.from("lesson_packs") as any)
        .update({
          title: title.trim(),
          slug,
          description: description.trim() || null,
          cefr_level: cefrLevel || null,
          access_type: accessType,
          price_label: accessType === "paid" ? priceLabel.trim() || null : null,
          is_featured: isFeatured,
          status,
          cover_image_url: coverImageUrl.trim() || null,
          language: language || null,
          updated_by: currentUserId,
        })
        .eq("id", pack.id);
      if (updateError) throw updateError;

      const orderedLessonIds = Array.from(selected);
      const { error: deleteLinksError } = await (supabase.from("lesson_pack_lessons") as any)
        .delete()
        .eq("pack_id", pack.id);
      if (deleteLinksError) throw deleteLinksError;

      if (orderedLessonIds.length > 0) {
        const rows = orderedLessonIds.map((lessonId, index) => ({
          pack_id: pack.id,
          lesson_id: lessonId,
          sort_order: index,
        }));
        const { error: insertError } = await (supabase.from("lesson_pack_lessons") as any).insert(rows);
        if (insertError) throw insertError;
      }

      await onSaved();
      Alert.alert("Saved", "Pack updated.");
      onClose();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to update pack");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error: deleteLinksError } = await (supabase.from("lesson_pack_lessons") as any)
        .delete()
        .eq("pack_id", pack.id);
      if (deleteLinksError) throw deleteLinksError;
      const { error: deletePackError } = await (supabase.from("lesson_packs") as any).delete().eq("id", pack.id);
      if (deletePackError) throw deletePackError;
      await onSaved();
      Alert.alert("Deleted", "Pack removed.");
      onClose();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to delete pack");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 48,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>Close</Text>
          </TouchableOpacity>
          <Text style={[theme.typography.title, { flex: 1, textAlign: "center" }]}>Edit pack</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          <Text style={theme.typography.caption}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              padding: 12,
              marginTop: 6,
              marginBottom: 14,
              color: theme.colors.text,
            }}
          />
          <Text style={theme.typography.caption}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              padding: 12,
              marginTop: 6,
              marginBottom: 14,
              minHeight: 80,
              color: theme.colors.text,
            }}
          />
          <Text style={theme.typography.caption}>Language</Text>
          <TouchableOpacity
            onPress={() => setLangModal(true)}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              padding: 14,
              marginTop: 6,
              marginBottom: 14,
            }}
          >
            <Text>{language || "Select language…"}</Text>
          </TouchableOpacity>
          <LanguagePickerModal
            visible={langModal}
            title="Pack language"
            value={language}
            allowEmpty
            onClose={() => setLangModal(false)}
            onSelect={setLanguage}
            theme={theme}
          />

          <Text style={theme.typography.caption}>CEFR</Text>
          <ScrollView horizontal style={{ marginTop: 8, marginBottom: 14 }} showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              onPress={() => setCefrLevel("")}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginRight: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: cefrLevel === "" ? theme.colors.primary : theme.colors.border,
                backgroundColor: cefrLevel === "" ? theme.colors.primarySoft : theme.colors.surfaceAlt,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700" }}>None</Text>
            </TouchableOpacity>
            {CEFR_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o}
                onPress={() => setCefrLevel(o)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  marginRight: 8,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: cefrLevel === o ? theme.colors.primary : theme.colors.border,
                  backgroundColor: cefrLevel === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "700" }}>{o}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={theme.typography.caption}>Status</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 14 }}>
            {(["draft", "published"] as PackStatus[]).map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => setStatus(s)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: status === s ? theme.colors.primary : theme.colors.border,
                  backgroundColor: status === s ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontWeight: "800", textAlign: "center", textTransform: "uppercase", fontSize: 11 }}>
                  {s}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={theme.typography.caption}>Access</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 14 }}>
            {ACCESS_OPTIONS.map((o) => (
              <TouchableOpacity
                key={o}
                onPress={() => setAccessType(o)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: accessType === o ? theme.colors.primary : theme.colors.border,
                  backgroundColor: accessType === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontWeight: "800", fontSize: 11, textTransform: "uppercase" }}>{o}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {accessType === "paid" ? (
            <>
              <Text style={theme.typography.caption}>Price label</Text>
              <TextInput
                value={priceLabel}
                onChangeText={setPriceLabel}
                placeholder="$4.99"
                placeholderTextColor={theme.colors.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 6,
                  marginBottom: 14,
                  maxWidth: 200,
                  color: theme.colors.text,
                }}
              />
            </>
          ) : null}

          <TouchableOpacity
            onPress={() => setIsFeatured((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}
          >
            <Ionicons name={isFeatured ? "checkbox" : "square-outline"} size={24} color={theme.colors.primary} />
            <Text style={theme.typography.bodyStrong}>Featured</Text>
          </TouchableOpacity>

          <Text style={theme.typography.caption}>Cover</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 8 }}>
            <TouchableOpacity
              onPress={pickCover}
              disabled={coverUploading || saving}
              style={{
                width: 88,
                height: 88,
                borderRadius: 16,
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: theme.colors.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {coverUploading ? (
                <ActivityIndicator />
              ) : coverImageUrl ? (
                <Image source={{ uri: coverImageUrl }} style={{ width: "100%", height: "100%", borderRadius: 14 }} />
              ) : (
                <Ionicons name="image-outline" size={28} color={theme.colors.textMuted} />
              )}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <TextInput
                value={coverImageUrl}
                onChangeText={setCoverImageUrl}
                placeholder="Image URL"
                placeholderTextColor={theme.colors.textMuted}
                style={{
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 12,
                  padding: 10,
                  color: theme.colors.text,
                }}
              />
            </View>
          </View>

          <Text style={theme.typography.caption}>Lessons in pack</Text>
          <TextInput
            value={lessonQuery}
            onChangeText={setLessonQuery}
            placeholder="Search lessons…"
            placeholderTextColor={theme.colors.textMuted}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 12,
              padding: 12,
              marginTop: 8,
              marginBottom: 8,
              color: theme.colors.text,
            }}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {levels.map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setLevel(value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  marginRight: 8,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: level === value ? theme.colors.primary : theme.colors.border,
                  backgroundColor: level === value ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: "800" }}>{value === "all" ? "ALL" : value}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {filteredLessons.map((lesson) => (
            <TouchableOpacity
              key={lesson.id}
              onPress={() => toggle(lesson.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 12,
                marginBottom: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: selected.has(lesson.id) ? theme.colors.primary : theme.colors.border,
                backgroundColor: selected.has(lesson.id) ? theme.colors.primarySoft : theme.colors.surfaceAlt,
              }}
            >
              <Ionicons
                name={selected.has(lesson.id) ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={theme.colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={theme.typography.bodyStrong}>{lesson.title}</Text>
                {lesson.language_level ? (
                  <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{lesson.language_level}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))}

          {confirmDelete ? (
            <View style={{ marginTop: 20, gap: 12 }}>
              <Text style={{ color: theme.colors.danger, fontWeight: "700" }}>Delete this pack forever?</Text>
              <AppButton label="Confirm delete" onPress={handleDelete} loading={deleting} />
              <TouchableOpacity onPress={() => setConfirmDelete(false)}>
                <Text style={{ textAlign: "center", color: theme.colors.primary }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setConfirmDelete(true)} style={{ marginTop: 20 }}>
              <Text style={{ color: theme.colors.danger, fontWeight: "800" }}>Delete pack</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: 16,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.background,
          }}
        >
          <AppButton label="Save changes" onPress={handleSave} loading={saving} disabled={!title.trim()} />
        </View>
      </View>
    </Modal>
  );
}

function NewPackModal({
  lessons,
  currentUserId,
  onClose,
  onSaved,
  theme,
}: {
  lessons: LessonRow[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  theme: ReturnType<typeof useAppTheme>;
}) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [cefrLevel, setCefrLevel] = useState("A1–A2");
  const [category, setCategory] = useState("General");
  const [accessType, setAccessType] = useState<AccessType>("free");
  const [priceLabel, setPriceLabel] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [coverUploading, setCoverUploading] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [language, setLanguage] = useState("");
  const [status, setStatus] = useState<PackStatus>("published");
  const [lessonQuery, setLessonQuery] = useState("");
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(new Set());
  const [langModal, setLangModal] = useState(false);

  const filteredLessons = useMemo(() => {
    return lessons.filter((l) => l.title.toLowerCase().includes(lessonQuery.toLowerCase()));
  }, [lessons, lessonQuery]);

  const stepOneValid = title.trim().length > 0;
  const stepTwoValid = stepOneValid && selectedLessonIds.size > 0;

  const toggleLesson = (id: string) => {
    setSelectedLessonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission", "Allow photo library access to upload a cover.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize != null && asset.fileSize > 2 * 1024 * 1024) {
      Alert.alert("Too large", "Image must be under 2MB");
      return;
    }
    setCoverUploading(true);
    try {
      const url = await uploadPackCoverFromUri(asset.uri, asset.mimeType);
      setCoverImageUrl(url);
    } catch (e: unknown) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCoverUploading(false);
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const slug = slugifyTitle(title.trim()) || null;
      const payload = {
        title: title.trim(),
        slug,
        description: description.trim() || null,
        cefr_level: cefrLevel || null,
        category: category || null,
        access_type: accessType,
        price_label: accessType === "paid" ? priceLabel.trim() || null : null,
        cover_image_url: coverImageUrl.trim() || null,
        language: language || null,
        is_featured: isFeatured,
        status,
        created_by: currentUserId,
        updated_by: currentUserId,
      };
      const { data: insertedPack, error: packError } = await (supabase.from("lesson_packs") as any)
        .insert(payload)
        .select("id")
        .single();
      if (packError) throw packError;
      if (!insertedPack?.id) throw new Error("Pack created but id missing");

      const rows = Array.from(selectedLessonIds).map((lessonId, index) => ({
        pack_id: insertedPack.id,
        lesson_id: lessonId,
        sort_order: index,
      }));
      const { error: linkError } = await (supabase.from("lesson_pack_lessons") as any).insert(rows);
      if (linkError) throw linkError;

      await onSaved();
      Alert.alert("Created", "Pack created.");
      onClose();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to create pack");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 48,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>Close</Text>
          </TouchableOpacity>
          <Text style={[theme.typography.title, { flex: 1, textAlign: "center" }]}>
            {step === 1 ? "New pack" : "Select lessons"}
          </Text>
          <View style={{ width: 48 }} />
        </View>

        {step === 1 ? (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
            <Text style={theme.typography.caption}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Conversation booster"
              placeholderTextColor={theme.colors.textMuted}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 12,
                padding: 12,
                marginTop: 6,
                marginBottom: 14,
                color: theme.colors.text,
              }}
            />
            <Text style={theme.typography.caption}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 12,
                padding: 12,
                marginTop: 6,
                marginBottom: 14,
                minHeight: 100,
                color: theme.colors.text,
              }}
            />
            <Text style={theme.typography.caption}>CEFR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 14 }}>
              {NEW_PACK_CEFR.map((o) => (
                <TouchableOpacity
                  key={o}
                  onPress={() => setCefrLevel(o)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    marginRight: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: cefrLevel === o ? theme.colors.primary : theme.colors.border,
                    backgroundColor: cefrLevel === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700" }}>{o}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={theme.typography.caption}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 14 }}>
              {CATEGORY_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o}
                  onPress={() => setCategory(o)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    marginRight: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: category === o ? theme.colors.primary : theme.colors.border,
                    backgroundColor: category === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "700" }}>{o}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={theme.typography.caption}>Language</Text>
            <TouchableOpacity
              onPress={() => setLangModal(true)}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 12,
                padding: 14,
                marginTop: 6,
                marginBottom: 14,
              }}
            >
              <Text>{language || "Select language…"}</Text>
            </TouchableOpacity>
            <LanguagePickerModal
              visible={langModal}
              title="Pack language"
              value={language}
              allowEmpty
              onClose={() => setLangModal(false)}
              onSelect={setLanguage}
              theme={theme}
            />
            <Text style={theme.typography.caption}>Access</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 14 }}>
              {ACCESS_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o}
                  onPress={() => setAccessType(o)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: accessType === o ? theme.colors.primary : theme.colors.border,
                    backgroundColor: accessType === o ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 11, textTransform: "uppercase" }}>{o}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {accessType === "paid" ? (
              <>
                <Text style={theme.typography.caption}>Price label</Text>
                <TextInput
                  value={priceLabel}
                  onChangeText={setPriceLabel}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    borderRadius: 12,
                    padding: 12,
                    marginTop: 6,
                    marginBottom: 14,
                    maxWidth: 200,
                    color: theme.colors.text,
                  }}
                />
              </>
            ) : null}
            <Text style={theme.typography.caption}>Cover</Text>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 8, marginBottom: 14 }}>
              <TouchableOpacity
                onPress={pickCover}
                disabled={coverUploading}
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 16,
                  borderWidth: 2,
                  borderStyle: "dashed",
                  borderColor: theme.colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {coverUploading ? (
                  <ActivityIndicator />
                ) : coverImageUrl ? (
                  <Image source={{ uri: coverImageUrl }} style={{ width: "100%", height: "100%", borderRadius: 14 }} />
                ) : (
                  <Ionicons name="image-outline" size={28} color={theme.colors.textMuted} />
                )}
              </TouchableOpacity>
              <TextInput
                value={coverImageUrl}
                onChangeText={setCoverImageUrl}
                placeholder="Or paste URL"
                placeholderTextColor={theme.colors.textMuted}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 12,
                  padding: 10,
                  color: theme.colors.text,
                }}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={theme.typography.caption}>Status</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  {(["draft", "published"] as PackStatus[]).map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setStatus(s)}
                      style={{
                        flex: 1,
                        padding: 10,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: status === s ? theme.colors.primary : theme.colors.border,
                        backgroundColor: status === s ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: "800", textAlign: "center", textTransform: "uppercase" }}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setIsFeatured((v) => !v)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Ionicons name={isFeatured ? "checkbox" : "square-outline"} size={24} color={theme.colors.primary} />
              <Text style={theme.typography.bodyStrong}>Featured</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>
            <TextInput
              value={lessonQuery}
              onChangeText={setLessonQuery}
              placeholder="Search lessons…"
              placeholderTextColor={theme.colors.textMuted}
              style={{
                marginHorizontal: 16,
                marginTop: 12,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 12,
                padding: 12,
                color: theme.colors.text,
              }}
            />
            <FlatList
              data={filteredLessons}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
              renderItem={({ item: lesson }) => (
                <TouchableOpacity
                  onPress={() => toggleLesson(lesson.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    padding: 12,
                    marginBottom: 8,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selectedLessonIds.has(lesson.id) ? theme.colors.primary : theme.colors.border,
                    backgroundColor: selectedLessonIds.has(lesson.id) ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  }}
                >
                  <Ionicons
                    name={selectedLessonIds.has(lesson.id) ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={theme.colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={theme.typography.bodyStrong}>{lesson.title}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        <View
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: 16,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.background,
            flexDirection: "row",
            gap: 12,
          }}
        >
          {step === 1 ? (
            <>
              <View style={{ flex: 1 }}>
                <AppButton label="Cancel" onPress={onClose} variant="secondary" />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton label="Next" onPress={() => setStep(2)} disabled={!stepOneValid} />
              </View>
            </>
          ) : (
            <>
              <View style={{ flex: 1 }}>
                <AppButton label="Back" onPress={() => setStep(1)} variant="secondary" />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton label="Create" onPress={handleCreate} loading={saving} disabled={!stepTwoValid} />
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
