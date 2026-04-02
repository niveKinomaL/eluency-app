import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { decode as decodeBase64 } from "base64-arraybuffer";
import { NavigationProp, RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { DEFAULT_RULES, ensureQuestionDefaults, ensureTestSettings, uid } from "../lib/testDesignMobile";
import { getStudentLimitForPlan, normalizePlanUi } from "../lib/teacherRolePlanRules";

import type { RootTestsStackParams } from "./TestsScreen";

const apiBaseUrl =
  Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

const TEST_CATEGORIES = [
  "Vocabulary",
  "Lessons",
  "False Cognates",
  "Cognates",
  "Verb Tenses",
  "Prepositions",
  "Phrasal Verbs",
  "Idioms & Expressions",
  "Gender & Agreement",
  "Word Order",
  "Register & Formality",
  "Other",
] as const;

type WordRow = { key: string; en: string; pt: string };
type QRow = {
  key: string;
  id: string;
  q_type: "manual" | "ai";
  prompt_format: "text" | "audio" | "image" | "video" | "fill_blank";
  answer_format: "specific" | "open" | "mcq";
  section: string;
  points: number;
  required: boolean;
  prompt_text: string;
  image_url: string;
  audio_url: string;
  audio_transcript: string;
  correct_text: string;
  accepted_texts: string[];
  specific_rules: {
    caseInsensitive: boolean;
    ignorePunctuation: boolean;
    trimSpaces: boolean;
    accentInsensitive: boolean;
  };
  mcq_options: { id: string; text: string }[];
  mcq_correct_option_id: string;
  teacher_reference_answer: string;
  fill_blank_character_count?: number;
};
type LessonOpt = { id: string; title: string };
type TeacherOpt = { id: string; name: string };
type TestSettings = {
  time_limit_minutes: number | null;
  attempts_allowed: 1 | 2 | "unlimited";
  randomize_questions: boolean;
  randomize_mcq_options: boolean;
};
type TemplatePreset = {
  id: string;
  label: string;
  build: () => Partial<QRow>;
};

const AI_ELIGIBLE_PLANS = ["teacher", "standard", "pro", "school", "internal"];
const base64ByteSize = (base64: string) => {
  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
};

const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "vocab_recall",
    label: "Vocabulary recall",
    build: () => ({ prompt_format: "text", answer_format: "specific", section: "Vocabulary", points: 1 }),
  },
  {
    id: "picture_naming",
    label: "Picture naming",
    build: () => ({ prompt_format: "image", answer_format: "specific", section: "Vocabulary", points: 1 }),
  },
  {
    id: "listening_dictation",
    label: "Listening dictation",
    build: () => ({
      prompt_format: "audio",
      answer_format: "specific",
      section: "Listening",
      points: 1,
      specific_rules: { ...DEFAULT_RULES, accentInsensitive: true },
    }),
  },
  {
    id: "listening_mcq",
    label: "Listening comprehension",
    build: () => ({ prompt_format: "audio", answer_format: "mcq", section: "Listening", points: 1 }),
  },
  {
    id: "cloze",
    label: "Fill in the blank",
    build: () => ({
      prompt_format: "fill_blank",
      answer_format: "specific",
      section: "Grammar",
      points: 1,
      fill_blank_character_count: 4,
      prompt_text: "Fill in the blank: ____",
    }),
  },
  {
    id: "short_writing",
    label: "Short writing",
    build: () => ({ prompt_format: "text", answer_format: "open", section: "Writing", points: 2 }),
  },
];

