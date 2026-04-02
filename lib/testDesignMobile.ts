/**
 * Mirrors Eluency `test-design.ts` for mobile test save/load (question defaults + settings).
 */

export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_RULES = {
  caseInsensitive: true,
  ignorePunctuation: true,
  trimSpaces: true,
  accentInsensitive: false,
};

type MCQOption = { id: string; text: string };

export function ensureQuestionDefaults(q: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!q || typeof q !== "object") {
    return {
      id: uid(),
      q_type: "manual",
      prompt_format: "text",
      answer_format: "specific",
      section: "",
      points: 1,
      required: true,
      prompt_text: "",
      image_url: "",
      audio_url: "",
      audio_transcript: "",
      correct_text: "",
      accepted_texts: [],
      specific_rules: { ...DEFAULT_RULES },
      mcq_options: [
        { id: uid(), text: "" },
        { id: uid(), text: "" },
        { id: uid(), text: "" },
        { id: uid(), text: "" },
      ],
      mcq_correct_option_id: "",
      teacher_reference_answer: "",
    };
  }
  const raw = q;
  const prompt_text = String(raw.prompt_text ?? raw.en ?? "");
  const correct_text = String(raw.correct_text ?? raw.pt ?? "").trim();
  const pt_alt = raw.accepted_texts ?? raw.pt_alt;
  const accepted_texts = Array.isArray(pt_alt)
    ? pt_alt.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
    : [];

  const answer_format =
    raw.answer_format === "open" || raw.answer_format === "mcq"
      ? raw.answer_format
      : raw.require_specific_answer === false
        ? "open"
        : "specific";

  const mcqRaw = raw.mcq_options;
  const mcq_options: MCQOption[] =
    Array.isArray(mcqRaw) && mcqRaw.length >= 2
      ? mcqRaw.map((o: unknown) => {
          const obj = o && typeof o === "object" ? (o as Record<string, unknown>) : {};
          return { id: String(obj.id ?? uid()), text: String(obj.text ?? "") };
        })
      : [
          { id: uid(), text: "" },
          { id: uid(), text: "" },
          { id: uid(), text: "" },
          { id: uid(), text: "" },
        ];

  return {
    id: raw.id ? String(raw.id) : uid(),
    q_type: raw.q_type === "ai" ? "ai" : "manual",
    prompt_format: ["text", "audio", "image", "video", "fill_blank"].includes(String(raw.prompt_format ?? ""))
      ? raw.prompt_format
      : "text",
    answer_format,
    section: String(raw.section ?? "").trim(),
    points: typeof raw.points === "number" && raw.points >= 0 ? raw.points : 1,
    required: raw.required !== false,
    prompt_text,
    image_url: String(raw.image_url ?? "").trim() || undefined,
    audio_url: String(raw.audio_url ?? "").trim() || undefined,
    audio_transcript: String(raw.audio_transcript ?? "").trim() || undefined,
    correct_text,
    accepted_texts,
    specific_rules:
      raw.specific_rules && typeof raw.specific_rules === "object"
        ? {
            caseInsensitive: (raw.specific_rules as Record<string, unknown>).caseInsensitive !== false,
            ignorePunctuation: (raw.specific_rules as Record<string, unknown>).ignorePunctuation !== false,
            trimSpaces: (raw.specific_rules as Record<string, unknown>).trimSpaces !== false,
            accentInsensitive: (raw.specific_rules as Record<string, unknown>).accentInsensitive === true,
          }
        : { ...DEFAULT_RULES },
    mcq_options,
    mcq_correct_option_id: String(raw.mcq_correct_option_id ?? "").trim() || undefined,
    teacher_reference_answer: String(raw.teacher_reference_answer ?? "").trim() || undefined,
    fill_blank_character_count:
      typeof raw.fill_blank_character_count === "number" && raw.fill_blank_character_count > 0
        ? Math.min(50, Math.max(1, Math.floor(raw.fill_blank_character_count)))
        : undefined,
    en: prompt_text || undefined,
    pt: correct_text || undefined,
    pt_alt: accepted_texts.length ? accepted_texts : undefined,
    require_specific_answer: answer_format !== "open",
  };
}

export function ensureTestSettings(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== "object") {
    return {
      time_limit_minutes: null,
      attempts_allowed: 1,
      randomize_questions: false,
      randomize_mcq_options: true,
    };
  }
  const raw = s as Record<string, unknown>;
  return {
    time_limit_minutes:
      raw.time_limit_minutes == null || raw.time_limit_minutes === ""
        ? null
        : Number(raw.time_limit_minutes) || null,
    attempts_allowed:
      raw.attempts_allowed === "unlimited" ? "unlimited" : (Math.min(2, Math.max(1, Number(raw.attempts_allowed) || 1)) as 1 | 2),
    randomize_questions: raw.randomize_questions === true,
    randomize_mcq_options: raw.randomize_mcq_options !== false,
  };
}
