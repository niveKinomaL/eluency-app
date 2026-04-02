import Constants from "expo-constants";

import type {
  LessonGamePayload,
  StudentSessionPayload,
  StudyProgress,
  TestGamePayload,
  VerifyAnswerPayload,
  VerifyAnswerResult,
} from "../../types/study-game";

const apiBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getStudentSession(sessionId: string): Promise<StudentSessionPayload> {
  const res = await fetch(`${apiBaseUrl}/api/students/session?session=${encodeURIComponent(sessionId)}`);
  const json = await parseJsonSafe<StudentSessionPayload & { error?: string }>(res);
  if (!res.ok || !json || (json as any).error) {
    throw new Error((json as any)?.error ?? "Failed to load student session");
  }
  return json;
}

export async function getAssignedLessons(lessonIds: string[]): Promise<LessonGamePayload[]> {
  if (!lessonIds.length) return [];
  const res = await fetch(`${apiBaseUrl}/api/lessons?lessonIds=${encodeURIComponent(lessonIds.join(","))}`);
  const json = await parseJsonSafe<{ data?: LessonGamePayload[]; error?: string }>(res);
  if (!res.ok || !json || json.error) throw new Error(json?.error ?? "Failed to load lessons");
  return Array.isArray(json.data) ? json.data : [];
}

export async function getAssignedTests(testIds: string[]): Promise<TestGamePayload[]> {
  if (!testIds.length) return [];
  const res = await fetch(`${apiBaseUrl}/api/tests?testIds=${encodeURIComponent(testIds.join(","))}`);
  const json = await parseJsonSafe<{ data?: TestGamePayload[]; error?: string }>(res);
  if (!res.ok || !json || json.error) throw new Error(json?.error ?? "Failed to load tests");
  return Array.isArray(json.data) ? json.data : [];
}

export async function getRemoteProgress(sessionId: string): Promise<StudyProgress | null> {
  const res = await fetch(`${apiBaseUrl}/api/game/progress?session=${encodeURIComponent(sessionId)}`);
  const json = await parseJsonSafe<{ progress?: StudyProgress; error?: string }>(res);
  if (!res.ok) return null;
  return json?.progress ?? null;
}

export async function saveRemoteProgress(sessionId: string, progress: StudyProgress): Promise<void> {
  await fetch(`${apiBaseUrl}/api/game/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, progress }),
  }).catch(() => {});
}

export async function verifyAnswer(payload: VerifyAnswerPayload): Promise<VerifyAnswerResult | null> {
  const res = await fetch(`${apiBaseUrl}/api/game/verify-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await parseJsonSafe<VerifyAnswerResult & { error?: string; fallback?: boolean }>(res);
  if (!res.ok || !json || (json as any).error) return null;
  return json;
}

export async function requestTtsBase64(
  text: string,
  sessionId: string,
  lang = "pt-BR"
): Promise<{ mimeType: string; data: string } | null> {
  const res = await fetch(`${apiBaseUrl}/api/ai/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, session: sessionId }),
  });
  const json = await parseJsonSafe<{ mimeType?: string; data?: string; error?: string }>(res);
  if (!res.ok || !json || json.error || !json.data) return null;
  return { mimeType: json.mimeType ?? "audio/wav", data: json.data };
}