export default function TestFormScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootTestsStackParams>>();
  const route = useRoute<RouteProp<RootTestsStackParams, "TestForm">>();
  const testId = route.params?.testId;
  const isEdit = !!testId;

  const [bootLoading, setBootLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [planUi, setPlanUi] = useState("Free");

  const [name, setName] = useState("");
  const [type, setType] = useState<string>("Vocabulary");
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [coverImageUrl, setCoverImageUrl] = useState("");

  const [words, setWords] = useState<(WordRow & { sp: string; se: string })[]>([{ key: uid(), en: "", pt: "", sp: "", se: "" }]);
  const [questions, setQuestions] = useState<QRow[]>([
    mapQuestion(ensureQuestionDefaults(null)),
  ]);
  const [linkedLessonIds, setLinkedLessonIds] = useState<string[]>([]);
  const [lessons, setLessons] = useState<LessonOpt[]>([]);
  const [teachers, setTeachers] = useState<TeacherOpt[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [lessonSearch, setLessonSearch] = useState("");

  const [testSettings, setTestSettings] = useState<TestSettings>(() => ensureTestSettings(null) as TestSettings);
  const [aiQuestionsLoading, setAiQuestionsLoading] = useState(false);
  const [aiVocabLoading, setAiVocabLoading] = useState(false);
  const [aiImageIndex, setAiImageIndex] = useState<number | null>(null);
  const [uploadingQuestionIndex, setUploadingQuestionIndex] = useState<number | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const canUseAI = useMemo(() => isAdmin || AI_ELIGIBLE_PLANS.includes((planUi ?? "").toLowerCase()), [isAdmin, planUi]);

  function mapQuestion(raw: Record<string, unknown>): QRow {
    return {
      key: uid(),
      id: String(raw.id ?? uid()),
      q_type: raw.q_type === "ai" ? "ai" : "manual",
      prompt_format: (raw.prompt_format as QRow["prompt_format"]) ?? "text",
      answer_format: (raw.answer_format as QRow["answer_format"]) ?? "specific",
      section: String(raw.section ?? ""),
      points: typeof raw.points === "number" ? raw.points : 1,
      required: raw.required !== false,
      prompt_text: String(raw.prompt_text ?? ""),
      image_url: String(raw.image_url ?? ""),
      audio_url: String(raw.audio_url ?? ""),
      audio_transcript: String(raw.audio_transcript ?? ""),
      correct_text: String(raw.correct_text ?? ""),
      accepted_texts: Array.isArray(raw.accepted_texts) ? raw.accepted_texts.filter((x): x is string => typeof x === "string") : [],
      specific_rules:
        raw.specific_rules && typeof raw.specific_rules === "object"
          ? {
              caseInsensitive: (raw.specific_rules as any).caseInsensitive !== false,
              ignorePunctuation: (raw.specific_rules as any).ignorePunctuation !== false,
              trimSpaces: (raw.specific_rules as any).trimSpaces !== false,
              accentInsensitive: (raw.specific_rules as any).accentInsensitive === true,
            }
          : { ...DEFAULT_RULES },
      mcq_options: Array.isArray(raw.mcq_options)
        ? raw.mcq_options.map((o: any) => ({ id: String(o?.id ?? uid()), text: String(o?.text ?? "") }))
        : [
            { id: uid(), text: "" },
            { id: uid(), text: "" },
            { id: uid(), text: "" },
            { id: uid(), text: "" },
          ],
      mcq_correct_option_id: String(raw.mcq_correct_option_id ?? ""),
      teacher_reference_answer: String(raw.teacher_reference_answer ?? ""),
      fill_blank_character_count:
        typeof raw.fill_blank_character_count === "number" ? raw.fill_blank_character_count : undefined,
    };
  }

  const replaceQuestion = (key: string, updater: (q: QRow) => QRow) => {
    setQuestions((prev) => prev.map((q) => (q.key === key ? updater(q) : q)));
  };

  const loadLessonsForTeacher = useCallback(async (tid: string) => {
    if (!tid) {
      setLessons([]);
      return;
    }
    const { data } = await supabase
      .from("lessons")
      .select("id, title")
      .eq("status", "published")
      .eq("created_by", tid)
      .order("created_at", { ascending: false });
    setLessons((data as LessonOpt[]) || []);
  }, []);

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
        setCurrentUserId(user.id);

        const { data: tr } = await (supabase.from("teachers") as any)
          .select("role, plan")
          .eq("user_id", user.id)
          .maybeSingle();
        const r = (tr as { role?: string })?.role ?? "";
        const p = normalizePlanUi((tr as { plan?: string })?.plan ?? null);
        setPlanUi(p);
        setIsAdmin(r === "admin");

        if (r !== "admin" && r !== "teacher") {
          Alert.alert("Access denied", "Only teachers and admins can edit tests.");
          navigation.goBack();
          return;
        }

        if (isEdit && testId) {
          const { data: row, error } = await (supabase.from("tests") as any).select("*").eq("id", testId).single();
          if (error || !row) {
            Alert.alert("Error", "Could not load test.");
            navigation.goBack();
            return;
          }
          if (r !== "admin" && row.teacher_id !== user.id) {
            Alert.alert("Access denied");
            navigation.goBack();
            return;
          }

          setName(row.name ?? "");
          const t = row.type ?? "Vocabulary";
          setType(TEST_CATEGORIES.includes(t as (typeof TEST_CATEGORIES)[number]) ? t : "Other");
          if (!TEST_CATEGORIES.includes(t as (typeof TEST_CATEGORIES)[number])) setCustomCategory(t);
          setDescription(row.description ?? "");
          setStatus(row.status === "published" ? "published" : "draft");
          setCoverImageUrl(row.cover_image_url ?? "");
          setTeacherId(row.teacher_id ?? user.id);

          const cfg = row.config_json && typeof row.config_json === "object" ? row.config_json : {};
          const w = Array.isArray((cfg as any).words) ? (cfg as any).words : [];
          setWords(
            w.length
              ? w.map((x: any) => ({
                  key: uid(),
                  en: String(x.en ?? ""),
                  pt: String(x.pt ?? ""),
                  sp: String(x.sp ?? ""),
                  se: String(x.se ?? ""),
                }))
              : [{ key: uid(), en: "", pt: "", sp: "", se: "" }]
          );

          const rawTests = Array.isArray((cfg as any).tests) ? (cfg as any).tests : [];
          setTestSettings(ensureTestSettings((cfg as any).test_settings) as TestSettings);
          setLinkedLessonIds(Array.isArray((cfg as any).linked_lesson_ids) ? [...(cfg as any).linked_lesson_ids] : []);

          const qRows: QRow[] = rawTests.map((tq: unknown) => mapQuestion(ensureQuestionDefaults(tq as Record<string, unknown>)));
          setQuestions(
            qRows.length
              ? qRows
              : [mapQuestion(ensureQuestionDefaults(null))]
          );

          if (r === "admin") {
            const { data: tlist } = await (supabase.from("teachers") as any).select("user_id, name").order("name");
            if (!cancelled && tlist) {
              setTeachers((tlist as { user_id: string; name: string }[]).map((x) => ({ id: x.user_id, name: x.name })));
            }
          }
          await loadLessonsForTeacher(row.teacher_id || user.id);
        } else {
          setName("");
          setType("Vocabulary");
          setCustomCategory("");
          setDescription("");
          setStatus("draft");
          setCoverImageUrl("");
          setWords([{ key: uid(), en: "", pt: "", sp: "", se: "" }]);
          setQuestions([mapQuestion(ensureQuestionDefaults(null))]);
          setLinkedLessonIds([]);
          setTestSettings(ensureTestSettings(null) as TestSettings);
          if (r === "admin") {
            const { data: tlist } = await (supabase.from("teachers") as any).select("user_id, name").order("name");
            if (!cancelled && tlist) {
              setTeachers((tlist as { user_id: string; name: string }[]).map((x) => ({ id: x.user_id, name: x.name })));
            }
          }
          setTeacherId(user.id);
          const limit = getStudentLimitForPlan(p);
          const isFreeCap = p === "Free" && limit <= 5;
          if (r !== "admin" && isFreeCap) {
            const { count } = await supabase.from("tests").select("*", { count: "exact", head: true }).eq("teacher_id", user.id);
            if ((count ?? 0) >= 5) {
              Alert.alert("Limit reached", "Free plan allows 5 tests. Upgrade or delete a test first.", [
                { text: "OK", onPress: () => navigation.goBack() },
              ]);
              return;
            }
          }
          await loadLessonsForTeacher(user.id);
        }
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : "Load failed");
        navigation.goBack();
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, testId, navigation, loadLessonsForTeacher]);

  useEffect(() => {
    if (!isAdmin || !teacherId) return;
    loadLessonsForTeacher(teacherId);
  }, [isAdmin, teacherId, loadLessonsForTeacher]);

  const filteredTeachers = teachers.filter((t) => t.name.toLowerCase().includes(teacherSearch.toLowerCase()));
  const filteredLessons = lessons.filter((l) => l.title.toLowerCase().includes(lessonSearch.toLowerCase()));

  const finalType = type === "Other" ? (customCategory.trim() || "Other") : type;

  const buildConfigJson = () => {
    const wordObjs = words
      .filter((w) => w.en.trim() || w.pt.trim())
      .map((w) => ({ pt: w.pt.trim(), en: w.en.trim(), sp: w.sp.trim(), se: w.se.trim() }));

    const builtTests: Record<string, unknown>[] = questions.map((q) =>
      ensureQuestionDefaults({
        id: q.id,
        q_type: q.q_type,
        prompt_format: q.prompt_format,
        answer_format: q.answer_format,
        section: q.section,
        points: q.points,
        required: q.required,
        prompt_text: q.prompt_text,
        image_url: q.image_url,
        audio_url: q.audio_url,
        audio_transcript: q.audio_transcript,
        correct_text: q.correct_text,
        accepted_texts: q.accepted_texts,
        specific_rules: q.specific_rules,
        mcq_options: q.mcq_options,
        mcq_correct_option_id: q.mcq_correct_option_id,
        teacher_reference_answer: q.teacher_reference_answer,
        fill_blank_character_count: q.fill_blank_character_count,
      })
    );

    return {
      words: wordObjs,
      tests: builtTests,
      test_settings: ensureTestSettings(testSettings),
      linked_lesson_ids: linkedLessonIds,
    };
  };

  const authedJsonFetch = async (path: string, body: unknown) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated");
    const base = apiBaseUrl.replace(/\/$/, "");
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json?.error ?? "Request failed"));
    return json;
  };

  const handleEnrichVocabularyWithAI = async () => {
    const source = words.filter((w) => w.en.trim() || w.pt.trim()).map((w) => ({ en: w.en, pt: w.pt, sp: w.sp, se: w.se }));
    if (!source.length) {
      Alert.alert("AI", "Add some vocabulary first.");
      return;
    }
    setAiVocabLoading(true);
    try {
      const json = await authedJsonFetch("/api/ai/tests/enrich-vocabulary", { words: source });
      const enriched = Array.isArray(json.words) ? json.words : [];
      if (!enriched.length) {
        Alert.alert("AI", "No enrichment returned.");
        return;
      }
      setWords(
        enriched.map((w: any) => ({
          key: uid(),
          en: String(w.en ?? ""),
          pt: String(w.pt ?? ""),
          sp: String(w.sp ?? ""),
          se: String(w.se ?? ""),
        }))
      );
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not enrich vocabulary");
    } finally {
      setAiVocabLoading(false);
    }
  };

  const handleGenerateQuestionsFromVocabulary = async () => {
    const source = words.filter((w) => w.en.trim() || w.pt.trim()).map((w) => ({ en: w.en, pt: w.pt, sp: w.sp, se: w.se }));
    if (!source.length) {
      Alert.alert("AI", "Add vocabulary first.");
      return;
    }
    setAiQuestionsLoading(true);
    try {
      const json = await authedJsonFetch("/api/ai/tests/generate-questions-from-vocabulary", { words: source });
      const generated = Array.isArray(json.tests) ? json.tests : [];
      if (!generated.length) {
        Alert.alert("AI", "No questions generated.");
        return;
      }
      setQuestions((prev) => [...prev, ...generated.map((q) => mapQuestion(ensureQuestionDefaults(q as Record<string, unknown>)))]);
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not generate questions");
    } finally {
      setAiQuestionsLoading(false);
    }
  };

  const handleGenerateImageForQuestion = async (index: number) => {
    const q = questions[index];
    if (!q) return;
    const pt = q.correct_text.trim();
    if (!pt) {
      Alert.alert("AI", "Set a correct answer first.");
      return;
    }
    setAiImageIndex(index);
    try {
      const json = await authedJsonFetch("/api/ai/tests/generate-image", { pt, en: q.prompt_text.trim() || undefined });
      const imageUrl = String(json.image_url ?? "");
      if (!imageUrl) {
        Alert.alert("AI", "No image returned.");
        return;
      }
      replaceQuestion(q.key, (cur) => ({ ...cur, image_url: imageUrl }));
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not generate image");
    } finally {
      setAiImageIndex(null);
    }
  };

  const uploadFileFromUri = async (uri: string, bucketPath: string, opts?: { maxBytes?: number; contentType?: string; ext?: string }) => {
    const path = `${bucketPath}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${opts?.ext ?? "bin"}`;
    let payload: Blob | ArrayBuffer;
    let inferredType = opts?.contentType ?? "application/octet-stream";
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      if (opts?.maxBytes && blob.size > opts.maxBytes) {
        throw new Error(`File must be under ${Math.floor(opts.maxBytes / (1024 * 1024))}MB`);
      }
      payload = blob;
      inferredType = opts?.contentType ?? blob.type ?? inferredType;
    } catch {
      // Fallback for Android content:// URIs that can fail with fetch.
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
      const bytes = base64ByteSize(base64);
      if (opts?.maxBytes && bytes > opts.maxBytes) {
        throw new Error(`File must be under ${Math.floor(opts.maxBytes / (1024 * 1024))}MB`);
      }
      payload = decodeBase64(base64);
    }
    const { error } = await supabase.storage.from("lesson-assets").upload(path, payload, {
      contentType: inferredType,
    });
    if (error) throw error;
    const { data } = supabase.storage.from("lesson-assets").getPublicUrl(path);
    return data.publicUrl;
  };

  const pickCoverImage = async () => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== "granted") {
      Alert.alert("Permission", "Allow media library access to upload images.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setCoverUploading(true);
    try {
      const ext = (a.fileName?.split(".").pop() || "jpg").toLowerCase();
      const url = await uploadFileFromUri(a.uri, "test-covers", {
        maxBytes: 2 * 1024 * 1024,
        contentType: a.mimeType ?? "image/jpeg",
        ext: ext === "png" || ext === "webp" || ext === "gif" || ext === "jpg" || ext === "jpeg" ? ext : "jpg",
      });
      setCoverImageUrl(url);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload image");
    } finally {
      setCoverUploading(false);
    }
  };

  const pickQuestionImage = async (index: number) => {
    const { status: perm } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm !== "granted") {
      Alert.alert("Permission", "Allow media library access to upload images.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setUploadingQuestionIndex(index);
    try {
      const ext = (a.fileName?.split(".").pop() || "jpg").toLowerCase();
      const url = await uploadFileFromUri(a.uri, "test-assets", {
        maxBytes: 2 * 1024 * 1024,
        contentType: a.mimeType ?? "image/jpeg",
        ext: ext === "png" || ext === "webp" || ext === "gif" || ext === "jpg" || ext === "jpeg" ? ext : "jpg",
      });
      const q = questions[index];
      if (q) replaceQuestion(q.key, (cur) => ({ ...cur, image_url: url }));
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload image");
    } finally {
      setUploadingQuestionIndex(null);
    }
  };

  const pickQuestionAudio = async (index: number) => {
    const res = await DocumentPicker.getDocumentAsync({
      type: "audio/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setUploadingQuestionIndex(index);
    try {
      const ext = (a.name?.split(".").pop() || "mp3").toLowerCase();
      const url = await uploadFileFromUri(a.uri, "test-audio", {
        maxBytes: 10 * 1024 * 1024,
        contentType: a.mimeType ?? "audio/mpeg",
        ext,
      });
      const q = questions[index];
      if (q) replaceQuestion(q.key, (cur) => ({ ...cur, audio_url: url }));
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload audio");
    } finally {
      setUploadingQuestionIndex(null);
    }
  };

  const openWebEditor = () => {
    const path = testId ? `/dashboard/tests/${testId}/edit` : "/dashboard/tests/new";
    const url = `${apiBaseUrl.replace(/\/$/, "")}${path}`;
    Linking.openURL(url).catch(() => Alert.alert("Web", url));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Test name is required.");
      return;
    }
    const config_json = buildConfigJson();
    const fillErr = (config_json.tests as Record<string, unknown>[]).find((t) => {
      if (t.prompt_format !== "fill_blank") return false;
      const cnt = (t.fill_blank_character_count as number) ?? 4;
      const len = String(t.correct_text ?? t.pt ?? "")
        .trim()
        .length;
      return len > 0 && len !== cnt;
    });
    if (fillErr) {
      Alert.alert("Validation", "A fill-in-the-blank question has wrong answer length. Open the web editor to fix.");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const tid = isAdmin ? teacherId || currentUserId : currentUserId;

      if (isEdit && testId) {
        const payload: Record<string, unknown> = {
          name: name.trim(),
          type: finalType,
          description: description.trim() || null,
          status,
          cover_image_url: coverImageUrl.trim() || null,
          config_json,
        };
        if (isAdmin) payload.teacher_id = tid;
        const { error } = await (supabase.from("tests") as any).update(payload).eq("id", testId);
        if (error) throw error;
        Alert.alert("Saved", "Test updated.");
      } else {
        const body = {
          name: name.trim(),
          type: finalType,
          description: description.trim() || null,
          status,
          config_json,
          cover_image_url: coverImageUrl.trim() || null,
          created_by: currentUserId,
          teacher_id: tid,
        };
        const base = apiBaseUrl.replace(/\/$/, "");
        let res = await fetch(`${base}/api/admin/tests`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const ins = await (supabase.from("tests") as any).insert({
            name: body.name,
            type: body.type,
            description: body.description,
            status: body.status,
            config_json: body.config_json,
            cover_image_url: body.cover_image_url,
            teacher_id: tid,
            created_by: currentUserId,
          });
          if (ins.error) {
            const errJson = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(errJson?.error ?? ins.error.message ?? "Create failed");
          }
        }
        Alert.alert("Created", "Test saved.");
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
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: theme.colors.primary, fontWeight: "800" }}>Back</Text>
        </TouchableOpacity>
        <Text style={[theme.typography.title, { flex: 1, textAlign: "center", fontSize: 17 }]}>
          {isEdit ? "Edit test" : "New test"}
        </Text>
        <TouchableOpacity onPress={openWebEditor}>
          <Text style={{ color: theme.colors.textMuted, fontSize: 12, fontWeight: "700" }}>Web</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 8 }]}>Details</Text>
          <Text style={[theme.typography.caption, { marginBottom: 4 }]}>Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Test name" placeholderTextColor={theme.colors.textMuted} style={[inputStyle, { marginBottom: 12 }]} />

          <Text style={[theme.typography.caption, { marginBottom: 8 }]}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: type === "Other" ? 8 : 12 }}>
            {TEST_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setType(c)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  marginRight: 8,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: type === c ? theme.colors.primary : theme.colors.border,
                  backgroundColor: type === c ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800" }}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {type === "Other" ? (
            <TextInput
              value={customCategory}
              onChangeText={setCustomCategory}
              placeholder="Custom category"
              placeholderTextColor={theme.colors.textMuted}
              style={[inputStyle, { marginBottom: 12 }]}
            />
          ) : null}

          <Text style={[theme.typography.caption, { marginBottom: 4 }]}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="Optional"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { minHeight: 72, marginBottom: 12 }]}
          />
          <Text style={[theme.typography.caption, { marginBottom: 4 }]}>Cover image URL</Text>
          <TextInput
            value={coverImageUrl}
            onChangeText={setCoverImageUrl}
            placeholder="https://..."
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 12 }]}
          />
          <TouchableOpacity
            onPress={pickCoverImage}
            disabled={coverUploading}
            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 12, alignSelf: "flex-start" }}
          >
            <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>{coverUploading ? "Uploading..." : "Upload cover image"}</Text>
          </TouchableOpacity>
          {coverImageUrl.trim() ? (
            <Image
              source={{ uri: coverImageUrl.trim() }}
              style={{ width: "100%", height: 170, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }}
              resizeMode="cover"
            />
          ) : null}

          <Text style={[theme.typography.caption, { marginBottom: 8 }]}>Status</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["draft", "published"] as const).map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => setStatus(s)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: status === s ? theme.colors.primary : theme.colors.border,
                  backgroundColor: status === s ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "800", textTransform: "uppercase" }}>{s}</Text>
              </TouchableOpacity>
            ))}
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
              <Text>{teachers.find((t) => t.id === teacherId)?.name ?? teacherId}</Text>
              <Ionicons name="chevron-down" size={18} color={theme.colors.textMuted} />
            </TouchableOpacity>
          </GlassCard>
        ) : null}

        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={[theme.typography.caption, { textTransform: "uppercase" }]}>Vocabulary</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={handleEnrichVocabularyWithAI}
                disabled={!canUseAI || aiVocabLoading}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: theme.colors.primary,
                  backgroundColor: theme.colors.primarySoft,
                  opacity: !canUseAI || aiVocabLoading ? 0.6 : 1,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>{aiVocabLoading ? "AI..." : "AI Fill"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setWords((w) => [...w, { key: uid(), en: "", pt: "", sp: "", se: "" }])}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: theme.colors.primarySoft }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>+ Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          {words.map((w, i) => (
            <View key={w.key} style={{ marginBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingBottom: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <Text style={theme.typography.caption}>Word {i + 1}</Text>
                {words.length > 1 ? (
                  <TouchableOpacity onPress={() => setWords((prev) => prev.filter((x) => x.key !== w.key))}>
                    <Text style={{ color: theme.colors.danger, fontSize: 12, fontWeight: "700" }}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TextInput
                value={w.en}
                onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, en: t } : x)))}
                placeholder="English"
                placeholderTextColor={theme.colors.textMuted}
                style={[inputStyle, { marginBottom: 8 }]}
              />
              <TextInput
                value={w.pt}
                onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, pt: t } : x)))}
                placeholder="Portuguese (or target)"
                placeholderTextColor={theme.colors.textMuted}
                style={[inputStyle, { marginBottom: 8 }]}
              />
              <TextInput
                value={w.sp}
                onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, sp: t } : x)))}
                placeholder="Context PT"
                placeholderTextColor={theme.colors.textMuted}
                style={[inputStyle, { marginBottom: 8 }]}
              />
              <TextInput
                value={w.se}
                onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, se: t } : x)))}
                placeholder="Context EN"
                placeholderTextColor={theme.colors.textMuted}
                style={inputStyle}
              />
            </View>
          ))}
        </GlassCard>

        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Text style={[theme.typography.caption, { textTransform: "uppercase" }]}>Questions</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={handleGenerateQuestionsFromVocabulary}
                disabled={!canUseAI || aiQuestionsLoading}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: theme.colors.primary,
                  backgroundColor: theme.colors.primarySoft,
                  opacity: !canUseAI || aiQuestionsLoading ? 0.6 : 1,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>{aiQuestionsLoading ? "AI..." : "AI Gen"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setTemplatePickerOpen((v) => !v)}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.text }}>Template</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setQuestions((q) => [...q, mapQuestion(ensureQuestionDefaults(null))])}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: theme.colors.primarySoft }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>+ Add</Text>
              </TouchableOpacity>
            </View>
          </View>
          {templatePickerOpen ? (
            <View style={{ marginBottom: 10, gap: 8 }}>
              {TEMPLATE_PRESETS.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => {
                    setQuestions((prev) =>
                      prev.concat(
                        mapQuestion(
                          ensureQuestionDefaults({
                            ...p.build(),
                            prompt_text: p.build().prompt_text ?? "",
                            correct_text: "",
                          })
                        )
                      )
                    );
                    setTemplatePickerOpen(false);
                  }}
                  style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "700" }}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {questions.map((q, i) => (
            <View key={q.key} style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text style={theme.typography.bodyStrong}>Q{i + 1}</Text>
                {questions.length > 1 ? (
                  <TouchableOpacity onPress={() => setQuestions((prev) => prev.filter((x) => x.key !== q.key))}>
                    <Text style={{ color: theme.colors.danger, fontSize: 12 }}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                {(["text", "fill_blank", "audio", "image"] as const).map((pf) => (
                  <TouchableOpacity
                    key={pf}
                    onPress={() => replaceQuestion(q.key, (cur) => ({ ...cur, prompt_format: pf }))}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: q.prompt_format === pf ? theme.colors.primary : theme.colors.border,
                      backgroundColor: q.prompt_format === pf ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "800" }}>{pf}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                {(["specific", "open", "mcq"] as const).map((af) => (
                  <TouchableOpacity
                    key={af}
                    onPress={() => replaceQuestion(q.key, (cur) => ({ ...cur, answer_format: af }))}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: q.answer_format === af ? theme.colors.primary : theme.colors.border,
                      backgroundColor: q.answer_format === af ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "800" }}>{af}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                value={q.section}
                onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, section: t }))}
                placeholder="Section"
                placeholderTextColor={theme.colors.textMuted}
                style={[inputStyle, { marginBottom: 8 }]}
              />
              <TextInput
                value={String(q.points)}
                onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, points: Number(t) || 0 }))}
                keyboardType="numeric"
                placeholder="Points"
                placeholderTextColor={theme.colors.textMuted}
                style={[inputStyle, { marginBottom: 8 }]}
              />
              <TouchableOpacity onPress={() => replaceQuestion(q.key, (cur) => ({ ...cur, required: !cur.required }))} style={{ marginBottom: 8 }}>
                <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>{q.required ? "Required" : "Optional"}</Text>
              </TouchableOpacity>
              <TextInput
                value={q.prompt_text}
                onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, prompt_text: t }))}
                placeholder="Question / prompt"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                style={[inputStyle, { marginBottom: 8 }]}
              />
              {q.answer_format === "specific" ? (
                <>
                  <TextInput
                    value={q.correct_text}
                    onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, correct_text: t }))}
                    placeholder="Correct answer"
                    placeholderTextColor={theme.colors.textMuted}
                    style={[inputStyle, { marginBottom: 8 }]}
                  />
                  <TextInput
                    value={q.accepted_texts.join(", ")}
                    onChangeText={(t) =>
                      replaceQuestion(q.key, (cur) => ({
                        ...cur,
                        accepted_texts: t
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      }))
                    }
                    placeholder="Accepted alternatives (comma separated)"
                    placeholderTextColor={theme.colors.textMuted}
                    style={[inputStyle, { marginBottom: 8 }]}
                  />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    {(
                      [
                        ["caseInsensitive", "Case insensitive"],
                        ["ignorePunctuation", "Ignore punctuation"],
                        ["trimSpaces", "Trim spaces"],
                        ["accentInsensitive", "Accent optional"],
                      ] as const
                    ).map(([k, label]) => (
                      <TouchableOpacity
                        key={k}
                        onPress={() =>
                          replaceQuestion(q.key, (cur) => ({
                            ...cur,
                            specific_rules: { ...cur.specific_rules, [k]: !cur.specific_rules[k] },
                          }))
                        }
                        style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "700" }}>
                          {q.specific_rules[k] ? "✓ " : ""}{label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}
              {q.answer_format === "open" ? (
                <TextInput
                  value={q.teacher_reference_answer}
                  onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, teacher_reference_answer: t }))}
                  placeholder="Teacher reference answer / rubric"
                  placeholderTextColor={theme.colors.textMuted}
                  multiline
                  style={[inputStyle, { marginBottom: 8 }]}
                />
              ) : null}
              {q.answer_format === "mcq" ? (
                <View style={{ gap: 8, marginBottom: 8 }}>
                  {q.mcq_options.map((opt, oi) => (
                    <View key={opt.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <TouchableOpacity onPress={() => replaceQuestion(q.key, (cur) => ({ ...cur, mcq_correct_option_id: opt.id }))}>
                        <Ionicons
                          name={q.mcq_correct_option_id === opt.id ? "radio-button-on" : "radio-button-off"}
                          size={18}
                          color={theme.colors.primary}
                        />
                      </TouchableOpacity>
                      <TextInput
                        value={opt.text}
                        onChangeText={(t) =>
                          replaceQuestion(q.key, (cur) => ({
                            ...cur,
                            mcq_options: cur.mcq_options.map((x, idx) => (idx === oi ? { ...x, text: t } : x)),
                          }))
                        }
                        placeholder={`Option ${oi + 1}`}
                        placeholderTextColor={theme.colors.textMuted}
                        style={[inputStyle, { flex: 1 }]}
                      />
                      <TouchableOpacity
                        onPress={() =>
                          replaceQuestion(q.key, (cur) => {
                            const next = cur.mcq_options.filter((_, idx) => idx !== oi);
                            return { ...cur, mcq_options: next.length >= 2 ? next : [...next, { id: uid(), text: "" }] };
                          })
                        }
                      >
                        <Text style={{ color: theme.colors.danger }}>Del</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => replaceQuestion(q.key, (cur) => ({ ...cur, mcq_options: [...cur.mcq_options, { id: uid(), text: "" }] }))}>
                    <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>+ Add option</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {q.prompt_format === "fill_blank" ? (
                <TextInput
                  value={String(q.fill_blank_character_count ?? 4)}
                  onChangeText={(t) =>
                    replaceQuestion(q.key, (cur) => ({ ...cur, fill_blank_character_count: Math.min(50, Math.max(1, Number(t) || 1)) }))
                  }
                  keyboardType="numeric"
                  placeholder="Blank character count"
                  placeholderTextColor={theme.colors.textMuted}
                  style={[inputStyle, { marginBottom: 8 }]}
                />
              ) : null}
              {(q.prompt_format === "image" || q.prompt_format === "audio" || q.answer_format === "mcq") ? (
                <>
                  <TextInput
                    value={q.image_url}
                    onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, image_url: t }))}
                    placeholder="Image URL"
                    placeholderTextColor={theme.colors.textMuted}
                    style={[inputStyle, { marginBottom: 8 }]}
                  />
                  {q.image_url.trim() ? (
                    <Image
                      source={{ uri: q.image_url.trim() }}
                      style={{ width: "100%", height: 160, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt }}
                      resizeMode="cover"
                    />
                  ) : null}
                  <TouchableOpacity
                    onPress={() => pickQuestionImage(i)}
                    disabled={uploadingQuestionIndex === i}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, alignSelf: "flex-start", opacity: uploadingQuestionIndex === i ? 0.6 : 1 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>
                      {uploadingQuestionIndex === i ? "Uploading..." : "Upload image"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleGenerateImageForQuestion(i)}
                    disabled={!canUseAI || aiImageIndex === i}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: theme.colors.primary,
                      marginBottom: 8,
                      opacity: !canUseAI || aiImageIndex === i ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>
                      {aiImageIndex === i ? "Generating..." : "Generate image with AI"}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}
              {q.prompt_format === "audio" ? (
                <>
                  <TextInput
                    value={q.audio_url}
                    onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, audio_url: t }))}
                    placeholder="Audio URL"
                    placeholderTextColor={theme.colors.textMuted}
                    style={[inputStyle, { marginBottom: 8 }]}
                  />
                  <TouchableOpacity
                    onPress={() => pickQuestionAudio(i)}
                    disabled={uploadingQuestionIndex === i}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8, alignSelf: "flex-start", opacity: uploadingQuestionIndex === i ? 0.6 : 1 }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.primary }}>
                      {uploadingQuestionIndex === i ? "Uploading..." : "Upload audio"}
                    </Text>
                  </TouchableOpacity>
                  <TextInput
                    value={q.audio_transcript}
                    onChangeText={(t) => replaceQuestion(q.key, (cur) => ({ ...cur, audio_transcript: t }))}
                    placeholder="Audio transcript (optional)"
                    placeholderTextColor={theme.colors.textMuted}
                    style={inputStyle}
                  />
                </>
              ) : null}
            </View>
          ))}
        </GlassCard>

        <GlassCard style={{ borderRadius: 16, marginBottom: 16 }} padding={16}>
          <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 8 }]}>Test settings</Text>
          <TextInput
            value={testSettings.time_limit_minutes == null ? "" : String(testSettings.time_limit_minutes)}
            onChangeText={(t) =>
              setTestSettings((prev) => ({ ...prev, time_limit_minutes: t.trim() ? Number(t) || null : null }))
            }
            keyboardType="numeric"
            placeholder="Time limit minutes (optional)"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 8 }]}
          />
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            {(["1", "2", "unlimited"] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() =>
                  setTestSettings((prev) => ({ ...prev, attempts_allowed: v === "unlimited" ? "unlimited" : (Number(v) as 1 | 2) }))
                }
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: String(testSettings.attempts_allowed) === v ? theme.colors.primary : theme.colors.border,
                  backgroundColor: String(testSettings.attempts_allowed) === v ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800" }}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={() => setTestSettings((prev) => ({ ...prev, randomize_questions: !prev.randomize_questions }))} style={{ marginBottom: 6 }}>
            <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>
              {testSettings.randomize_questions ? "✓" : "○"} Randomize question order
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTestSettings((prev) => ({ ...prev, randomize_mcq_options: !prev.randomize_mcq_options }))}>
            <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>
              {testSettings.randomize_mcq_options ? "✓" : "○"} Randomize MCQ options
            </Text>
          </TouchableOpacity>
        </GlassCard>

        <GlassCard style={{ borderRadius: 16, marginBottom: 24 }} padding={16}>
          <Text style={[theme.typography.caption, { textTransform: "uppercase", marginBottom: 8 }]}>Linked lessons</Text>
          <TextInput
            value={lessonSearch}
            onChangeText={setLessonSearch}
            placeholder="Search lessons…"
            placeholderTextColor={theme.colors.textMuted}
            style={[inputStyle, { marginBottom: 10 }]}
          />
          {filteredLessons.slice(0, 40).map((l) => {
            const on = linkedLessonIds.includes(l.id);
            return (
              <TouchableOpacity
                key={l.id}
                onPress={() =>
                  setLinkedLessonIds((prev) => (on ? prev.filter((x) => x !== l.id) : [...prev, l.id]))
                }
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
              >
                <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={theme.colors.primary} />
                <Text style={[theme.typography.body, { marginLeft: 10, flex: 1 }]} numberOfLines={2}>
                  {l.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </GlassCard>

        <AppButton label={isEdit ? "Save" : "Create"} onPress={handleSave} loading={saving} />
      </ScrollView>

      <Modal visible={teacherModalOpen} animationType="slide" transparent onRequestClose={() => setTeacherModalOpen(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => setTeacherModalOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={{ backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 16, maxHeight: "75%" }}>
              <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                <Text style={theme.typography.title}>Teacher</Text>
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
                    onPress={() => {
                      setTeacherId(t.id);
                      setTeacherModalOpen(false);
                      if (!isEdit) loadLessonsForTeacher(t.id);
                    }}
                    style={{ paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
                  >
                    <Text style={theme.typography.body}>{t.name}</Text>
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
