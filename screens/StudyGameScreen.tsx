import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationProp, RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import Svg, { Circle } from "react-native-svg";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import GlassCard from "../components/GlassCard";
import AppButton from "../components/AppButton";
import { useAppTheme } from "../lib/theme";
import { clearStoredStudentSessionId } from "../lib/studentSession";
import {
  getAssignedLessons,
  getAssignedTests,
  getStudentSession,
  requestTtsBase64,
  verifyAnswer,
} from "../lib/api/study";
import {
  calculateStreak,
  createRecord,
  gradePercentage,
  pickSessionWords,
  unlockAchievements,
  updateUserStats,
  updateWordStats,
} from "../lib/game/engine";
import { flushProgressSync, hydrateProgress, saveLocalProgress, scheduleProgressSync } from "../lib/game/progress";
import { getDisplayPrompt, getExpectedAnswer, normalizeLessonsToWords, normalizeTestsToWords } from "../lib/game/normalizers";
import type {
  GameWord,
  LessonGamePayload,
  StudyDirection,
  StudyProgress,
  StudySessionMode,
  StudySessionType,
  TestGamePayload,
} from "../types/study-game";

type RootStackParamList = {
  Login: undefined;
  Dashboard: { sessionId?: string } | undefined;
  StudyGame: { sessionId: string };
};

type BottomTab = "home" | "lessons" | "practice" | "tests" | "settings";
type RuntimeScreen = "dashboard" | "lesson-detail" | "test-detail" | "session" | "results";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function localAnswerFallback(expected: string, answer: string, alternatives: string[]) {
  const expNorm = normalizeText(expected);
  const ansNorm = normalizeText(answer);
  const alts = alternatives.map(normalizeText).filter(Boolean);
  if (!ansNorm) return { isCorrect: false, close: false };
  if (ansNorm === expNorm || alts.includes(ansNorm)) return { isCorrect: true, close: false };
  const dist = levenshtein(ansNorm, expNorm);
  const close = expNorm.length > 0 && dist <= Math.max(1, Math.floor(expNorm.length * 0.2));
  return { isCorrect: false, close };
}

function getAcceptedAnswers(target: string, current: GameWord | undefined, direction: StudyDirection) {
  const t = typeof target === "string" ? target.trim() : "";
  const accepted = [t];
  if (direction === "en-pt" && current?.pt_alt?.length) {
    accepted.push(...current.pt_alt.filter(Boolean));
  }
  if (t && /^\s*to\s+/i.test(t)) {
    const bare = t.replace(/^\s*to\s+/i, "").trim();
    if (bare && !accepted.includes(bare)) accepted.push(bare);
  }
  return accepted;
}

function isInfinitiveWord(current: GameWord | undefined, target: string, source: string, targetLang: "pt" | "en") {
  if (!target || typeof target !== "string") return false;
  if (/^\s*to\s+/i.test(target.trim())) return true;
  if (targetLang !== "en") return false;
  return /(ar|er|ir)$/i.test(String(source || "").trim());
}

