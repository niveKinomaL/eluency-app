import AsyncStorage from "@react-native-async-storage/async-storage";

const STUDENT_SESSION_KEY = "@eluency/student-session-id";

export async function getStoredStudentSessionId(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(STUDENT_SESSION_KEY);
    const sessionId = typeof value === "string" ? value.trim() : "";
    return sessionId || null;
  } catch {
    return null;
  }
}

export async function setStoredStudentSessionId(sessionId: string): Promise<void> {
  try {
    const value = String(sessionId || "").trim();
    if (!value) return;
    await AsyncStorage.setItem(STUDENT_SESSION_KEY, value);
  } catch {
    // ignore persistence errors
  }
}

export async function clearStoredStudentSessionId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STUDENT_SESSION_KEY);
  } catch {
    // ignore persistence errors
  }
}
