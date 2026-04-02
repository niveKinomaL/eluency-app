import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { decode as decodeBase64 } from "base64-arraybuffer";
import { NavigationProp, RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import type { RootLessonsStackParams } from "./LessonsScreen";

const apiBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";
const uid = () => Math.random().toString(36).slice(2, 10);

type RowType = "vocab" | "conjugation" | "preposition";
type ConjugationEntry = { pronoun: string; form_a: string; form_b?: string };
type PrepositionEntry = { left: string; right: string; answer: string; note?: string };
type PrepositionTemplate = { id: string; title: string; entries: PrepositionEntry[] };
type WordRow = {
  key: string;
  rowType: RowType;
  termA: string;
  termB: string;
  contextA: string;
  contextB: string;
  altA: string;
  altB: string;
  image_url: string;
  tense: string;
  grammar: string;
  isInfinitive: boolean;
  infinitive: string;
  conjugations: ConjugationEntry[];
  prepositionTitle: string;
  prepositionGroup: string;
  prepositionTemplateId: string;
  prepositions: PrepositionEntry[];
};

const CATEGORY_OPTIONS = [
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
const LANGUAGE_LEVELS = ["", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
const LESSON_LANGUAGES = ["Choose Language","Portuguese (BR)", "Spanish", "English", "French", "German", "Italian", "Japanese", "Korean", "Chinese (Mandarin)", "Arabic"] as const;
const LANGUAGE_PAIRS = [
  { code: "en-pt", labelA: "Portuguese", labelB: "English" },
  { code: "en-es", labelA: "English", labelB: "Spanish" },
  { code: "en-fr", labelA: "English", labelB: "French" },
  { code: "pt-es", labelA: "Portuguese", labelB: "Spanish" },
] as const;
const AI_ELIGIBLE_PLANS = ["teacher", "standard", "pro", "school", "internal"];
const TENSE_OPTIONS = ["", "Present", "Past", "Future", "Present Perfect", "Past Perfect", "Future Perfect", "Conditional", "Subjunctive", "Imperative", "Infinitive", "Gerund", "Participle"] as const;
const GRAMMAR_OPTIONS = ["", "Noun", "Verb", "Adjective", "Adverb", "Preposition", "Pronoun", "Conjunction", "Phrase", "Idiom", "Expression", "Other"] as const;

/** Maps lesson language → best matching language pair code */
const LANGUAGE_DEFAULT_PAIR: Record<string, string> = {
  "Portuguese (BR)": "en-pt",
  "Spanish": "en-es",
  "French": "en-fr",
  "German": "en-pt",
  "Italian": "en-pt",
  "English": "en-pt",
  "Japanese": "en-pt",
  "Korean": "en-pt",
  "Chinese (Mandarin)": "en-pt",
  "Arabic": "en-pt",
};

const PT_DE_TEMPLATE: PrepositionTemplate = {
  id: "pt-de",
  title: "Contrações com DE",
  entries: [
    { left: "DE", right: "O", answer: "DO" },
    { left: "DE", right: "A", answer: "DA" },
    { left: "DE", right: "OS", answer: "DOS" },
    { left: "DE", right: "AS", answer: "DAS" },
    { left: "DE", right: "ELE", answer: "DELE" },
    { left: "DE", right: "ELA", answer: "DELA" },
    { left: "DE", right: "ELES", answer: "DELES" },
    { left: "DE", right: "ELAS", answer: "DELAS" },
    { left: "DE", right: "ESSE", answer: "DESSE" },
    { left: "DE", right: "ESSA", answer: "DESSA" },
    { left: "DE", right: "ISSO", answer: "DISSO" },
    { left: "DE", right: "AQUELE", answer: "DAQUELE" },
    { left: "DE", right: "AQUELA", answer: "DAQUELA" },
  ],
};
const PT_EM_TEMPLATE: PrepositionTemplate = {
  id: "pt-em",
  title: "Contrações com EM",
  entries: [
    { left: "EM", right: "O", answer: "NO" },
    { left: "EM", right: "A", answer: "NA" },
    { left: "EM", right: "OS", answer: "NOS" },
    { left: "EM", right: "AS", answer: "NAS" },
    { left: "EM", right: "UM", answer: "NUM" },
    { left: "EM", right: "UMA", answer: "NUMA" },
    { left: "EM", right: "ELE", answer: "NELE" },
    { left: "EM", right: "ELA", answer: "NELA" },
    { left: "EM", right: "ESSE", answer: "NESSE" },
    { left: "EM", right: "ESSA", answer: "NESSA" },
    { left: "EM", right: "ISSO", answer: "NISSO" },
    { left: "EM", right: "AQUELE", answer: "NAQUELE" },
    { left: "EM", right: "AQUELA", answer: "NAQUELA" },
  ],
};
const PT_A_TEMPLATE: PrepositionTemplate = {
  id: "pt-a",
  title: "Contrações com A",
  entries: [
    { left: "A", right: "O", answer: "AO" },
    { left: "A", right: "OS", answer: "AOS" },
    { left: "A", right: "A", answer: "À" },
    { left: "A", right: "AS", answer: "ÀS" },
    { left: "A", right: "AQUELE", answer: "ÀQUELE" },
    { left: "A", right: "AQUELA", answer: "ÀQUELA" },
    { left: "A", right: "AQUELES", answer: "ÀQUELES" },
    { left: "A", right: "AQUELAS", answer: "ÀQUELAS" },
    { left: "A", right: "AQUILO", answer: "ÀQUILO" },
  ],
};
const PT_POR_TEMPLATE: PrepositionTemplate = {
  id: "pt-por",
  title: "Contrações com POR",
  entries: [
    { left: "POR", right: "O", answer: "PELO" },
    { left: "POR", right: "A", answer: "PELA" },
    { left: "POR", right: "OS", answer: "PELOS" },
    { left: "POR", right: "AS", answer: "PELAS" },
  ],
};

const LANGUAGE_CONFIG: Record<string, { rowTypes: RowType[]; pronouns: string[]; templates: PrepositionTemplate[] }> = {
  "Portuguese (BR)": {
    rowTypes: ["vocab", "conjugation", "preposition"],
    pronouns: ["EU", "VOCÊ", "ELE / ELA", "A GENTE", "NÓS", "VOCÊS", "ELES / ELAS"],
    templates: [PT_DE_TEMPLATE, PT_EM_TEMPLATE, PT_A_TEMPLATE, PT_POR_TEMPLATE],
  },
  Spanish: {
    rowTypes: ["vocab", "conjugation"],
    pronouns: ["YO", "TÚ", "ÉL / ELLA / USTED", "NOSOTROS / NOSOTRAS", "VOSOTROS / VOSOTRAS", "ELLOS / ELLAS / USTEDES"],
    templates: [],
  },
  French: { rowTypes: ["vocab", "conjugation"], pronouns: ["JE", "TU", "IL / ELLE / ON", "NOUS", "VOUS", "ILS / ELLES"], templates: [] },
  German: { rowTypes: ["vocab", "conjugation"], pronouns: ["ICH", "DU", "ER / SIE / ES", "WIR", "IHR", "SIE"], templates: [] },
  Italian: { rowTypes: ["vocab", "conjugation"], pronouns: ["IO", "TU", "LUI / LEI", "NOI", "VOI", "LORO"], templates: [] },
  English: { rowTypes: ["vocab"], pronouns: [], templates: [] },
  Japanese: { rowTypes: ["vocab"], pronouns: [], templates: [] },
  Korean: { rowTypes: ["vocab"], pronouns: [], templates: [] },
  "Chinese (Mandarin)": { rowTypes: ["vocab"], pronouns: [], templates: [] },
  Arabic: { rowTypes: ["vocab"], pronouns: [], templates: [] },
};

const emptyPrepositions = (): PrepositionEntry[] => [{ left: "", right: "", answer: "" }, { left: "", right: "", answer: "" }, { left: "", right: "", answer: "" }];
const base64ByteSize = (base64: string) => {
  const len = base64.length;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
};
const conjugationsFor = (lang: string): ConjugationEntry[] =>
  (LANGUAGE_CONFIG[lang]?.pronouns ?? []).map((pronoun) => ({ pronoun, form_a: "", form_b: "" }));
const makeWord = (languagePair: string, lang: string, rowType: RowType = "vocab"): WordRow => {
  const template = LANGUAGE_CONFIG[lang]?.templates?.[0];
  return {
    key: uid(),
    rowType,
    termA: "",
    termB: "",
    contextA: "",
    contextB: "",
    altA: "",
    altB: "",
    image_url: "",
    tense: "",
    grammar: rowType === "conjugation" ? "verb" : rowType === "preposition" ? "preposition" : "",
    isInfinitive: false,
    infinitive: "",
    conjugations: rowType === "conjugation" ? conjugationsFor(lang) : [],
    prepositionTitle: rowType === "preposition" ? template?.title || "Prepositions / Contractions" : "",
    prepositionGroup: rowType === "preposition" ? "Prepositions / Contractions" : "",
    prepositionTemplateId: rowType === "preposition" ? template?.id || "" : "",
    prepositions: rowType === "preposition" ? (template?.entries.length ? template.entries.map((e) => ({ ...e })) : emptyPrepositions()) : [],
  };
};

function DropdownField({
  label,
  value,
  options,
  placeholder,
  open,
  onToggle,
  onSelect,
}: {
  label: string;
  value: string;
  options: readonly string[];
  placeholder?: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  const theme = useAppTheme();

  return (
    <View style={{ marginBottom: 10, zIndex: open ? 50 : 1 }}>
      <Text style={[theme.typography.caption, { marginBottom: 6 }]}>{label}</Text>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onToggle}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: theme.colors.surfaceAlt,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: value ? theme.colors.text : theme.colors.textMuted, flex: 1 }}>
          {value || placeholder || "Select"}
        </Text>
        <Text style={{ color: theme.colors.textMuted, marginLeft: 10 }}>{open ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {open ? (
        <View
          style={{
            marginTop: 6,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 12,
            backgroundColor: theme.colors.surface,
            overflow: "hidden",
            maxHeight: 220,
          }}
        >
          <ScrollView nestedScrollEnabled>
            {options.map((option, index) => {
              const selected = option === value;
              return (
                <TouchableOpacity
                  key={`${label}-${option || "empty"}-${index}`}
                  activeOpacity={0.85}
                  onPress={() => onSelect(option)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                    borderBottomWidth: index === options.length - 1 ? 0 : 1,
                    borderBottomColor: theme.colors.border,
                  }}
                >
                  <Text style={{ color: theme.colors.text, fontWeight: selected ? "700" : "500" }}>
                    {option || "—"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function MiniDropdown({
  value,
  options,
  placeholder,
  isOpen,
  onToggle,
  onSelect,
}: {
  value: string;
  options: readonly string[];
  placeholder?: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (v: string) => void;
}) {
  const theme = useAppTheme();
  const phColor = theme.isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";
  return (
    <View style={{ zIndex: isOpen ? 50 : 1, flex: 1 }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onToggle}
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 7,
          backgroundColor: theme.colors.surface,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 42,
        }}
      >
        <Text style={{ fontSize: 12, color: value ? theme.colors.text : phColor, flex: 1 }}>
          {value || placeholder || "Select"}
        </Text>
        <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={12} color={theme.colors.textMuted} />
      </TouchableOpacity>
      {isOpen ? (
        <View
          style={{
            marginTop: 4,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 10,
            backgroundColor: theme.colors.surface,
            overflow: "hidden",
            maxHeight: 180,
          }}
        >
          <ScrollView nestedScrollEnabled>
            {options.map((opt, idx) => (
              <TouchableOpacity
                key={`${opt || "empty"}-${idx}`}
                onPress={() => onSelect(opt)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  backgroundColor: opt === value ? theme.colors.primarySoft : theme.colors.surface,
                  borderBottomWidth: idx === options.length - 1 ? 0 : 1,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <Text style={{ fontSize: 12, color: theme.colors.text, fontWeight: opt === value ? "700" : "400" }}>
                  {opt || "—"}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function InfoTooltip({
  id,
  visibleId,
  setVisibleId,
  text,
}: {
  id: string;
  visibleId: string | null;
  setVisibleId: React.Dispatch<React.SetStateAction<string | null>>;
  text: string;
}) {
  const theme = useAppTheme();
  const visible = visibleId === id;

  return (
    <View style={{ position: "relative" }}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setVisibleId((prev) => (prev === id ? null : id))}
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "800", color: theme.colors.textMuted }}>?</Text>
      </TouchableOpacity>

      {visible ? (
        <View
          style={{
            position: "absolute",
            top: 24,
            right: 0,
            width: 220,
            borderRadius: 12,
            padding: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
            shadowColor: "#000",
            shadowOpacity: 0.12,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
            zIndex: 999,
          }}
        >
          <Text style={{ fontSize: 12, lineHeight: 18, color: theme.colors.text }}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function LessonFormScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootLessonsStackParams>>();
  const route = useRoute<RouteProp<RootLessonsStackParams, "LessonForm">>();
  const lessonId = route.params?.lessonId;
  const isEdit = !!lessonId;

  const [bootLoading, setBootLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [planRaw, setPlanRaw] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Vocabulary");
  const [languageLevel, setLanguageLevel] = useState("");
  const [language, setLanguage] = useState<string>("(Choose Language)");
  const [languagePair, setLanguagePair] = useState<string>("en-pt");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docName, setDocName] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [words, setWords] = useState<WordRow[]>([makeWord("en-pt", "Portuguese (BR)", "vocab")]);
  const [aiSubject, setAiSubject] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);
  const [uploadingWordIndex, setUploadingWordIndex] = useState<number | null>(null);
  const [generatingImageIndex, setGeneratingImageIndex] = useState<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});
  const toggleAdvanced = (key: string) => setAdvancedOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const [openInlineDropdown, setOpenInlineDropdown] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);

  const [categoryOpen, setCategoryOpen] = useState(false);
  const [levelOpen, setLevelOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

  const pairMeta = useMemo(() => LANGUAGE_PAIRS.find((p) => p.code === languagePair) ?? LANGUAGE_PAIRS[0], [languagePair]);
  const languageConfig = useMemo(() => LANGUAGE_CONFIG[language] ?? LANGUAGE_CONFIG["Portuguese (BR)"], [language]);
  const canUseAI = useMemo(() => isAdmin || AI_ELIGIBLE_PLANS.includes(planRaw.toLowerCase()), [isAdmin, planRaw]);
  const labelA = pairMeta.labelA;
  const labelB = pairMeta.labelB;

  const [pendingLanguage, setPendingLanguage] = useState<string | null>(null);

  const closeAllDropdowns = () => {
    setCategoryOpen(false);
    setLevelOpen(false);
    setLanguageOpen(false);
    setOpenInlineDropdown(null);
    setTooltipVisible(null);
  };

  const loadLesson = useCallback(async () => {
    if (!lessonId) return;
    const { data, error } = await (supabase.from("lessons") as any).select("*").eq("id", lessonId).single();
    if (error || !data) throw new Error("Could not load lesson.");

    setTitle(data.title ?? "");
    setDescription(data.description ?? "");
    setCategory(data.grade_range ?? "Vocabulary");
    setLanguageLevel(data.language_level ?? "");
    setLanguage(data.language ?? "Portuguese (BR)");
    setCoverImageUrl(data.cover_image_url ?? "");
    setTeacherId(data.created_by ?? "");

    const cfg = data.content_json && typeof data.content_json === "object" ? data.content_json : {};
    setLanguagePair((cfg as any).language_pair ?? "en-pt");
    setDocUrl((cfg as any).document_url ?? "");
    setDocName((cfg as any).document_name ?? "");
    const rawWords = Array.isArray((cfg as any).words) ? (cfg as any).words : [];
    const mapped: WordRow[] = rawWords.map((w: any) => {
      const rt: RowType = w.rowType === "conjugation" ? "conjugation" : w.rowType === "preposition" ? "preposition" : "vocab";
      const base = makeWord((cfg as any).language_pair ?? "en-pt", data.language ?? "Portuguese (BR)", rt);
      return {
        ...base,
        key: uid(),
        termA: String(w.pt ?? w.term_a ?? ""),
        termB: String(w.en ?? w.term_b ?? ""),
        contextA: String(w.sp ?? w.context_a ?? ""),
        contextB: String(w.se ?? w.context_b ?? ""),
        altA: Array.isArray(w.pt_alt ?? w.alt_a) ? (w.pt_alt ?? w.alt_a).join(", ") : "",
        altB: Array.isArray(w.en_alt ?? w.alt_b) ? (w.en_alt ?? w.alt_b).join(", ") : "",
        image_url: String(w.image_url ?? ""),
        tense: String(w.tense ?? ""),
        grammar: String(w.grammar ?? base.grammar),
        isInfinitive: w.isInfinitive === true,
        infinitive: String(w.infinitive ?? ""),
        conjugations: Array.isArray(w.conjugations) ? w.conjugations.map((c: any) => ({ pronoun: String(c.pronoun ?? ""), form_a: String(c.form_a ?? ""), form_b: String(c.form_b ?? "") })) : base.conjugations,
        prepositionTitle: String(w.prepositionTitle ?? base.prepositionTitle),
        prepositionGroup: String(w.prepositionGroup ?? base.prepositionGroup),
        prepositionTemplateId: String(w.prepositionTemplateId ?? base.prepositionTemplateId),
        prepositions: Array.isArray(w.prepositions) ? w.prepositions.map((p: any) => ({ left: String(p.left ?? ""), right: String(p.right ?? ""), answer: String(p.answer ?? ""), note: String(p.note ?? "") })) : base.prepositions,
      };
    });
    setWords(mapped.length ? mapped : [makeWord((cfg as any).language_pair ?? "en-pt", data.language ?? "Portuguese (BR)", "vocab")]);
  }, [lessonId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not logged in");
        if (cancelled) return;
        setCurrentUserId(user.id);
        if (!lessonId) setTeacherId(user.id);

        const { data: tr } = await (supabase.from("teachers") as any).select("role, plan").eq("user_id", user.id).maybeSingle();
        if (!cancelled) {
          setIsAdmin((tr as any)?.role === "admin");
          setPlanRaw(String((tr as any)?.plan ?? ""));
        }
        if (isEdit) await loadLesson();
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : "Load failed");
        navigation.goBack();
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, lessonId, loadLesson, navigation]);

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceAlt,
  };

  const authedJsonFetch = async (path: string, body: unknown) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Not authenticated");
    const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new Error(String(json?.error ?? "Request failed"));
    return json;
  };

  const uploadFile = async (uri: string, prefix: string, ext: string, type: string, maxBytes: number) => {
    const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    let payload: Blob | ArrayBuffer;
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      if (blob.size > maxBytes) throw new Error(`File must be under ${Math.floor(maxBytes / (1024 * 1024))}MB`);
      payload = blob;
    } catch {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
      const bytes = base64ByteSize(base64);
      if (bytes > maxBytes) throw new Error(`File must be under ${Math.floor(maxBytes / (1024 * 1024))}MB`);
      payload = decodeBase64(base64);
    }
    const { error } = await supabase.storage.from("lesson-assets").upload(path, payload, { contentType: type });
    if (error) throw error;
    const { data } = supabase.storage.from("lesson-assets").getPublicUrl(path);
    return data.publicUrl;
  };

  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission", "Allow media access.");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsEditing: true, quality: 0.85 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    try {
      const ext = (a.fileName?.split(".").pop() || "jpg").toLowerCase();
      const url = await uploadFile(a.uri, "lesson-covers", ext, a.mimeType || "image/jpeg", 2 * 1024 * 1024);
      setCoverImageUrl(url);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload");
    }
  };

  const pickDoc = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    try {
      const url = await uploadFile(a.uri, "lesson-docs", "pdf", "application/pdf", 25 * 1024 * 1024);
      setDocUrl(url);
      setDocName(a.name || "Lesson PDF");
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload");
    }
  };

  const extractVocabularyFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const file = result.assets[0];
    setExtractLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const form = new FormData();
      form.append("file", { uri: file.uri, name: file.name || "vocab-file", type: file.mimeType || "application/octet-stream" } as any);
      form.append("language_pair", languagePair);
      const base = apiBaseUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/api/ai/lessons/extract-vocabulary-from-file`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const json = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok) throw new Error(String(json?.error ?? "Extraction failed"));
      const extracted = Array.isArray(json.words) ? json.words : [];
      if (!extracted.length) return Alert.alert("AI", "No vocabulary found in this file.");
      setWords((prev) =>
        prev.concat(
          extracted.map((w: any) => ({
            ...makeWord(languagePair, language, "vocab"),
            termA: String(w.pt ?? w.term_a ?? ""),
            termB: String(w.en ?? w.term_b ?? ""),
            contextA: String(w.sp ?? w.context_a ?? ""),
            contextB: String(w.se ?? w.context_b ?? ""),
            altA: Array.isArray(w.pt_alt ?? w.alt_a) ? (w.pt_alt ?? w.alt_a).join(", ") : "",
            altB: Array.isArray(w.en_alt ?? w.alt_b) ? (w.en_alt ?? w.alt_b).join(", ") : "",
            image_url: String(w.image_url ?? ""),
          }))
        )
      );
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not extract vocabulary");
    } finally {
      setExtractLoading(false);
    }
  };

  const pickWordImage = async (index: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission", "Allow media access.");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsEditing: true, quality: 0.85 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    setUploadingWordIndex(index);
    try {
      const ext = (a.fileName?.split(".").pop() || "jpg").toLowerCase();
      const url = await uploadFile(a.uri, "lesson-assets", ext, a.mimeType || "image/jpeg", 2 * 1024 * 1024);
      setWords((prev) => prev.map((x, i) => (i === index ? { ...x, image_url: url } : x)));
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Could not upload");
    } finally {
      setUploadingWordIndex(null);
    }
  };

  const generateWithAI = async () => {
    const subject = aiSubject.trim() || title.trim();
    if (!subject) return Alert.alert("AI", "Enter a subject or title first.");
    setAiLoading(true);
    try {
      const json = await authedJsonFetch("/api/ai/lessons/generate-vocabulary", { subject, language_pair: languagePair });
      const generated = Array.isArray(json.words) ? json.words : [];
      if (!generated.length) return Alert.alert("AI", "No words generated.");
      const rows = generated.map((w: any) => ({
        ...makeWord(languagePair, language, "vocab"),
        termA: String(w.pt ?? w.term_a ?? ""),
        termB: String(w.en ?? w.term_b ?? ""),
        contextA: String(w.sp ?? w.context_a ?? ""),
        contextB: String(w.se ?? w.context_b ?? ""),
        altA: Array.isArray(w.pt_alt ?? w.alt_a) ? (w.pt_alt ?? w.alt_a).join(", ") : "",
        altB: Array.isArray(w.en_alt ?? w.alt_b) ? (w.en_alt ?? w.alt_b).join(", ") : "",
        image_url: String(w.image_url ?? ""),
      }));
      setWords((prev) => [...prev, ...rows]);
      if (!title.trim()) setTitle(subject);
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not generate");
    } finally {
      setAiLoading(false);
    }
  };

  const generateWordImageWithAI = async (index: number) => {
    const row = words[index];
    if (!row) return;
    if (!row.termA.trim() && !row.termB.trim()) return Alert.alert("AI", "Enter a term first.");
    setGeneratingImageIndex(index);
    try {
      const json = await authedJsonFetch("/api/ai/tests/generate-image", {
        pt: row.termA.trim() || row.termB.trim(),
        en: row.termB.trim() || row.termA.trim(),
      });
      const url = String(json.image_url ?? "");
      if (!url) return Alert.alert("AI", "No image returned.");
      setWords((prev) => prev.map((x, i) => (i === index ? { ...x, image_url: url } : x)));
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not generate image");
    } finally {
      setGeneratingImageIndex(null);
    }
  };

  const fillBlanksWithAI = async (index: number) => {
    const row = words[index];
    if (!row) return;
    if (!row.termA.trim() && !row.termB.trim()) return Alert.alert("AI", "Enter a term first.");
    try {
      const json = await authedJsonFetch("/api/ai/lessons/fill-in-the-blanks", {
        language_pair: languagePair,
        term_a: row.termA.trim() || null,
        term_b: row.termB.trim() || null,
        existing: {
          pt: row.termA,
          en: row.termB,
          sp: row.contextA,
          se: row.contextB,
          pt_alt: row.altA.split(",").map((s) => s.trim()).filter(Boolean),
          en_alt: row.altB.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      const w = json.word ?? {};
      setWords((prev) =>
        prev.map((x, i) =>
          i === index
            ? {
                ...x,
                termA: String(w.pt ?? w.term_a ?? x.termA),
                termB: String(w.en ?? w.term_b ?? x.termB),
                contextA: String(w.sp ?? w.context_a ?? x.contextA),
                contextB: String(w.se ?? w.context_b ?? x.contextB),
                altA: Array.isArray(w.pt_alt ?? w.alt_a) ? (w.pt_alt ?? w.alt_a).join(", ") : x.altA,
                altB: Array.isArray(w.en_alt ?? w.alt_b) ? (w.en_alt ?? w.alt_b).join(", ") : x.altB,
              }
            : x
        )
      );
    } catch (e) {
      Alert.alert("AI Error", e instanceof Error ? e.message : "Could not fill blanks");
    }
  };

  const save = async () => {
    if (!title.trim()) return Alert.alert("Validation", "Title required.");
    const serializedWords = words
      .map((w) => ({
        rowType: w.rowType,
        pt: w.rowType === "vocab" ? w.termA.trim() : undefined,
        en: w.rowType === "vocab" ? w.termB.trim() : undefined,
        sp: w.rowType === "vocab" ? (w.contextA.trim() || undefined) : undefined,
        se: w.rowType === "vocab" ? (w.contextB.trim() || undefined) : undefined,
        pt_alt: w.rowType === "vocab" ? w.altA.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        en_alt: w.rowType === "vocab" ? w.altB.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        image_url: w.image_url.trim() || undefined,
        tense: w.tense.trim() || undefined,
        grammar: w.grammar.trim() || undefined,
        isInfinitive: w.isInfinitive || undefined,
        infinitive: w.rowType === "conjugation" ? w.infinitive.trim() : undefined,
        conjugations: w.rowType === "conjugation" ? w.conjugations.filter((c) => c.pronoun || c.form_a || c.form_b) : undefined,
        prepositionTitle: w.rowType === "preposition" ? w.prepositionTitle.trim() : undefined,
        prepositionGroup: w.rowType === "preposition" ? w.prepositionGroup.trim() : undefined,
        prepositionTemplateId: w.rowType === "preposition" ? w.prepositionTemplateId.trim() : undefined,
        prepositions: w.rowType === "preposition" ? w.prepositions.filter((p) => p.left || p.right || p.answer || p.note) : undefined,
      }))
      .filter((w) => {
        if (w.rowType === "conjugation") return !!(w.infinitive || w.conjugations?.length);
        if (w.rowType === "preposition") return !!(w.prepositionTitle || w.prepositions?.length);
        return !!(w.pt || w.en || w.sp || w.se);
      });
    const content_json = {
      language_pair: languagePair,
      document_url: docUrl.trim() || null,
      document_name: docName.trim() || null,
      words: serializedWords,
    };

    setSaving(true);
    try {
      const ownerId = isAdmin ? (teacherId || currentUserId) : currentUserId;
      if (isEdit && lessonId) {
        const payload: Record<string, unknown> = {
          title: title.trim(),
          description: description.trim() || null,
          grade_range: category,
          language_level: languageLevel || null,
          language,
          cover_image_url: coverImageUrl.trim() || null,
          content_json,
          status: "published",
          updated_by: currentUserId,
          updated_at: new Date().toISOString(),
        };
        if (isAdmin) {
          payload.teacher_id = ownerId;
          payload.created_by = ownerId;
        }
        const { error } = await (supabase.from("lessons") as any).update(payload).eq("id", lessonId);
        if (error) throw error;
      } else {
        const slug = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
        const { error } = await (supabase.from("lessons") as any).insert({
          title: title.trim(),
          slug,
          description: description.trim() || null,
          grade_range: category,
          language_level: languageLevel || null,
          language,
          cover_image_url: coverImageUrl.trim() || null,
          content_json,
          status: "published",
          teacher_id: ownerId,
          created_by: ownerId,
          updated_by: currentUserId,
        });
        if (error) throw error;
      }
      Alert.alert("Saved", isEdit ? "Lesson updated." : "Lesson created.");
      navigation.goBack();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openWeb = () => {
    const path = lessonId ? `/dashboard/lessons/${lessonId}/edit` : "/dashboard/lessons/new";
    const url = `${apiBaseUrl.replace(/\/$/, "")}${path}`;
    Linking.openURL(url).catch(() => Alert.alert("Web", url));
  };

  if (bootLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator color={theme.colors.primary} /></View>;
  }

  const placeholderColor = theme.isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";

  const pillStyle = {
    flex: 1,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    fontSize: 14,
    minHeight: 44,
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      {pendingLanguage ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, padding: 24, width: "100%", borderWidth: 1, borderColor: theme.colors.border }}>
            <Text style={[theme.typography.title, { marginBottom: 8 }]}>Change language?</Text>
            <Text style={[theme.typography.body, { marginBottom: 16, color: theme.colors.textMuted }]}>
              Switching to <Text style={{ fontWeight: "800", color: theme.colors.text }}>{pendingLanguage}</Text> may affect conjugation and preposition rows.
            </Text>
            <TouchableOpacity onPress={() => { const np = LANGUAGE_DEFAULT_PAIR[pendingLanguage] ?? "en-pt"; setLanguage(pendingLanguage); setLanguagePair(np); setWords((prev) => prev.map((w) => w.rowType === "conjugation" ? { ...w, conjugations: conjugationsFor(pendingLanguage) } : w)); setPendingLanguage(null); }} style={{ borderRadius: 12, backgroundColor: theme.colors.primary, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}>
              <Text style={{ color: theme.colors.primaryText, fontWeight: "800", fontSize: 15 }}>Keep existing rows</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { const np = LANGUAGE_DEFAULT_PAIR[pendingLanguage] ?? "en-pt"; setLanguage(pendingLanguage); setLanguagePair(np); setWords((prev) => { const kept = prev.filter((w) => w.rowType === "vocab"); return kept.length > 0 ? kept : [makeWord(np, pendingLanguage, "vocab")]; }); setPendingLanguage(null); }} style={{ borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: 14, alignItems: "center", marginBottom: 10 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>Clear language-specific rows</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPendingLanguage(null)} style={{ alignItems: "center", paddingVertical: 10 }}>
              <Text style={{ color: theme.colors.textMuted, fontWeight: "700" }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={{ paddingTop: Math.max(insets.top, 8), paddingBottom: 10, paddingHorizontal: 16, borderBottomWidth: 1.5, borderBottomColor: theme.colors.border, flexDirection: "row", alignItems: "center", backgroundColor: theme.isDark ? theme.colors.background : "#FFF" }}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.85} style={{ width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceGlass, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
        <Text style={[theme.typography.title, { flex: 1, textAlign: "center", fontSize: 17 }]}>{isEdit ? "Edit lesson" : "New lesson"}</Text>
        <TouchableOpacity onPress={openWeb} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft }}>
          <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: "800" }}>Web ↗</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity activeOpacity={1} onPress={closeAllDropdowns}>
          <View>
            <TouchableOpacity onPress={pickCover} activeOpacity={0.85}>
              {coverImageUrl.trim() ? (
                <Image source={{ uri: coverImageUrl.trim() }} style={{ width: "100%", height: 200, backgroundColor: theme.colors.surfaceAlt }} resizeMode="cover" />
              ) : (
                <View style={{ width: "100%", height: 160, backgroundColor: theme.colors.surfaceAlt, borderBottomWidth: 1.5, borderBottomColor: theme.colors.border, alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Ionicons name="image-outline" size={36} color={theme.colors.textMuted} />
                  <Text style={{ color: theme.colors.textMuted, fontWeight: "700", fontSize: 14 }}>Tap to add cover image</Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={{ padding: 16, gap: 12 }}>
              <View style={{ borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 16, backgroundColor: theme.colors.surface, overflow: "hidden" }}>
                <TextInput value={title} onChangeText={setTitle} placeholder="Lesson title" placeholderTextColor={placeholderColor} style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, fontSize: 20, fontWeight: "800", color: theme.colors.text }} />
                <View style={{ height: 1, backgroundColor: theme.colors.border }} />
                <TextInput value={description} onChangeText={setDescription} multiline placeholder="Description (optional)" placeholderTextColor={placeholderColor} style={{ paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: theme.colors.text, minHeight: 60 }} />
              </View>

              <View style={{ borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 16, backgroundColor: theme.colors.surface, overflow: "hidden" }}>
                <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.textMuted, letterSpacing: 1.5, textTransform: "uppercase" }}>Settings</Text>
                </View>
                <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
                  <DropdownField label="Language" value={language} options={LESSON_LANGUAGES} placeholder="Select language" open={languageOpen}
                    onToggle={() => { setCategoryOpen(false); setLevelOpen(false); setLanguageOpen((p) => !p); }}
                    onSelect={(value) => {
                      setLanguageOpen(false);
                      if (value === language) return;
                      const hasContent = words.some((w) => w.termA.trim() || w.termB.trim() || w.infinitive?.trim());
                      const hasSpecial = words.some((w) => w.rowType === "conjugation" || w.rowType === "preposition");
                      if (hasContent && hasSpecial) { setPendingLanguage(value); } else {
                        const np = LANGUAGE_DEFAULT_PAIR[value] ?? "en-pt";
                        setLanguage(value); setLanguagePair(np);
                        setWords((prev) => prev.map((w) => { if (w.rowType === "conjugation") return { ...w, conjugations: conjugationsFor(value) }; if (w.rowType === "preposition" && !LANGUAGE_CONFIG[value]?.rowTypes.includes("preposition")) return makeWord(np, value, "vocab"); return w; }));
                      }
                    }}
                  />
                  <DropdownField label="Level" value={languageLevel} options={LANGUAGE_LEVELS} placeholder="Select level" open={levelOpen}
                    onToggle={() => { setCategoryOpen(false); setLanguageOpen(false); setLevelOpen((p) => !p); }}
                    onSelect={(value) => { setLanguageLevel(value); setLevelOpen(false); }}
                  />
                  <DropdownField label="Category" value={category} options={CATEGORY_OPTIONS} placeholder="Select category" open={categoryOpen}
                    onToggle={() => { setLevelOpen(false); setLanguageOpen(false); setCategoryOpen((p) => !p); }}
                    onSelect={(value) => { setCategory(value); setCategoryOpen(false); }}
                  />
                </View>
              </View>

              <View style={{ borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 16, backgroundColor: theme.colors.surface, padding: 14 }}>
                <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.textMuted, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>Lesson Document (PDF)</Text>
                {docUrl ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="document-outline" size={16} color={theme.colors.primary} />
                    <Text style={{ flex: 1, fontSize: 13, color: theme.colors.text }} numberOfLines={1}>{docName || docUrl}</Text>
                    <TouchableOpacity onPress={() => { setDocUrl(""); setDocName(""); }}>
                      <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : null}
                <TouchableOpacity onPress={pickDoc} style={{ paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.primary, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: "700" }}>Upload PDF</Text>
                </TouchableOpacity>
              </View>

              <View style={{ borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 16, backgroundColor: theme.colors.surface, overflow: "hidden" }}>
                <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.textMuted, letterSpacing: 1.5, textTransform: "uppercase" }}>Vocabulary</Text>
                </View>

                {canUseAI ? (
                  <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 10, fontWeight: "800", color: theme.colors.textMuted, letterSpacing: 1.2, textTransform: "uppercase" }}>AI Subject</Text>
                      <InfoTooltip
                        id="ai-subject-help"
                        visibleId={tooltipVisible}
                        setVisibleId={setTooltipVisible}
                        text='When adding a subject and hitting this button, it will generate 5 words for the lesson at a time'
                      />
                    </View>

                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <TextInput
                        value={aiSubject}
                        onChangeText={setAiSubject}
                        placeholder="AI subject (optional)"
                        placeholderTextColor={placeholderColor}
                        style={[inputStyle, { marginBottom: 0, flex: 1 }]}
                      />
                      <TouchableOpacity
                        onPress={generateWithAI}
                        disabled={aiLoading}
                        style={{
                          minWidth: 86,
                          paddingHorizontal: 12,
                          paddingVertical: 12,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: theme.colors.primary,
                          backgroundColor: theme.colors.primarySoft,
                          opacity: aiLoading ? 0.6 : 1,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "800", color: theme.colors.primary }}>{aiLoading ? "AI..." : "✦ AI"}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14, gap: 16 }}>
                  {words.map((w, i) => {
                    const isOpen = !!advancedOpen[w.key];
                    return (
                      <View key={w.key} style={{ borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 14, overflow: "hidden", backgroundColor: theme.isDark ? "#1a1a2e" : "#F8F9FF" }}>
                        {languageConfig.rowTypes.length > 1 ? (
                          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                            {languageConfig.rowTypes.map((rt, idx) => (
                              <TouchableOpacity
                                key={rt}
                                onPress={() => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...makeWord(languagePair, language, rt), key: x.key, image_url: x.image_url } : x)))}
                                style={{
                                  flex: 1,
                                  paddingVertical: 8,
                                  alignItems: "center",
                                  borderRightWidth: idx === languageConfig.rowTypes.length - 1 ? 0 : 1,
                                  borderRightColor: theme.colors.border,
                                  backgroundColor: w.rowType === rt ? theme.colors.primarySoft : "transparent",
                                }}
                              >
                                <Text style={{ fontSize: 11, fontWeight: "800", color: w.rowType === rt ? theme.colors.primary : theme.colors.textMuted, textTransform: "capitalize" }}>{rt}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : null}

                        <View style={{ padding: 12, gap: 8 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.textMuted }}>#{i + 1}</Text>
                            {words.length > 1 ? (
                              <TouchableOpacity onPress={() => setWords((prev) => prev.filter((x) => x.key !== w.key))}>
                                <Ionicons name="trash-outline" size={15} color={theme.colors.danger} />
                              </TouchableOpacity>
                            ) : null}
                          </View>

                          {w.rowType === "vocab" ? (
                            <>
                              <View style={{ flexDirection: "row", gap: 8 }}>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 10, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase" }}>{labelA}</Text>
                                  <TextInput value={w.termA} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, termA: t } : x)))} placeholder={`${labelA} term`} placeholderTextColor={placeholderColor} style={pillStyle} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: 10, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase" }}>{labelB}</Text>
                                  <TextInput value={w.termB} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, termB: t } : x)))} placeholder={`${labelB} term`} placeholderTextColor={placeholderColor} style={pillStyle} />
                                </View>
                              </View>

                              <TouchableOpacity onPress={() => toggleAdvanced(w.key)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}>
                                <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.primary }}>Advanced options</Text>
                                <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={13} color={theme.colors.primary} />
                              </TouchableOpacity>

                              {isOpen ? (
                                <View style={{ gap: 10 }}>
                                  <View style={{ flexDirection: "row", gap: 8 }}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Tense</Text>
                                      <MiniDropdown
                                        value={w.tense}
                                        options={TENSE_OPTIONS}
                                        placeholder="Select tense"
                                        isOpen={openInlineDropdown === `${w.key}-tense`}
                                        onToggle={() => setOpenInlineDropdown(openInlineDropdown === `${w.key}-tense` ? null : `${w.key}-tense`)}
                                        onSelect={(t) => { setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, tense: t } : x))); setOpenInlineDropdown(null); }}
                                      />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>Grammar</Text>
                                      <MiniDropdown
                                        value={w.grammar}
                                        options={GRAMMAR_OPTIONS}
                                        placeholder="Select grammar"
                                        isOpen={openInlineDropdown === `${w.key}-grammar`}
                                        onToggle={() => setOpenInlineDropdown(openInlineDropdown === `${w.key}-grammar` ? null : `${w.key}-grammar`)}
                                        onSelect={(t) => { setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, grammar: t } : x))); setOpenInlineDropdown(null); }}
                                      />
                                    </View>
                                  </View>

                                  <View style={{ flexDirection: "row", gap: 8 }}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{labelA} Alts</Text>
                                      <TextInput value={w.altA} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, altA: t } : x)))} placeholder="Comma separated" placeholderTextColor={placeholderColor} style={[pillStyle, { fontSize: 13 }]} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{labelB} Alts</Text>
                                      <TextInput value={w.altB} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, altB: t } : x)))} placeholder="Comma separated" placeholderTextColor={placeholderColor} style={[pillStyle, { fontSize: 13 }]} />
                                    </View>
                                  </View>

                                  <View style={{ gap: 8 }}>
                                    <View>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{labelA} Sentence</Text>
                                      <TextInput
                                        value={w.contextA}
                                        onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, contextA: t } : x)))}
                                        placeholder="Example sentence"
                                        placeholderTextColor={placeholderColor}
                                        style={[pillStyle, { fontSize: 13, minHeight: 44 }]}
                                      />
                                    </View>
                                    <View>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.8 }}>{labelB} Sentence</Text>
                                      <TextInput
                                        value={w.contextB}
                                        onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, contextB: t } : x)))}
                                        placeholder="Example sentence"
                                        placeholderTextColor={placeholderColor}
                                        style={[pillStyle, { fontSize: 13, minHeight: 44 }]}
                                      />
                                    </View>
                                  </View>

                                  {w.image_url.trim() ? (
                                    <Image source={{ uri: w.image_url.trim() }} style={{ width: "100%", height: 140, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border }} resizeMode="cover" />
                                  ) : null}

                                  <View style={{ flexDirection: "row", gap: 8 }}>
                                    <TouchableOpacity
                                      onPress={() => pickWordImage(i)}
                                      style={{
                                        flex: 1,
                                        paddingHorizontal: 10,
                                        paddingVertical: 10,
                                        borderRadius: 10,
                                        borderWidth: 1,
                                        borderColor: theme.colors.border,
                                        backgroundColor: theme.colors.surface,
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.text }}>
                                        {uploadingWordIndex === i ? "Uploading..." : "Upload image"}
                                      </Text>
                                    </TouchableOpacity>

                                    {canUseAI ? (
                                      <>
                                        <TouchableOpacity
                                          onPress={() => generateWordImageWithAI(i)}
                                          disabled={generatingImageIndex === i}
                                          style={{
                                            flex: 1,
                                            paddingHorizontal: 10,
                                            paddingVertical: 10,
                                            borderRadius: 10,
                                            borderWidth: 1,
                                            borderColor: theme.colors.primary,
                                            backgroundColor: theme.colors.primarySoft,
                                            opacity: generatingImageIndex === i ? 0.6 : 1,
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.primary }}>
                                            {generatingImageIndex === i ? "AI..." : "AI image"}
                                          </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                          onPress={() => fillBlanksWithAI(i)}
                                          style={{
                                            flex: 1,
                                            paddingHorizontal: 10,
                                            paddingVertical: 10,
                                            borderRadius: 10,
                                            borderWidth: 1,
                                            borderColor: theme.colors.primary,
                                            backgroundColor: theme.colors.primarySoft,
                                            alignItems: "center",
                                            justifyContent: "center",
                                          }}
                                        >
                                          <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.primary }}>Fill AI</Text>
                                        </TouchableOpacity>
                                      </>
                                    ) : null}
                                  </View>
                                </View>
                              ) : null}
                            </>
                          ) : null}

                          {w.rowType === "conjugation" ? (
                            <>
                              <TextInput value={w.infinitive} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, infinitive: t } : x)))} placeholder="Verb / infinitive" placeholderTextColor={placeholderColor} style={pillStyle} />
                              {w.conjugations.map((c, ci) => (
                                <View key={`${w.key}-c-${ci}`} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                                  <Text style={{ width: 90, fontSize: 11, color: theme.colors.textMuted, fontWeight: "700" }}>{c.pronoun}</Text>
                                  <TextInput value={c.form_a} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, conjugations: x.conjugations.map((cc, j) => (j === ci ? { ...cc, form_a: t } : cc)) } : x)))} placeholder="Form" placeholderTextColor={placeholderColor} style={[pillStyle, { flex: 1 }]} />
                                </View>
                              ))}
                            </>
                          ) : null}

                          {w.rowType === "preposition" ? (
                            <>
                              <TextInput value={w.prepositionTitle} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositionTitle: t } : x)))} placeholder="Title" placeholderTextColor={placeholderColor} style={pillStyle} />
                              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                {(languageConfig.templates ?? []).map((tp) => (
                                  <TouchableOpacity key={tp.id} onPress={() => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositionTemplateId: tp.id, prepositionTitle: tp.title, prepositionGroup: "Prepositions / Contractions", prepositions: tp.entries.map((e) => ({ ...e })) } : x)))}
                                    style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: w.prepositionTemplateId === tp.id ? theme.colors.primary : theme.colors.border, backgroundColor: w.prepositionTemplateId === tp.id ? theme.colors.primarySoft : theme.colors.surface }}>
                                    <Text style={{ fontSize: 11, fontWeight: "700", color: w.prepositionTemplateId === tp.id ? theme.colors.primary : theme.colors.textMuted }}>{tp.title}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                              {w.prepositions.map((p, pi) => (
                                <View key={`${w.key}-p-${pi}`} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                                  <TextInput value={p.left} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositions: x.prepositions.map((pp, j) => (j === pi ? { ...pp, left: t } : pp)) } : x)))} placeholder="A" placeholderTextColor={placeholderColor} style={[pillStyle, { flex: 1 }]} />
                                  <TextInput value={p.right} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositions: x.prepositions.map((pp, j) => (j === pi ? { ...pp, right: t } : pp)) } : x)))} placeholder="B" placeholderTextColor={placeholderColor} style={[pillStyle, { flex: 1 }]} />
                                  <TextInput value={p.answer} onChangeText={(t) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositions: x.prepositions.map((pp, j) => (j === pi ? { ...pp, answer: t } : pp)) } : x)))} placeholder="=" placeholderTextColor={placeholderColor} style={[pillStyle, { flex: 1 }]} />
                                  <TouchableOpacity onPress={() => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositions: x.prepositions.filter((_, j) => j !== pi) } : x)))}>
                                    <Ionicons name="close" size={14} color={theme.colors.danger} />
                                  </TouchableOpacity>
                                </View>
                              ))}
                              <TouchableOpacity onPress={() => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, prepositions: [...x.prepositions, { left: "", right: "", answer: "" }] } : x)))}>
                                <Text style={{ color: theme.colors.primary, fontWeight: "700", fontSize: 12 }}>+ Add line</Text>
                              </TouchableOpacity>
                            </>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}

                  <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                    <TouchableOpacity onPress={() => setWords((prev) => [...prev, makeWord(languagePair, language, "vocab")])} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.primary }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: "#fff" }}>+ Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <AppButton label={isEdit ? "Save Lesson" : "Create Lesson"} onPress={save} loading={saving} />
            </View>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}