function maskWord(sentence: string, wordToHide: string) {
  const words = String(wordToHide || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
  return String(sentence || "")
    .split(" ")
    .map((word) => {
      const cleanWord = word.toLowerCase().replace(/[.,!?;:'"()]/g, "");
      if (words.some((w) => cleanWord === w || cleanWord.includes(w))) {
        const punct = word.match(/[.,!?;:'"()]+$/)?.[0] || "";
        const base = word.replace(/[.,!?;:'"()]+$/, "");
        if (!base) return word;
        return `${base[0]} ${Array(Math.max(base.length - 1, 0)).fill("_").join(" ")}${punct}`;
      }
      return word;
    })
    .join(" ");
}

function getLevelInfo(totalXP: number) {
  const levels = [
    { level: 1, name: "Rookie", xpNeeded: 0 },
    { level: 2, name: "Beginner", xpNeeded: 120 },
    { level: 3, name: "Apprentice", xpNeeded: 280 },
    { level: 4, name: "Learner", xpNeeded: 430 },
    { level: 5, name: "Scholar", xpNeeded: 1000 },
    { level: 6, name: "Master", xpNeeded: 1600 },
    { level: 7, name: "Legend", xpNeeded: 2500 },
  ];
  let current = levels[0];
  let next = levels[1] ?? null;
  for (let i = 0; i < levels.length; i += 1) {
    if (totalXP >= levels[i].xpNeeded) {
      current = levels[i];
      next = levels[i + 1] ?? null;
    }
  }
  const xpInLevel = totalXP - current.xpNeeded;
  const xpForLevel = next ? next.xpNeeded - current.xpNeeded : 1;
  const progress = next ? Math.min((xpInLevel / xpForLevel) * 100, 100) : 100;
  return { current, next, xpInLevel, xpForLevel, progress };
}

export default function StudyGameScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "StudyGame">>();
  const sessionId = route.params?.sessionId;

  const [loading, setLoading] = useState(true);
  const [runtimeScreen, setRuntimeScreen] = useState<RuntimeScreen>("dashboard");
  const [activeTab, setActiveTab] = useState<BottomTab>("home");
  const [studentName, setStudentName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [lessonsData, setLessonsData] = useState<LessonGamePayload[]>([]);
  const [testsData, setTestsData] = useState<TestGamePayload[]>([]);
  const [lessonsWords, setLessonsWords] = useState<GameWord[]>([]);
  const [testsWords, setTestsWords] = useState<GameWord[]>([]);
  const [progress, setProgress] = useState<StudyProgress | null>(null);

  const [sessionType, setSessionType] = useState<StudySessionType>("practice");
  const [sessionMode, setSessionMode] = useState<StudySessionMode>("typing");
  const [direction, setDirection] = useState<StudyDirection>("pt-en");
  const [activeWords, setActiveWords] = useState<GameWord[]>([]);
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeWordIds, setMistakeWordIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ state: "correct" | "close" | "wrong"; text: string } | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [resultRecord, setResultRecord] = useState<{ score: number; total: number; percentage: number; passed: boolean } | null>(null);
  const [selectedLessonDetail, setSelectedLessonDetail] = useState<LessonGamePayload | null>(null);
  const [selectedTestDetail, setSelectedTestDetail] = useState<{ type: "test"; test: TestGamePayload } | { type: "lesson"; lesson: LessonGamePayload } | null>(null);
  const [lessonDetailMode, setLessonDetailMode] = useState<StudySessionMode>("typing");
  const [showHint, setShowHint] = useState(false);
  const [needsRetype, setNeedsRetype] = useState(false);
  const [showInfinitiveNote, setShowInfinitiveNote] = useState(false);
  const [geminiCorrection, setGeminiCorrection] = useState("");
  const [sessionContext, setSessionContext] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  const [sessionPool, setSessionPool] = useState<GameWord[]>([]);
  const [savedResume, setSavedResume] = useState<{
    lessonId: string;
    lessonName: string;
    idx: number;
    correctCount: number;
    activeWords: GameWord[];
    sessionType: StudySessionType;
    sessionMode: StudySessionMode;
    direction: StudyDirection;
    pool: GameWord[];
  } | null>(null);
  const audioPlayerRef = useRef<any>(null);
  const audioTempFileRef = useRef<string | null>(null);

  const allWords = useMemo(() => [...lessonsWords, ...testsWords], [lessonsWords, testsWords]);
  const current = activeWords[idx];
  const isFillBlank = current?.promptFormat === "fill_blank";
  const prompt = useMemo(() => {
    if (!current) return "";
    if (isFillBlank) return current.en || "";
    return getDisplayPrompt(current, direction);
  }, [current, direction, isFillBlank]);
  const expected = useMemo(() => {
    if (!current) return "";
    if (isFillBlank) return current.pt || "";
    return getExpectedAnswer(current, direction);
  }, [current, direction, isFillBlank]);
  const sourceLang = isFillBlank ? "en" : direction === "pt-en" ? "pt" : "en";
  const targetLang = isFillBlank ? "pt" : direction === "pt-en" ? "en" : "pt";
  const acceptedAnswers = useMemo(() => getAcceptedAnswers(expected, current, direction), [current, direction, expected]);
  const sentenceHint = useMemo(() => {
    if (!current) return null;
    const sentence = direction === "pt-en" ? current.se : current.sp;
    if (!sentence) return null;
    return maskWord(sentence, expected);
  }, [current, direction, expected]);

  const getWordStat = useCallback(
    (word: GameWord) => {
      const stats = progress?.wordStats ?? {};
      const byId = stats[word.id];
      if (byId) return byId;
      const byPt = word.pt ? stats[word.pt] : undefined;
      if (byPt) return byPt;
      const byEn = word.en ? stats[word.en] : undefined;
      if (byEn) return byEn;
      return undefined;
    },
    [progress?.wordStats]
  );

  const wordsLearned = useMemo(
    () =>
      lessonsWords.reduce((count, word) => {
        const stat = getWordStat(word);
        return count + (stat && stat.total >= 1 ? 1 : 0);
      }, 0),
    [getWordStat, lessonsWords]
  );
  const masteredWords = useMemo(
    () =>
      lessonsWords.reduce((count, word) => {
        const stat = getWordStat(word);
        return count + (stat && stat.total >= 3 && stat.correct / stat.total >= 0.8 ? 1 : 0);
      }, 0),
    [getWordStat, lessonsWords]
  );
  const practicedWords = useMemo(
    () =>
      lessonsWords.reduce((count, word) => {
        const stat = getWordStat(word);
        return count + (stat && stat.total >= 1 ? 1 : 0);
      }, 0),
    [getWordStat, lessonsWords]
  );
  const totalWordsAvailable = lessonsWords.length;
  const overallProgress = totalWordsAvailable > 0 ? Math.round((practicedWords / totalWordsAvailable) * 100) : 0;
  const currentStreak = calculateStreak(progress?.practiceHistory ?? [], progress?.testHistory ?? []);
  const totalXP = useMemo(() => {
    const p = progress?.practiceHistory ?? [];
    const t = progress?.testHistory ?? [];
    return [...p, ...t].reduce((sum, r) => {
      const score = typeof (r as any).score === "number" ? (r as any).score : typeof (r as any).correct === "number" ? (r as any).correct : 0;
      const percentage = typeof (r as any).percentage === "number" ? (r as any).percentage : 0;
      const passed = typeof (r as any).passed === "boolean" ? (r as any).passed : percentage >= 80;
      return sum + (score * 10 + (passed ? 50 : 0));
    }, 0);
  }, [progress?.practiceHistory, progress?.testHistory]);
  const levelInfo = getLevelInfo(totalXP);

  const lessonsOverview = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; cover?: string; total: number; practiced: number; mastered: number }
    >();
    for (const w of lessonsWords) {
      const id = w.lessonId ?? "unknown";
      const key = id;
      const prev = map.get(key) ?? {
        id,
        name: w.lessonName || "Lesson",
        cover: w.imageUrl,
        total: 0,
        practiced: 0,
        mastered: 0,
      };
      prev.total += 1;
      if (!prev.cover && w.imageUrl) prev.cover = w.imageUrl;
      const stat = getWordStat(w);
      if (stat && stat.total > 0) {
        prev.practiced += 1;
        if (stat.total >= 3 && stat.correct / stat.total >= 0.8) prev.mastered += 1;
      }
      map.set(key, prev);
    }
    return Array.from(map.values());
  }, [getWordStat, lessonsWords]);

  const weeklyActivity = useMemo(() => {
    const records = [...(progress?.practiceHistory ?? []), ...(progress?.testHistory ?? [])];
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    return days.map((d) =>
      records.filter((r) => {
        const rawDate = typeof (r as any).date === "string" ? (r as any).date : typeof (r as any).timestamp === "string" ? (r as any).timestamp : "";
        if (!rawDate) return false;
        return rawDate.slice(0, 10) === d;
      }).length
    );
  }, [progress?.practiceHistory, progress?.testHistory]);
  const maxWeekActivity = Math.max(...weeklyActivity, 1);

  const latestTestByLesson = useMemo(() => {
    const map = new Map<string, { percentage: number; date: string }>();
    for (const rec of progress?.testHistory ?? []) {
      const lessonId = (rec as any).lessonId ?? (rec as any).lesson_id ?? (rec as any).lesson?.id ?? "";
      if (!lessonId) continue;
      if (!map.has(lessonId)) {
        map.set(lessonId, {
          percentage: typeof (rec as any).percentage === "number" ? (rec as any).percentage : 0,
          date: typeof (rec as any).date === "string" ? (rec as any).date : typeof (rec as any).timestamp === "string" ? (rec as any).timestamp : "",
        });
      }
    }
    return map;
  }, [progress?.testHistory]);

  const selectedLessonWords = useMemo(() => {
    if (!selectedLessonDetail) return [];
    return lessonsWords.filter((word) => word.lessonId === selectedLessonDetail.id);
  }, [lessonsWords, selectedLessonDetail]);

  const applyProgress = useCallback(
    (next: StudyProgress) => {
      setProgress(next);
      saveLocalProgress(next).catch(() => {});
      if (sessionId) scheduleProgressSync(sessionId, next, 1200);
    },
    [sessionId]
  );

  const triggerHaptic = useCallback(
    async (type: "success" | "warning" | "error") => {
      if (!progress?.preferences.hapticEnabled) return;
      try {
        if (type === "success") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }
        if (type === "warning") {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {
        // ignore haptic failures
      }
    },
    [progress?.preferences.hapticEnabled]
  );

  const callTeacherCompletionEdge = useCallback(
    async (type: "lesson_completed" | "test_completed") => {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
      if (!supabaseUrl || !anonKey || !sessionId) return;
      const edgeUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/send-teacher-completion-email`;
      await fetch(edgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ sessionId, type }),
      }).catch(() => {});
    },
    [sessionId]
  );

  const openLessonDetail = useCallback((lesson: LessonGamePayload) => {
    setSelectedLessonDetail(lesson);
    setLessonDetailMode("typing");
    setRuntimeScreen("lesson-detail");
  }, []);

  const saveResumeData = useCallback(() => {
    if (!selectedLessonDetail || !activeWords.length) return;
    const data = {
      lessonId: selectedLessonDetail.id,
      lessonName: selectedLessonDetail.name,
      idx,
      correctCount,
      activeWords,
      sessionType,
      sessionMode,
      direction,
      pool: sessionPool,
    };
    AsyncStorage.setItem("eluency_lesson_resume", JSON.stringify(data)).catch(() => {});
    setSavedResume(data);
  }, [activeWords, correctCount, direction, idx, selectedLessonDetail, sessionMode, sessionPool, sessionType]);

  const resumeSession = useCallback(() => {
    if (!savedResume) return;
    const lesson = lessonsData.find((l) => l.id === savedResume.lessonId) ?? null;
    setSelectedLessonDetail(lesson);
    setSessionType(savedResume.sessionType);
    setSessionMode(savedResume.sessionMode);
    setDirection(savedResume.direction);
    setActiveWords(savedResume.activeWords);
    setIdx(savedResume.idx);
    setInput("");
    setCorrectCount(savedResume.correctCount);
    setFeedback(null);
    setShowHint(false);
    setNeedsRetype(false);
    setShowInfinitiveNote(false);
    setGeminiCorrection("");
    setSessionContext({ id: savedResume.lessonId, name: savedResume.lessonName });
    setSessionPool(savedResume.pool);
    setRuntimeScreen("session");
  }, [lessonsData, savedResume]);

  const openTestDetailFromTest = useCallback((test: TestGamePayload) => {
    setSelectedTestDetail({ type: "test", test });
    setRuntimeScreen("test-detail");
  }, []);

  const openTestDetailFromLesson = useCallback((lesson: LessonGamePayload) => {
    setSelectedTestDetail({ type: "lesson", lesson });
    setRuntimeScreen("test-detail");
  }, []);

  const startSession = useCallback(
    (
      type: StudySessionType,
      mode: StudySessionMode,
      dir: StudyDirection,
      scopedWords?: GameWord[],
      context?: { id?: string | null; name?: string | null }
    ) => {
      if (!progress) return;
      const baseWords = scopedWords?.length ? scopedWords : allWords;
      const selected = pickSessionWords(
        baseWords,
        type,
        mode,
        progress.preferences.practiceLength || 15,
        mistakeWordIds,
        progress.wordStats
      );
      if (!selected.length) {
        Alert.alert("No content", "No words available for this mode.");
        return;
      }
      setSessionType(type);
      setSessionMode(mode);
      setDirection(dir);
      setActiveWords(selected);
      setIdx(0);
      setInput("");
      setCorrectCount(0);
      setFeedback(null);
      setShowHint(false);
      setNeedsRetype(false);
      setShowInfinitiveNote(false);
      setGeminiCorrection("");
      setSessionContext({ id: context?.id ?? null, name: context?.name ?? null });
      setSessionPool(baseWords);
      setRuntimeScreen("session");
    },
    [allWords, mistakeWordIds, progress]
  );

  const finishSession = useCallback(async () => {
    if (!progress) return;
    const total = activeWords.length;
    const percentage = gradePercentage(correctCount, total);
    const rec = createRecord({
      type: sessionType,
      mode: sessionMode,
      direction,
      lessonId: sessionContext.id,
      lessonName: sessionContext.name,
      correct: correctCount,
      total,
    });

    const practiceHistory = sessionType === "test" ? progress.practiceHistory : [rec, ...progress.practiceHistory];
    const testHistory = sessionType === "test" ? [rec, ...progress.testHistory] : progress.testHistory;
    const streak = calculateStreak(practiceHistory, testHistory);
    const userStats = updateUserStats(progress.userStats, rec, streak);
    const achievements = unlockAchievements(userStats, progress.achievements);

    const nextProgress: StudyProgress = {
      ...progress,
      practiceHistory,
      testHistory,
      userStats,
      achievements,
      dailyChallenge:
        sessionType === "daily-challenge"
          ? { date: new Date().toISOString().slice(0, 10), completed: true, score: percentage }
          : progress.dailyChallenge,
    };
    setProgress(nextProgress);
    await saveLocalProgress(nextProgress);
    if (sessionId) await flushProgressSync(sessionId, nextProgress);
    if (sessionType === "test") callTeacherCompletionEdge("test_completed").catch(() => {});
    if (sessionType === "practice" || sessionType === "smart-review") callTeacherCompletionEdge("lesson_completed").catch(() => {});
    setResultRecord({ score: correctCount, total, percentage, passed: percentage >= 80 });
    setSavedResume(null);
    AsyncStorage.removeItem("eluency_lesson_resume").catch(() => {});
    setRuntimeScreen("results");
  }, [activeWords.length, callTeacherCompletionEdge, correctCount, direction, progress, sessionContext.id, sessionContext.name, sessionId, sessionMode, sessionType]);

  const answerCurrent = useCallback(async () => {
    if (!current || !progress) return;
    const userAnswer = input.trim();
    if (!userAnswer) return;

    const isOpenAnswer = current.answerFormat === "open";
    if (isOpenAnswer) {
      applyProgress({ ...progress, wordStats: updateWordStats(progress.wordStats, current.id, true) });
      triggerHaptic("success").catch(() => {});
      setCorrectCount((v) => v + 1);
      setFeedback({ state: "correct", text: "Answer submitted." });
      setTimeout(() => {
        setFeedback(null);
        setInput("");
        setShowHint(false);
        setNeedsRetype(false);
        setShowInfinitiveNote(false);
        setGeminiCorrection("");
        if (idx + 1 >= activeWords.length) finishSession().catch(() => {});
        else setIdx((v) => v + 1);
      }, 700);
      return;
    }

    if (needsRetype) {
      const matched = acceptedAnswers.some((item) => normalizeText(String(item)) === normalizeText(userAnswer));
      if (!matched) {
        triggerHaptic("error").catch(() => {});
        setInput("");
        setFeedback({ state: "wrong", text: "Type the expected answer to continue." });
        return;
      }
      triggerHaptic("success").catch(() => {});
      setFeedback(null);
      setInput("");
      setShowHint(false);
      setNeedsRetype(false);
      setShowInfinitiveNote(false);
      setGeminiCorrection("");
      if (idx + 1 >= activeWords.length) finishSession().catch(() => {});
      else setIdx((v) => v + 1);
      return;
    }

    let result: "correct" | "close" | "wrong" = "wrong";
    let exactMatch = false;
    let infinitiveNote = false;
    let correction = "";

    const remote = await verifyAnswer({
      correctAnswer: expected,
      userAnswer,
      sourceText: prompt,
      isMarkedInfinitive: isInfinitiveWord(current, expected, prompt, targetLang),
    });

    if (remote) {
      const remoteCorrect = typeof remote.correct === "boolean" ? remote.correct : !!remote.isCorrect;
      result = remoteCorrect ? "correct" : remote.close ? "close" : "wrong";
      exactMatch = remoteCorrect;
      infinitiveNote = !!remote.showInfinitiveNote && remoteCorrect;
      correction =
        typeof remote.correction === "string" ? remote.correction.trim() : typeof remote.feedback === "string" ? remote.feedback.trim() : "";
    } else {
      const fallback = localAnswerFallback(expected, userAnswer, acceptedAnswers.filter((value) => value !== expected));
      result = fallback.isCorrect ? "correct" : fallback.close ? "close" : "wrong";
      exactMatch = fallback.isCorrect;
      infinitiveNote = fallback.isCorrect && isInfinitiveWord(current, expected, prompt, targetLang);
    }

    const correctForStats = result === "correct" || result === "close";
    applyProgress({ ...progress, wordStats: updateWordStats(progress.wordStats, current.id, correctForStats) });
    setShowInfinitiveNote(infinitiveNote);
    setGeminiCorrection(correction);

    if (result === "correct") {
      triggerHaptic("success").catch(() => {});
      setCorrectCount((v) => v + 1);
      setFeedback({ state: "correct", text: "Correct!" });
    } else if (result === "close") {
      triggerHaptic("warning").catch(() => {});
      setCorrectCount((v) => v + 1);
      setFeedback({ state: "close", text: "Almost there. Type the expected answer to continue." });
      setMistakeWordIds((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]));
    } else {
      triggerHaptic("error").catch(() => {});
      setFeedback({ state: "wrong", text: `Expected: ${expected}` });
      setMistakeWordIds((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]));
    }

    if (exactMatch) {
      setTimeout(() => {
        setFeedback(null);
        setInput("");
        setShowHint(false);
        setNeedsRetype(false);
        setShowInfinitiveNote(false);
        setGeminiCorrection("");
        if (idx + 1 >= activeWords.length) finishSession().catch(() => {});
        else setIdx((v) => v + 1);
      }, 700);
      return;
    }

    setNeedsRetype(true);
    setInput("");
  }, [
    acceptedAnswers,
    activeWords.length,
    applyProgress,
    current,
    expected,
    finishSession,
    idx,
    input,
    needsRetype,
    progress,
    prompt,
    targetLang,
    triggerHaptic,
  ]);

  const playPromptAudio = useCallback(async () => {
    if (!current || !sessionId) return;
    const clearPlayer = async () => {
      try {
        audioPlayerRef.current?.pause?.();
      } catch {}
      try {
        audioPlayerRef.current?.remove?.();
      } catch {}
      audioPlayerRef.current = null;
      if (audioTempFileRef.current) {
        await FileSystem.deleteAsync(audioTempFileRef.current, { idempotent: true }).catch(() => {});
        audioTempFileRef.current = null;
      }
    };

    await clearPlayer();

    if (current.audioUrl) {
      const player = createAudioPlayer(current.audioUrl);
      audioPlayerRef.current = player;
      player.play();
      return;
    }

    const text = prompt || current.pt || current.en;
    if (!text) return;
    setTtsLoading(true);
    try {
      const lang = direction === "pt-en" ? "pt-BR" : "en-US";
      const generated = await requestTtsBase64(text, sessionId, lang);
      if (!generated?.data) {
        Alert.alert("Audio", "Gemini did not return playable audio.");
        return;
      }

      const extension = generated.mimeType.includes("mpeg")
        ? "mp3"
        : generated.mimeType.includes("wav")
          ? "wav"
          : "m4a";
      const tempUri = `${FileSystem.cacheDirectory}gemini-tts-${Date.now()}.${extension}`;
      await FileSystem.writeAsStringAsync(tempUri, generated.data, { encoding: "base64" as any });
      audioTempFileRef.current = tempUri;

      const player = createAudioPlayer(tempUri);
      audioPlayerRef.current = player;
      player.addListener?.("playbackStatusUpdate", (status: any) => {
        if (status?.didJustFinish) {
          clearPlayer().catch(() => {});
        }
      });
      player.play();
    } finally {
      setTtsLoading(false);
    }
  }, [current, direction, prompt, sessionId]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "doNotMix",
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!sessionId) {
        Alert.alert("Session", "Session is required.");
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
        return;
      }
      setLoading(true);
      try {
        const session = await getStudentSession(sessionId);
        const [lessons, tests, hydrated] = await Promise.all([
          getAssignedLessons(session.student.assigned_lessons ?? []),
          getAssignedTests(session.student.assigned_tests ?? []),
          hydrateProgress(sessionId),
        ]);
        if (!mounted) return;
        setStudentName(session.student.name);
        setTeacherName(session.teacher?.name ?? "Teacher");
        setLessonsData(lessons);
        setTestsData(tests);
        setLessonsWords(normalizeLessonsToWords(lessons));
        setTestsWords(normalizeTestsToWords(tests));
        setProgress(hydrated);
        const raw = await AsyncStorage.getItem("eluency_lesson_resume").catch(() => null);
        if (raw && mounted) {
          try { setSavedResume(JSON.parse(raw)); } catch {}
        }
      } catch (e) {
        if (!mounted) return;
        clearStoredStudentSessionId().catch(() => {});
        Alert.alert("Error", e instanceof Error ? e.message : "Failed to load study game");
        navigation.reset({ index: 0, routes: [{ name: "Login" }] });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
      try {
        audioPlayerRef.current?.pause?.();
        audioPlayerRef.current?.remove?.();
      } catch {}
    };
  }, [navigation, sessionId]);

  useEffect(() => {
    if (!sessionId || !progress) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") flushProgressSync(sessionId, progress).catch(() => {});
    });
    return () => sub.remove();
  }, [progress, sessionId]);

  useEffect(() => {
    if (runtimeScreen !== "session" || !current) return;
    if (sessionMode === "listening") {
      playPromptAudio().catch(() => {});
    }
  }, [current, playPromptAudio, runtimeScreen, sessionMode]);

  useEffect(() => {
    return () => {
      if (sessionId && progress) flushProgressSync(sessionId, progress).catch(() => {});
    };
  }, [progress, sessionId]);

  if (loading || !progress) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const dailyCompleted = progress.dailyChallenge.date === new Date().toISOString().slice(0, 10) && progress.dailyChallenge.completed;
  const uiIsDark = progress.preferences.darkMode ?? theme.isDark;
  const ui = uiIsDark
    ? {
        bg: "#141414",
        card: "#1F1F1F",
        text: "#F5F5F5",
        muted: "#A0A0A0",
        border: "#343434",
        borderSoft: "#2A2A2A",
        primary: "#F07020",
        primarySoft: "rgba(240,112,32,0.16)",
        secondary: "#D4943C",
        success: "#46A05D",
        warning: "#D4943C",
        danger: "#C05050",
      }
    : {
        bg: "#F4F4F5",
        card: "#FFFFFF",
        text: "#222222",
        muted: "#7A7A7A",
        border: "#E8E8E8",
        borderSoft: "#EFEFEF",
        primary: "#E5621A",
        primarySoft: "#FFF0E6",
        secondary: "#D08A2D",
        success: "#46A05D",
        warning: "#D4943C",
        danger: "#C05050",
      };

  return (
    <View className="flex-1" style={{ backgroundColor: ui.bg }}>
      {runtimeScreen === "dashboard" ? (
        <>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 50,
              backgroundColor: ui.card,
              borderBottomWidth: 1,
              borderBottomColor: ui.border,
              paddingTop: Math.max(insets.top, 8),
              paddingBottom: 10,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            {activeTab !== "home" ? (
              <TouchableOpacity
                onPress={() => setActiveTab("home")}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: ui.border,
                  backgroundColor: ui.card,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 12,
                }}
              >
                <Ionicons name="chevron-back" size={18} color={ui.muted} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40, marginRight: 12 }} />
            )}
            <Text
              style={{
                fontWeight: "800",
                fontSize: 18,
                color: ui.text,
                textTransform: activeTab === "home" ? undefined : "capitalize",
              }}
            >
              {activeTab === "home" ? "Eluency" : activeTab}
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: Math.max(insets.top, 8) + 62, paddingBottom: 108 }}>
            {activeTab === "home" ? (
              <>
                <GlassCard style={{ borderRadius: 18, marginBottom: 14, backgroundColor: ui.card }} padding={14}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View>
                      <Text style={{ fontSize: 26 }}>🎓</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ fontWeight: "800", fontSize: 24, color: ui.text }}>
                        Level {levelInfo.current.level} — {levelInfo.current.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: ui.muted, marginTop: 2 }}>
                        {levelInfo.next
                          ? `${levelInfo.xpInLevel} / ${levelInfo.xpForLevel} XP to Level ${levelInfo.next.level}`
                          : "Max Level"}
                      </Text>
                    </View>
                    <View style={{ backgroundColor: ui.primarySoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 }}>
                      <Text style={{ color: ui.secondary, fontWeight: "800", fontSize: 13 }}>{totalXP} XP</Text>
                    </View>
                  </View>
                  <View style={{ height: 8, backgroundColor: ui.borderSoft, borderRadius: 999, overflow: "hidden", marginTop: 12 }}>
                    <View style={{ height: "100%", width: `${levelInfo.progress}%`, backgroundColor: ui.secondary }} />
                  </View>
                </GlassCard>

                <GlassCard style={{ borderRadius: 22, marginBottom: 14, backgroundColor: ui.card }} padding={18}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View
                      style={{
                        width: 104,
                        height: 104,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Svg width={104} height={104} style={{ position: "absolute" }}>
                        <Circle cx={52} cy={52} r={44} stroke={ui.borderSoft} strokeWidth={8} fill="none" />
                        <Circle
                          cx={52}
                          cy={52}
                          r={44}
                          stroke={ui.primary}
                          strokeWidth={8}
                          fill="none"
                          strokeDasharray={`${2 * Math.PI * 44}`}
                          strokeDashoffset={`${2 * Math.PI * 44 * (1 - Math.min(100, Math.max(0, overallProgress)) / 100)}`}
                          strokeLinecap="round"
                          rotation="-90"
                          origin="52,52"
                        />
                      </Svg>
                      <Text style={{ color: ui.primary, fontWeight: "900", fontSize: 30 }}>{overallProgress}%</Text>
                      <Text style={{ fontSize: 9, color: ui.muted, fontWeight: "700", marginTop: -1 }}>PROGRESS</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: ui.muted, fontSize: 16, marginBottom: 2 }}>Welcome back, {studentName}!</Text>
                      <Text style={{ color: ui.text, fontSize: 22, fontWeight: "800", lineHeight: 28 }}>
                        {overallProgress >= 80 ? "Almost there!" : overallProgress >= 50 ? "Keep it up!" : overallProgress > 0 ? "Great start!" : "Let's begin!"}
                      </Text>
                      <View style={{ flexDirection: "row", marginTop: 12, gap: 20 }}>
                        <View>
                          <Text style={{ fontSize: 22, fontWeight: "800", color: ui.secondary }}>🔥 {currentStreak}</Text>
                          <Text style={{ fontSize: 10, color: ui.muted, fontWeight: "600" }}>Day Streak</Text>
                        </View>
                        <View>
                          <Text style={{ fontSize: 22, fontWeight: "800", color: ui.text }}>📖 {wordsLearned}</Text>
                          <Text style={{ fontSize: 10, color: ui.muted, fontWeight: "600" }}>Words Learned</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: ui.muted, fontWeight: "600", marginTop: 8 }}>Tap for progress</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => !dailyCompleted && startSession("daily-challenge", "typing", "pt-en")}
                    activeOpacity={dailyCompleted ? 1 : 0.9}
                    style={{
                      marginTop: 16,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: dailyCompleted ? ui.success : ui.secondary,
                      backgroundColor: dailyCompleted ? `${ui.success}22` : `${ui.primary}10`,
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: ui.primarySoft, alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                        <Text style={{ fontSize: 18 }}>{dailyCompleted ? "✅" : "⚡"}</Text>
                      </View>
                      <View>
                        <Text style={{ fontWeight: "800", fontSize: 16, color: ui.text }}>Daily Challenge</Text>
                        <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
                          <Text style={{ fontSize: 11, color: ui.muted, backgroundColor: ui.borderSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                            20 words
                          </Text>
                          {!dailyCompleted ? (
                            <Text style={{ fontSize: 11, color: ui.primary, fontWeight: "700", backgroundColor: ui.primarySoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                              +50 bonus XP
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </View>
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: ui.primary, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </View>
                  </TouchableOpacity>
                </GlassCard>

                <GlassCard style={{ borderRadius: 16, marginBottom: 14, backgroundColor: ui.card }} padding={14}>
                  <Text style={{ fontWeight: "700", fontSize: 18, color: ui.text, marginBottom: 10 }}>Activity</Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", height: 46 }}>
                    {weeklyActivity.map((count, i) => (
                      <View key={i} style={{ width: 42, alignItems: "center" }}>
                        <View
                          style={{
                            width: "100%",
                            height: Math.max(6, Math.round((count / maxWeekActivity) * 24)),
                            borderRadius: 999,
                            backgroundColor: count > 0 ? ui.primary : ui.borderSoft,
                          }}
                        />
                        <Text style={{ marginTop: 4, fontSize: 10, color: ui.muted, fontWeight: i === 6 ? "700" : "500" }}>
                          {["W", "T", "F", "S", "S", "M", "T"][i]}
                        </Text>
                      </View>
                    ))}
                  </View>
                </GlassCard>

                {savedResume ? (
                  <TouchableOpacity onPress={resumeSession} activeOpacity={0.85} style={{ marginBottom: 14 }}>
                    <GlassCard style={{ borderRadius: 16, backgroundColor: ui.primarySoft, borderWidth: 1, borderColor: ui.primary }} padding={14}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: ui.primary, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="play" size={20} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11, fontWeight: "700", color: ui.primary, letterSpacing: 1, marginBottom: 2 }}>CONTINUE WHERE YOU LEFT OFF</Text>
                          <Text style={{ fontSize: 16, fontWeight: "800", color: ui.text }} numberOfLines={1}>{savedResume.lessonName}</Text>
                          <Text style={{ fontSize: 12, color: ui.muted, marginTop: 2 }}>Word {savedResume.idx + 1} of {savedResume.activeWords.length}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={ui.primary} />
                      </View>
                    </GlassCard>
                  </TouchableOpacity>
                ) : null}

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={{ fontWeight: "700", fontSize: 20, color: ui.text }}>Lessons</Text>
                  <TouchableOpacity onPress={() => setActiveTab("lessons")}>
                    <Text style={{ fontWeight: "700", fontSize: 16, color: ui.primary }}>View All</Text>
                  </TouchableOpacity>
                </View>

                {lessonsOverview.slice(0, 5).map((lesson) => {
                  const pct = lesson.total > 0 ? Math.round((lesson.practiced / lesson.total) * 100) : 0;
                  const fullLesson = lessonsData.find((l) => l.id === lesson.id);
                  return (
                    <TouchableOpacity key={lesson.id} activeOpacity={0.85} onPress={() => fullLesson && openLessonDetail(fullLesson)}>
                      <GlassCard style={{ borderRadius: 16, marginBottom: 10, backgroundColor: ui.card }} padding={12}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          {lesson.cover ? (
                            <Image
                              source={{ uri: lesson.cover }}
                              style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: ui.borderSoft }}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={{ width: 60, height: 60, borderRadius: 12, backgroundColor: ui.borderSoft, alignItems: "center", justifyContent: "center" }}>
                              <Text style={{ fontSize: 24 }}>📚</Text>
                            </View>
                          )}
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={{ fontWeight: "700", fontSize: 20, color: ui.text }} numberOfLines={1}>{lesson.name}</Text>
                            <View style={{ marginTop: 8, height: 8, borderRadius: 999, backgroundColor: ui.borderSoft, overflow: "hidden" }}>
                              <View style={{ width: `${pct}%`, height: "100%", backgroundColor: ui.primary }} />
                            </View>
                          </View>
                          <View style={{ marginLeft: 10, alignItems: "flex-end" }}>
                            <Text style={{ fontWeight: "800", fontSize: 18, color: ui.primary }}>{pct}%</Text>
                            <Text style={{ color: ui.muted, fontSize: 12 }}>{lesson.practiced}/{lesson.total}</Text>
                          </View>
                        </View>
                      </GlassCard>
                    </TouchableOpacity>
                  );
                })}
              </>
            ) : null}

            {activeTab === "lessons" ? (
              <>
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontWeight: "800", fontSize: 30, color: "#222" }}>Lessons</Text>
                  <Text style={{ color: "#7A7A7A", fontSize: 14, marginTop: 4 }}>Select a lesson to study and practice:</Text>
                </View>
                {lessonsData.map((lesson) => (
                  <GlassCard key={lesson.id} style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 10 }} padding={12}>
                    <TouchableOpacity
                      onPress={() => openLessonDetail(lesson)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                    >
                      {lesson.cover_image_url ? (
                        <Image source={{ uri: lesson.cover_image_url }} style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFEFEF" }} resizeMode="cover" />
                      ) : (
                        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFEFEF", alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 22 }}>📚</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", fontSize: 16, color: "#222" }}>{lesson.name}</Text>
                        <Text style={{ color: "#777", fontSize: 13, marginTop: 2 }}>{lesson.words.length} words</Text>
                      </View>
                      <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: "#FCEDE2", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#E56A1E", fontSize: 18 }}>→</Text>
                      </View>
                    </TouchableOpacity>
                  </GlassCard>
                ))}
              </>
            ) : null}

            {activeTab === "practice" ? (
              <>
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontWeight: "800", fontSize: 30, color: "#222" }}>Practice</Text>
                  <Text style={{ color: "#7A7A7A", fontSize: 14, marginTop: 4 }}>Choose your study mode:</Text>
                </View>
                {[
                  { label: "Typing Practice", type: "practice" as StudySessionType, mode: "typing" as StudySessionMode, icon: "⌨️" },
                  { label: "Multiple Choice", type: "practice" as StudySessionType, mode: "multiple-choice" as StudySessionMode, icon: "✅" },
                  { label: "Listening", type: "practice" as StudySessionType, mode: "listening" as StudySessionMode, icon: "🎧" },
                  { label: "Image Mode", type: "practice" as StudySessionType, mode: "image" as StudySessionMode, icon: "🖼️" },
                  { label: "Review Mistakes", type: "review-mistakes" as StudySessionType, mode: "typing" as StudySessionMode, icon: "🧠" },
                  { label: "Smart Review", type: "smart-review" as StudySessionType, mode: "typing" as StudySessionMode, icon: "✨" },
                ].map((item) => (
                  <GlassCard key={item.label} style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 10 }} padding={12}>
                    <TouchableOpacity onPress={() => startSession(item.type, item.mode, "pt-en")} style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ width: 50, height: 50, borderRadius: 12, backgroundColor: "#FFF0E6", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                        <Text style={{ fontSize: 22 }}>{item.icon}</Text>
                      </View>
                      <Text style={{ flex: 1, fontWeight: "700", fontSize: 16, color: "#222" }}>{item.label}</Text>
                      <Text style={{ color: "#E56A1E", fontSize: 20 }}>›</Text>
                    </TouchableOpacity>
                  </GlassCard>
                ))}
              </>
            ) : null}

            {activeTab === "tests" ? (
              <>
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontWeight: "800", fontSize: 30, color: "#222" }}>Tests</Text>
                  <Text style={{ color: "#7A7A7A", fontSize: 14, marginTop: 4 }}>
                    {testsData.length > 0 ? "Test your knowledge. Select a test or lesson:" : "Test your knowledge without hints. Select a lesson to test:"}
                  </Text>
                </View>

                {testsData.length > 0 ? (
                  <>
                    <Text style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginBottom: 10 }}>Your tests</Text>
                    {testsData.map((item, index) => (
                      <GlassCard key={`${item.id ?? "test"}-${index}`} style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 10 }} padding={12}>
                        <TouchableOpacity
                          onPress={() => openTestDetailFromTest(item)}
                          style={{ flexDirection: "row", alignItems: "center" }}
                        >
                          {item.cover_image_url ? (
                            <Image source={{ uri: item.cover_image_url }} style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFEFEF" }} resizeMode="cover" />
                          ) : (
                            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFEFEF", alignItems: "center", justifyContent: "center" }}>
                              <Text style={{ fontSize: 22 }}>📝</Text>
                            </View>
                          )}
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ fontWeight: "700", color: "#222", fontSize: 15 }}>{item.name}</Text>
                            <Text style={{ fontSize: 12, color: "#777", marginTop: 2 }}>{item.words.length} questions</Text>
                          </View>
                          <Text style={{ color: "#E56A1E", fontSize: 20 }}>→</Text>
                        </TouchableOpacity>
                      </GlassCard>
                    ))}
                    <Text style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginVertical: 10 }}>Test by lesson</Text>
                  </>
                ) : null}

                {lessonsData.map((lesson, index) => {
                  const last = latestTestByLesson.get(lesson.id);
                  const pct = last?.percentage ?? 0;
                  const passed = pct >= 80;
                  return (
                    <GlassCard key={`${lesson.id ?? "lesson"}-${index}`} style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 10 }} padding={12}>
                      <TouchableOpacity
                        onPress={() => openTestDetailFromLesson(lesson)}
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        {lesson.cover_image_url ? (
                          <Image source={{ uri: lesson.cover_image_url }} style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFEFEF" }} resizeMode="cover" />
                        ) : (
                          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: "#EFEFEF", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 22 }}>📘</Text>
                          </View>
                        )}
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ fontWeight: "700", color: "#222", fontSize: 15 }}>{lesson.name}</Text>
                          <Text style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
                            {lesson.words.length} words{last?.date ? ` • Last: ${new Date(last.date).toLocaleDateString()}` : ""}
                          </Text>
                          <View style={{ marginTop: 6, height: 5, borderRadius: 999, backgroundColor: "#E4E4E4", overflow: "hidden" }}>
                            <View style={{ width: `${pct}%`, height: "100%", backgroundColor: pct >= 80 ? "#46A05D" : pct >= 50 ? "#D4943C" : "#C05050" }} />
                          </View>
                        </View>
                        <View style={{ marginLeft: 8, alignItems: "flex-end" }}>
                          <Text style={{ fontWeight: "800", color: passed ? "#46A05D" : pct >= 50 ? "#D4943C" : "#777", fontSize: 13 }}>
                            {last ? `${pct}%` : "NOT TAKEN"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </GlassCard>
                  );
                })}

                {progress.testHistory.length > 0 ? (
                  <>
                    <Text style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginTop: 10, marginBottom: 10 }}>Test history</Text>
                    {progress.testHistory.slice(0, 5).map((record, index) => (
                      <GlassCard key={`${record.id ?? record.lessonId ?? "history"}-${index}`} style={{ borderRadius: 14, backgroundColor: "#FFFFFF", marginBottom: 10 }} padding={12}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <View style={{ flex: 1, marginRight: 10 }}>
                            <Text style={{ fontWeight: "600", color: "#222" }} numberOfLines={1}>{record.lessonName || "Lesson test"}</Text>
                            <Text style={{ color: "#7A7A7A", fontSize: 12, marginTop: 2 }}>
                              {record.date ? new Date(record.date).toLocaleDateString() : ""} • {record.direction === "pt-en" ? "BR → EN" : "EN → BR"}
                            </Text>
                          </View>
                          <View
                            style={{
                              backgroundColor: record.percentage >= 80 ? "#E9F7EE" : record.percentage >= 50 ? "#FDF3E5" : "#FDEDED",
                              borderRadius: 999,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                            }}
                          >
                            <Text style={{ fontWeight: "800", color: record.percentage >= 80 ? "#46A05D" : record.percentage >= 50 ? "#D4943C" : "#C05050" }}>
                              {record.percentage}%
                            </Text>
                          </View>
                        </View>
                      </GlassCard>
                    ))}
                  </>
                ) : null}
              </>
            ) : null}

            {activeTab === "settings" ? (
              <>
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontWeight: "800", fontSize: 30, color: "#222" }}>Settings</Text>
                </View>

                <GlassCard style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 12 }} padding={14}>
                  <Text style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginBottom: 10 }}>Profile</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: "#FCEDE2", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 24 }}>👤</Text>
                    </View>
                    <View>
                      <Text style={{ fontWeight: "700", fontSize: 18, color: "#222" }}>{studentName || "Student"}</Text>
                      <Text style={{ color: "#777", fontSize: 13, marginTop: 2 }}>Learning Portuguese</Text>
                    </View>
                  </View>
                </GlassCard>

                <GlassCard style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 12 }} padding={14}>
                  <Text style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginBottom: 10 }}>Teacher Information</Text>
                  <Text style={{ fontWeight: "600", color: "#222" }}>{teacherName}</Text>
                  <Text style={{ color: "#777", marginTop: 2 }}>Contact your teacher for lesson assignments and progress.</Text>
                </GlassCard>

                <GlassCard style={{ borderRadius: 16, backgroundColor: "#FFFFFF", marginBottom: 12 }} padding={14}>
                  <Text style={{ fontSize: 11, color: "#777", textTransform: "uppercase", letterSpacing: 1.2, fontWeight: "700", marginBottom: 10 }}>Preferences</Text>
                  <TouchableOpacity
                    onPress={() =>
                      applyProgress({
                        ...progress,
                        preferences: { ...progress.preferences, darkMode: !progress.preferences.darkMode },
                      })
                    }
                    style={{ borderTopWidth: 1, borderTopColor: "#EFEFEF", paddingTop: 10, paddingBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <View>
                      <Text style={{ fontWeight: "600", color: "#222" }}>Dark Mode</Text>
                      <Text style={{ color: "#777", fontSize: 12, marginTop: 3 }}>Use dark color palette</Text>
                    </View>
                    <View style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: progress.preferences.darkMode ? "#E56A1E" : "#D9D9D9", justifyContent: "center", paddingHorizontal: 3 }}>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: "#fff",
                          alignSelf: progress.preferences.darkMode ? "flex-end" : "flex-start",
                        }}
                      />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      applyProgress({
                        ...progress,
                        preferences: { ...progress.preferences, hapticEnabled: !progress.preferences.hapticEnabled },
                      })
                    }
                    style={{ paddingTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                  >
                    <View>
                      <Text style={{ fontWeight: "600", color: "#222" }}>Haptic Feedback</Text>
                      <Text style={{ color: "#777", fontSize: 12, marginTop: 3 }}>Vibrate on interactions</Text>
                    </View>
                    <View style={{ width: 52, height: 30, borderRadius: 15, backgroundColor: progress.preferences.hapticEnabled ? "#46A05D" : "#D9D9D9", justifyContent: "center", paddingHorizontal: 3 }}>
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: "#fff",
                          alignSelf: progress.preferences.hapticEnabled ? "flex-end" : "flex-start",
                        }}
                      />
                    </View>
                  </TouchableOpacity>
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: "#777", fontSize: 12 }}>Current app theme: {theme.isDark ? "Dark" : "Light"}</Text>
                  </View>
                </GlassCard>

                <TouchableOpacity
                  onPress={() => {
                    clearStoredStudentSessionId().catch(() => {});
                    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
                  }}
                  style={{ borderRadius: 14, borderWidth: 1, borderColor: "#D16060", backgroundColor: "#FDEEEE", paddingVertical: 14, alignItems: "center", marginBottom: 8 }}
                >
                  <Text style={{ color: "#C05050", fontWeight: "700", fontSize: 15 }}>Log out</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </>
      ) : null}

      {runtimeScreen === "lesson-detail" && selectedLessonDetail ? (
        <>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 50,
              backgroundColor: ui.card,
              borderBottomWidth: 1,
              borderBottomColor: ui.border,
              paddingTop: Math.max(insets.top, 8),
              paddingBottom: 10,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <TouchableOpacity
              onPress={() => { setRuntimeScreen("dashboard"); setActiveTab("lessons"); }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: ui.border,
                backgroundColor: ui.card,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              <Ionicons name="chevron-back" size={18} color={ui.muted} />
            </TouchableOpacity>
            <Text style={{ fontWeight: "800", fontSize: 18, color: ui.text }}>Lesson</Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: Math.max(insets.top, 8) + 62, paddingBottom: 108 }}>
            <GlassCard style={{ borderRadius: 18, backgroundColor: ui.card, marginBottom: 12 }} padding={14}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {selectedLessonDetail.cover_image_url ? (
                  <Image source={{ uri: selectedLessonDetail.cover_image_url }} style={{ width: 66, height: 66, borderRadius: 14, backgroundColor: ui.borderSoft }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 66, height: 66, borderRadius: 14, backgroundColor: ui.borderSoft, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24 }}>📚</Text>
                  </View>
                )}
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={{ color: ui.text, fontWeight: "800", fontSize: 24 }}>{selectedLessonDetail.name}</Text>
                  <Text style={{ color: ui.muted, marginTop: 4, fontSize: 14 }}>{selectedLessonDetail.words.length} words</Text>
                </View>
              </View>
            </GlassCard>

            {selectedLessonDetail.document_url ? (
              <GlassCard style={{ borderRadius: 16, backgroundColor: ui.card, marginBottom: 12 }} padding={12}>
                <TouchableOpacity
                  onPress={() => Linking.openURL(selectedLessonDetail.document_url!).catch(() => {})}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                >
                  <Text style={{ color: ui.primary, fontWeight: "700", fontSize: 16 }} numberOfLines={1}>
                    📄 {selectedLessonDetail.document_name || "Lesson document"}
                  </Text>
                  <Text style={{ color: ui.primary, fontSize: 20 }}>→</Text>
                </TouchableOpacity>
              </GlassCard>
            ) : null}

            {savedResume && savedResume.lessonId === selectedLessonDetail?.id ? (
              <TouchableOpacity onPress={resumeSession} activeOpacity={0.85} style={{ marginBottom: 14 }}>
                <GlassCard style={{ borderRadius: 16, backgroundColor: ui.primarySoft, borderWidth: 1, borderColor: ui.primary }} padding={14}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: ui.primary, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="play" size={20} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: ui.primary, letterSpacing: 1, marginBottom: 2 }}>CONTINUE WHERE YOU LEFT OFF</Text>
                      <Text style={{ fontSize: 15, fontWeight: "800", color: ui.text }}>Word {savedResume.idx + 1} of {savedResume.activeWords.length}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={ui.primary} />
                  </View>
                </GlassCard>
              </TouchableOpacity>
            ) : null}

            <GlassCard style={{ borderRadius: 18, backgroundColor: ui.card, marginBottom: 14 }} padding={12}>
              <Text style={{ color: ui.text, textAlign: "center", fontWeight: "600", marginBottom: 10 }}>Choose how you want to study</Text>
              <View style={{ flexDirection: "row", borderWidth: 1, borderColor: ui.border, borderRadius: 12, padding: 4, marginBottom: 12 }}>
                {[
                  { key: "typing" as StudySessionMode, label: "Typing" },
                  { key: "multiple-choice" as StudySessionMode, label: "Choice" },
                  { key: "listening" as StudySessionMode, label: "Listen" },
                  { key: "image" as StudySessionMode, label: "Images" },
                ].map((mode) => {
                  const selected = lessonDetailMode === mode.key;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      onPress={() => setLessonDetailMode(mode.key)}
                      style={{ flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center", backgroundColor: selected ? ui.primarySoft : "transparent" }}
                    >
                      <Text style={{ fontWeight: "700", color: selected ? ui.primary : ui.muted, fontSize: 13 }}>{mode.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: ui.text, textAlign: "center", fontWeight: "600", marginBottom: 10 }}>Choose a direction to begin the lesson</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() =>
                    startSession("practice", lessonDetailMode, "pt-en", selectedLessonWords, {
                      id: selectedLessonDetail.id,
                      name: selectedLessonDetail.name,
                    })
                  }
                  style={{ flex: 1, borderRadius: 10, backgroundColor: ui.primary, paddingVertical: 10, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>BR → EN</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    startSession("practice", lessonDetailMode, "en-pt", selectedLessonWords, {
                      id: selectedLessonDetail.id,
                      name: selectedLessonDetail.name,
                    })
                  }
                  style={{ flex: 1, borderRadius: 10, borderWidth: 1.5, borderColor: ui.primary, backgroundColor: ui.card, paddingVertical: 10, alignItems: "center" }}
                >
                  <Text style={{ color: ui.primary, fontWeight: "700", fontSize: 14 }}>EN → BR</Text>
                </TouchableOpacity>
              </View>
            </GlassCard>

            <Text style={{ color: ui.muted, fontSize: 14, fontWeight: "800", marginBottom: 8 }}>VOCABULARY ({selectedLessonDetail.words.length})</Text>
            {selectedLessonDetail.words.map((word, index) => (
              <GlassCard key={`${selectedLessonDetail.id}-word-${index}`} style={{ borderRadius: 16, backgroundColor: ui.card, marginBottom: 10 }} padding={12}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {(word.image_url || word.img) ? (
                    <Image source={{ uri: word.image_url || word.img || "" }} style={{ width: 54, height: 54, borderRadius: 10, backgroundColor: ui.borderSoft }} resizeMode="cover" />
                  ) : (
                    <View style={{ width: 54, height: 54, borderRadius: 10, backgroundColor: ui.borderSoft, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 20 }}>📘</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: ui.text, fontWeight: "800", fontSize: 20 }}>BR  {word.pt || "-"}</Text>
                    <Text style={{ color: ui.muted, fontSize: 18, marginTop: 2 }}>US  {word.en || "-"}</Text>
                  </View>
                </View>
                {(word.sp || word.se) ? (
                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: ui.borderSoft, paddingTop: 10 }}>
                    {word.sp ? <Text style={{ color: ui.text, fontSize: 14, marginBottom: 4 }}>BR  {word.sp}</Text> : null}
                    {word.se ? <Text style={{ color: ui.muted, fontSize: 14 }}>US  {word.se}</Text> : null}
                  </View>
                ) : null}
              </GlassCard>
            ))}
          </ScrollView>
        </>
      ) : null}

      {runtimeScreen === "test-detail" && selectedTestDetail ? (
        <>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 50,
              backgroundColor: ui.card,
              borderBottomWidth: 1,
              borderBottomColor: ui.border,
              paddingTop: Math.max(insets.top, 8),
              paddingBottom: 10,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <TouchableOpacity
              onPress={() => { setRuntimeScreen("dashboard"); setActiveTab("tests"); }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: ui.border,
                backgroundColor: ui.card,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              <Ionicons name="chevron-back" size={18} color={ui.muted} />
            </TouchableOpacity>
            <Text style={{ fontWeight: "800", fontSize: 18, color: ui.text }}>Test</Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: Math.max(insets.top, 8) + 62, paddingBottom: 108 }}>
            <GlassCard style={{ borderRadius: 18, backgroundColor: ui.card, marginBottom: 12 }} padding={14}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {selectedTestDetail.type === "test" && selectedTestDetail.test.cover_image_url ? (
                  <Image source={{ uri: selectedTestDetail.test.cover_image_url }} style={{ width: 66, height: 66, borderRadius: 14, backgroundColor: ui.borderSoft }} resizeMode="cover" />
                ) : selectedTestDetail.type === "lesson" && selectedTestDetail.lesson.cover_image_url ? (
                  <Image source={{ uri: selectedTestDetail.lesson.cover_image_url }} style={{ width: 66, height: 66, borderRadius: 14, backgroundColor: ui.borderSoft }} resizeMode="cover" />
                ) : (
                  <View style={{ width: 66, height: 66, borderRadius: 14, backgroundColor: ui.borderSoft, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24 }}>📝</Text>
                  </View>
                )}
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={{ color: ui.text, fontWeight: "800", fontSize: 24 }}>
                    {selectedTestDetail.type === "test" ? selectedTestDetail.test.name : selectedTestDetail.lesson.name}
                  </Text>
                  <Text style={{ color: ui.muted, marginTop: 4, fontSize: 14 }}>
                    {selectedTestDetail.type === "test"
                      ? `${(selectedTestDetail.test.reviewVocabulary?.length || selectedTestDetail.test.words.length)} words • No hints`
                      : `${selectedTestDetail.lesson.words.length} words • No hints`}
                  </Text>
                </View>
              </View>
            </GlassCard>

            <GlassCard style={{ borderRadius: 16, backgroundColor: ui.card, marginBottom: 14 }} padding={12}>
              <TouchableOpacity
                onPress={() => {
                  if (selectedTestDetail.type === "test") {
                    const testWords = normalizeTestsToWords([selectedTestDetail.test]).filter((word) => word.sourceType === "test");
                    startSession("test", "typing", "en-pt", testWords, {
                      id: selectedTestDetail.test.id,
                      name: selectedTestDetail.test.name,
                    });
                    return;
                  }
                  startSession(
                    "test",
                    "typing",
                    "en-pt",
                    lessonsWords.filter((word) => word.lessonId === selectedTestDetail.lesson.id),
                    { id: selectedTestDetail.lesson.id, name: selectedTestDetail.lesson.name }
                  );
                }}
                style={{ borderRadius: 14, backgroundColor: ui.primary, paddingVertical: 14, alignItems: "center" }}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>Begin Test</Text>
              </TouchableOpacity>
            </GlassCard>

            <Text style={{ color: ui.muted, fontSize: 14, fontWeight: "800", marginBottom: 8 }}>
              STUDY MATERIAL (
              {selectedTestDetail.type === "test"
                ? (selectedTestDetail.test.reviewVocabulary?.length || selectedTestDetail.test.words.length)
                : selectedTestDetail.lesson.words.length}
              )
            </Text>
            {(selectedTestDetail.type === "test"
              ? ((selectedTestDetail.test.reviewVocabulary?.length ? selectedTestDetail.test.reviewVocabulary : selectedTestDetail.test.words) as any[])
              : (selectedTestDetail.lesson.words as any[])
            ).map((word, index) => (
              <GlassCard key={`study-${index}`} style={{ borderRadius: 16, backgroundColor: ui.card, marginBottom: 10 }} padding={12}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {(word.image_url || word.img) ? (
                    <Image source={{ uri: word.image_url || word.img || "" }} style={{ width: 54, height: 54, borderRadius: 10, backgroundColor: ui.borderSoft }} resizeMode="cover" />
                  ) : (
                    <View style={{ width: 54, height: 54, borderRadius: 10, backgroundColor: ui.borderSoft, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 20 }}>📘</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: ui.text, fontWeight: "800", fontSize: 20 }}>BR  {word.pt || "-"}</Text>
                    <Text style={{ color: ui.muted, fontSize: 18, marginTop: 2 }}>US  {word.en || "-"}</Text>
                  </View>
                </View>
                {(word.sp || word.se) ? (
                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: ui.borderSoft, paddingTop: 10 }}>
                    {word.sp ? <Text style={{ color: ui.text, fontSize: 14, marginBottom: 4 }}>BR  {word.sp}</Text> : null}
                    {word.se ? <Text style={{ color: ui.muted, fontSize: 14 }}>US  {word.se}</Text> : null}
                  </View>
                ) : null}
              </GlassCard>
            ))}
          </ScrollView>
        </>
      ) : null}

      {runtimeScreen === "session" && current ? (
        <View style={{ flex: 1 }}>
          {/* Fixed top bar — stays in place when keyboard opens */}
          <View
            style={{
              paddingTop: Math.max(insets.top, 4),
              paddingBottom: 4,
              paddingHorizontal: 12,
              borderBottomWidth: 1,
              borderBottomColor: ui.border,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  "Exit Session?",
                  "Your progress in this session will be lost.",
                  [
                    { text: "Keep Going", style: "cancel" },
                    {
                      text: "Exit",
                      style: "destructive",
                      onPress: () => {
                        if (selectedLessonDetail) {
                          saveResumeData();
                          setRuntimeScreen("lesson-detail");
                        } else if (selectedTestDetail) {
                          setRuntimeScreen("test-detail");
                        } else {
                          setRuntimeScreen("dashboard");
                        }
                      },
                    },
                  ]
                )
              }
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: ui.border,
                backgroundColor: ui.card,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={13} color={ui.muted} />
            </TouchableOpacity>

            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: ui.primarySoft }}>
              <Text style={{ fontWeight: "800", color: ui.primary, fontSize: 13 }}>{correctCount}/{idx + 1}</Text>
            </View>

            <View style={{ width: 28 }} />
          </View>

          {/* Keyboard-aware content area */}
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            {/* Scrollable question card */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
              <GlassCard style={{ borderRadius: 22, backgroundColor: ui.card }} padding={14}>
                {/* Lesson title + mode label on same row */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <View style={{ borderRadius: 999, backgroundColor: ui.primarySoft, paddingHorizontal: 10, paddingVertical: 3, flexShrink: 1, marginRight: 8 }}>
                    <Text style={{ color: ui.primary, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
                      {current.lessonName || current.testName || "Lesson"}
                    </Text>
                  </View>
                  <Text style={{ color: ui.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.5 }}>
                    {sessionMode === "listening" ? "LISTEN" : sessionMode === "image" ? "LOOK" : isFillBlank ? "FILL BLANK" : "TRANSLATE"}
                  </Text>
                </View>

                {(sessionMode !== "listening" || current.imageUrl) ? (
                  <View style={{ alignItems: "center", marginBottom: 10 }}>
                    <View
                      style={{
                        width: sessionMode === "image" ? 220 : 150,
                        height: sessionMode === "image" ? 220 : 150,
                        borderRadius: sessionMode === "image" ? 28 : 22,
                        backgroundColor: ui.borderSoft,
                        alignItems: "center",
                        justifyContent: "center",
                        overflow: "hidden",
                      }}
                    >
                      {current.imageUrl ? (
                        <Image source={{ uri: current.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: sessionMode === "image" ? 60 : 48 }}>{current.sourceType === "test" ? "📝" : "📚"}</Text>
                      )}
                    </View>
                  </View>
                ) : null}

                {/* Word + audio button inline, centred as a unit */}
                <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", marginBottom: 10, paddingHorizontal: 4 }}>
                  <Text
                    style={{
                      flexShrink: 1,
                      fontSize: 30,
                      color: ui.text,
                      fontWeight: "900",
                      lineHeight: 36,
                      textAlign: "center",
                    }}
                  >
                    {sessionMode === "listening" ? "Tap to listen" : prompt}
                  </Text>
                  <TouchableOpacity
                    onPress={() => playPromptAudio().catch(() => {})}
                    disabled={ttsLoading}
                    style={{ marginLeft: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: ui.borderSoft, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                  >
                    <Ionicons name="volume-medium-outline" size={16} color={ui.muted} />
                  </TouchableOpacity>
                </View>

                {sessionType !== "test" ? (
                  <TouchableOpacity
                    onPress={() => setShowHint((v) => !v)}
                    style={{ borderRadius: 10, borderWidth: 1, borderColor: ui.border, backgroundColor: ui.card, paddingVertical: 11, alignItems: "center" }}
                  >
                    <Text style={{ color: ui.muted, fontWeight: "600", fontSize: 13 }}>💡 {showHint ? "Hide Hint" : "Show Hint"}</Text>
                  </TouchableOpacity>
                ) : null}

                {showHint && sentenceHint ? (
                  <View style={{ marginTop: 10, borderRadius: 10, backgroundColor: ui.primarySoft, padding: 10 }}>
                    <Text style={{ color: ui.text, fontSize: 13 }}>{sentenceHint}</Text>
                  </View>
                ) : null}

                {showInfinitiveNote ? (
                  <View style={{ marginTop: 10, borderRadius: 10, backgroundColor: ui.primarySoft, padding: 10 }}>
                    <Text style={{ color: ui.text, fontSize: 13 }}>Infinitives in English often use to + verb.</Text>
                  </View>
                ) : null}

                {geminiCorrection ? (
                  <View style={{ marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: ui.border, backgroundColor: ui.card, padding: 10 }}>
                    <Text style={{ color: ui.text, fontSize: 13 }}>{geminiCorrection}</Text>
                  </View>
                ) : null}
              </GlassCard>
            </ScrollView>

            {/* Pinned bottom: input + feedback + submit/skip + progress — always visible above keyboard */}
            <View
              style={{
                paddingHorizontal: 16,
                paddingTop: 2,
                paddingBottom: Math.max(insets.bottom, 1),
                borderTopWidth: 1,
                borderTopColor: ui.border,
                backgroundColor: ui.bg,
                gap: 5,
              }}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={needsRetype ? "Type the exact answer..." : "Type your answer..."}
                placeholderTextColor="#98A0B2"
                style={{
                  borderWidth: 1,
                  borderColor: ui.border,
                  borderRadius: 10,
                  backgroundColor: ui.card,
                  color: ui.text,
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  fontSize: 15,
                }}
              />

              {feedback ? (
                <View style={{ padding: 8, borderRadius: 8, borderWidth: 1, borderColor: feedback.state === "correct" ? ui.success : feedback.state === "close" ? ui.warning : ui.danger }}>
                  <Text style={{ fontWeight: "700", fontSize: 13, color: feedback.state === "correct" ? ui.success : feedback.state === "close" ? ui.warning : ui.danger }}>
                    {feedback.text}
                  </Text>
                </View>
              ) : null}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => answerCurrent().catch(() => {})}
                  style={{ flex: 1, borderRadius: 12, backgroundColor: ui.primary, paddingVertical: 10, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>Submit ↵</Text>
                </TouchableOpacity>
                {sessionMode !== "listening" || sessionType === "test" ? (
                  <TouchableOpacity
                    onPress={() => {
                      applyProgress({ ...progress, wordStats: updateWordStats(progress.wordStats, current.id, false) });
                      triggerHaptic("error").catch(() => {});
                      setMistakeWordIds((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]));
                      setFeedback({ state: "wrong", text: `Expected: ${expected}` });
                      if (sessionType === "test") {
                        setTimeout(() => {
                          setFeedback(null);
                          setInput("");
                          setShowHint(false);
                          setNeedsRetype(false);
                          setShowInfinitiveNote(false);
                          setGeminiCorrection("");
                          if (idx + 1 >= activeWords.length) finishSession().catch(() => {});
                          else setIdx((v) => v + 1);
                        }, 2000);
                        return;
                      }
                      setNeedsRetype(true);
                      setInput("");
                    }}
                    style={{ borderRadius: 12, borderWidth: 1, borderColor: ui.border, backgroundColor: ui.card, paddingHorizontal: 14, justifyContent: "center", alignItems: "center" }}
                  >
                    <Text style={{ color: ui.muted, fontWeight: "600", fontSize: 14 }}>Skip</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 18 }}>🦉</Text>
                <Text style={{ color: ui.muted, fontWeight: "600", fontSize: 11 }}>{idx + 1}/{activeWords.length}</Text>
                <View style={{ flex: 1, height: 4, borderRadius: 999, overflow: "hidden", backgroundColor: ui.borderSoft }}>
                  <View style={{ width: `${((idx + 1) / Math.max(1, activeWords.length)) * 100}%`, height: "100%", backgroundColor: ui.primary }} />
                </View>
                <Text style={{ fontSize: 14 }}>🎓</Text>
                <View style={{ width: 48, height: 4, borderRadius: 999, overflow: "hidden", backgroundColor: ui.borderSoft }}>
                  <View style={{ width: `${levelInfo.progress}%`, height: "100%", backgroundColor: ui.secondary }} />
                </View>
                <Text style={{ color: ui.muted, fontWeight: "700", fontSize: 11 }}>Lv.{levelInfo.current.level}</Text>
              </View>

            </View>
          </KeyboardAvoidingView>
        </View>
      ) : null}

      {(runtimeScreen === "dashboard" || runtimeScreen === "lesson-detail" || runtimeScreen === "test-detail") ? (() => {
        const effectiveTab =
          runtimeScreen === "lesson-detail" ? "lessons" :
          runtimeScreen === "test-detail" ? "tests" :
          activeTab;

        const handleTabPress = (tabId: string) => {
          setActiveTab(tabId as BottomTab);
          setRuntimeScreen("dashboard");
        };

        const barBottom = Math.max(insets.bottom - 32, 0);
        const tabs = [
          { id: "home", icon: "home-outline", label: "Home" },
          { id: "lessons", icon: "book-outline", label: "Lessons" },
          { id: "__play__", icon: "play", label: "" },
          { id: "tests", icon: "clipboard-outline", label: "Tests" },
          { id: "settings", icon: "settings-outline", label: "Settings" },
        ];

        return (
          <View
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: barBottom,
              borderRadius: 32,
              overflow: "hidden",
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 8 },
              elevation: 12,
            }}
          >
            <BlurView
              intensity={Platform.OS === "ios" ? 60 : 100}
              tint={uiIsDark ? "dark" : "light"}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-around",
                paddingVertical: 18,
                paddingHorizontal: 10,
                backgroundColor: Platform.OS === "android"
                  ? uiIsDark ? "rgba(31,31,31,0.97)" : "rgba(255,255,255,0.97)"
                  : "transparent",
              }}
            >
              {tabs.map((tab) => {
                if (tab.id === "__play__") {
                  return (
                    <TouchableOpacity
                      key="play"
                      onPress={() => handleTabPress("practice")}
                      activeOpacity={0.85}
                      style={{
                        width: 76,
                        height: 76,
                        borderRadius: 24,
                        backgroundColor: ui.primary,
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: -5,
                        shadowColor: ui.primary,
                        shadowOpacity: 0.55,
                        shadowRadius: 14,
                        shadowOffset: { width: 0, height: 7 },
                        elevation: 10,
                        borderWidth: 4,
                        borderColor: uiIsDark ? "#141414" : "#FFFFFF",
                      }}
                    >
                      <Ionicons name="play" size={40} color="#fff" />
                    </TouchableOpacity>
                  );
                }

                const active = effectiveTab === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => handleTabPress(tab.id)}
                    activeOpacity={0.75}
                    style={{ alignItems: "center", minWidth: 60, paddingVertical: 2 }}
                  >
                    <View
                      style={{
                        width: 54,
                        height: 40,
                        borderRadius: 14,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: active ? ui.primarySoft : "transparent",
                      }}
                    >
                      <Ionicons name={tab.icon as any} size={28} color={active ? ui.primary : ui.muted} />
                    </View>
                    <Text
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        color: active ? ui.primary : ui.muted,
                        fontWeight: active ? "800" : "500",
                        letterSpacing: 0.2,
                      }}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </BlurView>
          </View>
        );
      })() : null}

      {runtimeScreen === "results" && resultRecord ? (
        <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
          <GlassCard style={{ borderRadius: 16 }} padding={16}>
            <Text style={[theme.typography.label, { marginBottom: 6 }]}>Session complete</Text>
            <Text style={[theme.typography.title, { fontSize: 24 }]}>{resultRecord.percentage}%</Text>
            <Text style={[theme.typography.body, { marginTop: 8 }]}>
              {resultRecord.score} / {resultRecord.total} correct
            </Text>
            {sessionType === "test" ? (
              <Text style={[theme.typography.bodyStrong, { marginTop: 8, color: resultRecord.passed ? theme.colors.success : theme.colors.danger }]}>
                {resultRecord.passed ? "Passed" : "Not passed"}
              </Text>
            ) : null}
            <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppButton
                  label="Back home"
                  onPress={() => {
                    setRuntimeScreen("dashboard");
                    setActiveTab("home");
                    setResultRecord(null);
                  }}
                />
              </View>
              <TouchableOpacity
                onPress={() => startSession(sessionType, sessionMode, direction, sessionPool, sessionContext)}
                style={{ justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#DDD" }}
              >
                <Text style={{ fontWeight: "700", color: "#333" }}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      ) : null}
    </View>
  );
}