import type { GameWord, LessonGamePayload, TestGamePayload } from "../../types/study-game";

function stableToken(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

function toImageUrl(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  if (trimmed === "📄") return undefined;
  return trimmed;
}

export function normalizeLessonsToWords(lessons: LessonGamePayload[]): GameWord[] {
  const out: GameWord[] = [];
  for (const lesson of lessons) {
    for (let i = 0; i < (lesson.words ?? []).length; i += 1) {
      const w = (lesson.words ?? [])[i];
      const pt = String(w.pt ?? "").trim();
      const en = String(w.en ?? "").trim();
      if (!pt && !en) continue;
      out.push({
        id: `lesson-${lesson.id}-${stableToken(`${pt}-${en}`) || i}`,
        lessonId: lesson.id,
        lessonName: lesson.name,
        sourceType: "lesson",
        pt,
        en,
        sp: w.sp ?? pt,
        se: w.se ?? en,
        imageUrl: toImageUrl(w.image_url ?? w.img),
        audioUrl: w.audio_url ?? null,
        promptFormat: w.audio_url ? "audio" : toImageUrl(w.image_url ?? w.img) ? "image" : "text",
        answerFormat: "specific",
      });
    }
  }
  return out;
}

export function normalizeTestsToWords(tests: TestGamePayload[]): GameWord[] {
  const out: GameWord[] = [];
  for (const test of tests) {
    for (let i = 0; i < (test.words ?? []).length; i += 1) {
      const q = (test.words ?? [])[i];
      const pt = String(q.pt ?? "").trim();
      const en = String(q.en ?? "");
      if (!pt && !en) continue;
      out.push({
        id: `test-${test.id}-${stableToken(`${pt}-${en}`) || i}`,
        testId: test.id,
        testName: test.name,
        sourceType: "test",
        pt,
        en,
        pt_alt: Array.isArray(q.pt_alt) ? q.pt_alt : [],
        imageUrl: toImageUrl(q.img),
        audioUrl: q.audio_url ?? null,
        promptFormat: q.prompt_format ?? "text",
        answerFormat: q.answer_format ?? (q.require_specific_answer === false ? "open" : "specific"),
        mcqOptions: Array.isArray(q.mcq_options) ? q.mcq_options : undefined,
        mcqCorrectOptionId: q.mcq_correct_option_id ?? null,
        fillBlankCharacterCount: q.fill_blank_character_count,
      });
    }
    for (const rv of test.reviewVocabulary ?? []) {
      const pt = String(rv.pt ?? "").trim();
      const en = String(rv.en ?? "").trim();
      if (!pt && !en) continue;
      out.push({
        id: rv.id ? String(rv.id) : `review-${test.id}-${stableToken(`${pt}-${en}`) || "x"}`,
        testId: test.id,
        testName: test.name,
        sourceType: "review",
        pt,
        en,
        sp: rv.sp ?? pt,
        se: rv.se ?? en,
        imageUrl: toImageUrl(rv.img),
        audioUrl: rv.audio_url ?? null,
        promptFormat: rv.audio_url ? "audio" : toImageUrl(rv.img) ? "image" : "text",
        answerFormat: "specific",
      });
    }
  }
  return out;
}

export function getDisplayPrompt(word: GameWord, direction: "pt-en" | "en-pt") {
  if (direction === "pt-en") return word.pt || word.sp || "";
  return word.en || word.se || "";
}

export function getExpectedAnswer(word: GameWord, direction: "pt-en" | "en-pt") {
  if (direction === "pt-en") return word.en || "";
  return word.pt || "";
}

