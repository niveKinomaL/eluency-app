import AsyncStorage from "@react-native-async-storage/async-storage";

import { getRemoteProgress, saveRemoteProgress } from "../api/study";
import type { StudyProgress } from "../../types/study-game";

const STORAGE_KEY = "eluency-study-game-progress-v1";

export const DEFAULT_PROGRESS: StudyProgress = {
  preferences: { darkMode: false, hapticEnabled: true, practiceLength: 15 },
  dailyChallenge: { date: null, completed: false, score: 0 },
  practiceHistory: [],
  testHistory: [],
  wordStats: {},
  wordMeta: {},
  userStats: {
    totalSessions: 0,
    totalWords: 0,
    perfectSessions: 0,
    totalTests: 0,
    passedTests: 0,
    maxStreak: 0,
    lessonsCompleted: 0,
    listeningSessions: 0,
    dailyChallengesCompleted: 0,
  },
  achievements: [],
};

export async function loadLocalProgress(): Promise<StudyProgress> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<StudyProgress>;
    return {
      ...DEFAULT_PROGRESS,
      ...parsed,
      preferences: { ...DEFAULT_PROGRESS.preferences, ...(parsed.preferences ?? {}) },
      dailyChallenge: { ...DEFAULT_PROGRESS.dailyChallenge, ...(parsed.dailyChallenge ?? {}) },
      userStats: { ...DEFAULT_PROGRESS.userStats, ...(parsed.userStats ?? {}) },
      practiceHistory: Array.isArray(parsed.practiceHistory) ? parsed.practiceHistory : [],
      testHistory: Array.isArray(parsed.testHistory) ? parsed.testHistory : [],
      wordStats: parsed.wordStats ?? {},
      wordMeta: parsed.wordMeta ?? {},
      achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export async function saveLocalProgress(progress: StudyProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // no-op
  }
}

export async function hydrateProgress(sessionId: string): Promise<StudyProgress> {
  const local = await loadLocalProgress();
  const remote = await getRemoteProgress(sessionId);
  if (!remote) return local;
  const merged: StudyProgress = {
    ...local,
    ...remote,
    preferences: { ...local.preferences, ...(remote.preferences ?? {}) },
    dailyChallenge: { ...local.dailyChallenge, ...(remote.dailyChallenge ?? {}) },
    userStats: { ...local.userStats, ...(remote.userStats ?? {}) },
    practiceHistory: Array.isArray(remote.practiceHistory) ? remote.practiceHistory : local.practiceHistory,
    testHistory: Array.isArray(remote.testHistory) ? remote.testHistory : local.testHistory,
    wordStats: remote.wordStats ?? local.wordStats,
    wordMeta: remote.wordMeta ?? local.wordMeta,
    achievements: Array.isArray(remote.achievements) ? remote.achievements : local.achievements,
  };
  await saveLocalProgress(merged);
  return merged;
}

let progressSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleProgressSync(sessionId: string, progress: StudyProgress, delayMs = 1200) {
  if (progressSaveTimer) clearTimeout(progressSaveTimer);
  progressSaveTimer = setTimeout(() => {
    saveRemoteProgress(sessionId, progress).catch(() => {});
    progressSaveTimer = null;
  }, delayMs);
}

export async function flushProgressSync(sessionId: string, progress: StudyProgress) {
  if (progressSaveTimer) {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = null;
  }
  await saveRemoteProgress(sessionId, progress);
}

