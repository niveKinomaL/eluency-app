export type StudySessionType =
  | "practice"
  | "test"
  | "daily-challenge"
  | "review-mistakes"
  | "smart-review";

export type StudySessionMode = "typing" | "multiple-choice" | "listening" | "image";
export type StudyDirection = "pt-en" | "en-pt";

export type StudentSessionPayload = {
  student: {
    id: string;
    name: string;
    code: string;
    assigned_lessons: string[];
    assigned_tests: string[];
  };
  teacher: { id: string; name: string; email: string | null } | null;
  expires_at: string;
};

export type LessonGamePayload = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  gradeRange?: string;
  cover_image_url?: string;
  words: Array<{
    id?: string;
    pt?: string;
    en?: string;
    sp?: string;
    se?: string;
    img?: string;
    image_url?: string;
    audio_url?: string | null;
  }>;
  tags?: string[];
  document_url?: string;
  document_name?: string;
};

export type TestGamePayload = {
  id: string;
  name: string;
  cover_image_url?: string;
  words: Array<{
    pt?: string;
    en?: string;
    img?: string;
    answer_format?: "open" | "specific" | "mcq";
    require_specific_answer?: boolean;
    pt_alt?: string[];
    mcq_options?: { id: string; text: string }[] | null;
    mcq_correct_option_id?: string | null;
    audio_url?: string | null;
    prompt_format?: "text" | "audio" | "image" | "fill_blank";
    fill_blank_character_count?: number;
  }>;
  reviewVocabulary?: Array<{
    id?: string;
    pt?: string;
    en?: string;
    sp?: string;
    se?: string;
    img?: string;
    audio_url?: string | null;
  }>;
};

export type GameWord = {
  id: string;
  lessonId?: string;
  lessonName?: string;
  testId?: string;
  testName?: string;
  sourceType: "lesson" | "test" | "review";
  pt: string;
  en: string;
  sp?: string;
  se?: string;
  pt_alt?: string[];
  imageUrl?: string;
  audioUrl?: string | null;
  promptFormat?: "text" | "audio" | "image" | "fill_blank";
  answerFormat?: "open" | "specific" | "mcq";
  mcqOptions?: { id: string; text: string }[];
  mcqCorrectOptionId?: string | null;
  fillBlankCharacterCount?: number;
};

export type VerifyAnswerPayload = {
  correctAnswer: string;
  userAnswer: string;
  sourceText?: string;
  isMarkedInfinitive?: boolean;
};

export type VerifyAnswerResult = {
  correct?: boolean;
  isCorrect?: boolean;
  close?: boolean;
  showInfinitiveNote?: boolean;
  feedback?: string;
  correction?: string;
  acceptedAs?: string;
};

export type StudyRecord = {
  id: string;
  date: string;
  type: StudySessionType;
  mode: StudySessionMode;
  lessonId?: string | null;
  lessonName?: string | null;
  score: number;
  totalWords: number;
  percentage: number;
  passed?: boolean;
  direction: StudyDirection;
};

export type WordStatsItem = {
  correct: number;
  total: number;
  lastPracticed: string | null;
  lastSeen: string | null;
  favorite?: boolean;
  difficult?: boolean;
};

export type UserStats = {
  totalSessions: number;
  totalWords: number;
  perfectSessions: number;
  totalTests: number;
  passedTests: number;
  maxStreak: number;
  lessonsCompleted: number;
  listeningSessions: number;
  dailyChallengesCompleted: number;
};

export type DailyChallengeState = {
  date: string | null;
  completed: boolean;
  score: number;
};

export type StudyProgress = {
  preferences: { darkMode: boolean; hapticEnabled: boolean; practiceLength: number };
  dailyChallenge: DailyChallengeState;
  practiceHistory: StudyRecord[];
  testHistory: StudyRecord[];
  wordStats: Record<string, WordStatsItem>;
  wordMeta: Record<string, { tags?: string[]; lessonId?: string; testId?: string }>;
  userStats: UserStats;
  achievements: string[];
};

