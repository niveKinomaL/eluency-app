import type {
  GameWord,
  StudyDirection,
  StudyProgress,
  StudyRecord,
  StudySessionMode,
  StudySessionType,
  UserStats,
} from "../../types/study-game";

export const ACHIEVEMENTS = [
  { id: "first_session", label: "First Session", condition: (s: UserStats) => s.totalSessions >= 1 },
  { id: "five_sessions", label: "5 Sessions", condition: (s: UserStats) => s.totalSessions >= 5 },
  { id: "first_test_pass", label: "First Test Pass", condition: (s: UserStats) => s.passedTests >= 1 },
  { id: "streak_3", label: "3 Day Streak", condition: (s: UserStats) => s.maxStreak >= 3 },
  { id: "daily_3", label: "3 Daily Challenges", condition: (s: UserStats) => s.dailyChallengesCompleted >= 3 },
] as const;

export function pickSessionWords(
  allWords: GameWord[],
  type: StudySessionType,
  mode: StudySessionMode,
  practiceLength: number,
  mistakes: string[],
  wordStats: StudyProgress["wordStats"]
) {
  const modeFiltered = allWords.filter((w) => {
    if (mode === "listening") return !!w.audioUrl;
    if (mode === "image") return !!w.imageUrl;
    if (mode === "multiple-choice") return true;
    return true;
  });
  const source = modeFiltered.length ? modeFiltered : allWords;
  if (type === "review-mistakes") {
    const byId = new Set(mistakes);
    return source.filter((w) => byId.has(w.id)).slice(0, Math.max(10, practiceLength));
  }
  if (type === "smart-review") {
    return [...source]
      .sort((a, b) => {
        const sa = wordStats[a.id];
        const sb = wordStats[b.id];
        const aa = sa?.total ? sa.correct / sa.total : 0;
        const bb = sb?.total ? sb.correct / sb.total : 0;
        return aa - bb;
      })
      .slice(0, Math.max(10, practiceLength));
  }
  if (type === "daily-challenge") {
    return [...source].sort(() => Math.random() - 0.5).slice(0, 12);
  }
  if (type === "test") return source.slice(0, Math.max(10, practiceLength));
  return source.slice(0, Math.max(5, practiceLength));
}

export function gradePercentage(correct: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

export function createRecord(args: {
  type: StudySessionType;
  mode: StudySessionMode;
  direction: StudyDirection;
  lessonId?: string | null;
  lessonName?: string | null;
  correct: number;
  total: number;
}): StudyRecord {
  const percentage = gradePercentage(args.correct, args.total);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    type: args.type,
    mode: args.mode,
    direction: args.direction,
    lessonId: args.lessonId ?? null,
    lessonName: args.lessonName ?? null,
    score: args.correct,
    totalWords: args.total,
    percentage,
    passed: args.type === "test" ? percentage >= 80 : undefined,
  };
}

export function updateWordStats(
  stats: StudyProgress["wordStats"],
  wordId: string,
  isCorrect: boolean
): StudyProgress["wordStats"] {
  const prev = stats[wordId] ?? { correct: 0, total: 0, lastPracticed: null, lastSeen: null };
  return {
    ...stats,
    [wordId]: {
      ...prev,
      correct: prev.correct + (isCorrect ? 1 : 0),
      total: prev.total + 1,
      lastPracticed: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    },
  };
}

export function calculateStreak(practiceHistory: StudyRecord[], testHistory: StudyRecord[]) {
  const allDates = [...practiceHistory, ...testHistory]
    .map((r) => {
      if (!r || typeof (r as any).date !== "string") return "";
      const value = (r as any).date.trim();
      if (!value) return "";
      if (value.length >= 10) return value.slice(0, 10);
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return "";
      return parsed.toISOString().slice(0, 10);
    })
    .filter(Boolean);
  const unique = Array.from(new Set(allDates)).sort((a, b) => (a < b ? 1 : -1));
  if (!unique.length) return 0;
  let streak = 0;
  let cursor = new Date();
  for (let i = 0; i < 365; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    if (unique.includes(day)) streak += 1;
    else if (streak > 0) break;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function updateUserStats(
  prev: UserStats,
  rec: StudyRecord,
  streak: number
): UserStats {
  return {
    ...prev,
    totalSessions: prev.totalSessions + 1,
    totalWords: prev.totalWords + rec.totalWords,
    perfectSessions: rec.percentage === 100 ? prev.perfectSessions + 1 : prev.perfectSessions,
    totalTests: rec.type === "test" ? prev.totalTests + 1 : prev.totalTests,
    passedTests: rec.type === "test" && rec.passed ? prev.passedTests + 1 : prev.passedTests,
    maxStreak: Math.max(prev.maxStreak, streak),
    lessonsCompleted: rec.type === "practice" || rec.type === "smart-review" ? prev.lessonsCompleted + 1 : prev.lessonsCompleted,
    listeningSessions: rec.mode === "listening" ? prev.listeningSessions + 1 : prev.listeningSessions,
    dailyChallengesCompleted: rec.type === "daily-challenge" ? prev.dailyChallengesCompleted + 1 : prev.dailyChallengesCompleted,
  };
}

export function unlockAchievements(userStats: UserStats, unlocked: string[]) {
  const set = new Set(unlocked);
  for (const a of ACHIEVEMENTS) {
    if (a.condition(userStats)) set.add(a.id);
  }
  return Array.from(set);
}

