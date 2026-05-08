import type {
  AppLanguage,
  CurriculumPhrase,
  CurriculumSection,
  CurriculumTopic,
  CurriculumTopicRow,
  StoredCurriculum,
} from "./types";

export const languages: { code: AppLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "es", label: "Spanish" },
];

export const targetLanguages = languages.filter((language) => language.code !== "en");

export function languageLabel(language: AppLanguage) {
  return languages.find((item) => item.code === language)?.label ?? language;
}

export function languageVoice(language: AppLanguage) {
  switch (language) {
    case "fr":
      return "fr-FR";
    case "it":
      return "it-IT";
    case "es":
      return "es-ES";
    default:
      return "en-GB";
  }
}

function speech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  return window.speechSynthesis;
}

const browserVoiceNames: Record<AppLanguage, string[]> = {
  en: ["Daniel", "Google UK English Male", "Microsoft Ryan", "Samantha", "Alex"],
  fr: ["Thomas", "Amelie", "Amélie", "Google français", "Microsoft Henri", "Microsoft Denise"],
  it: ["Alice", "Google italiano", "Microsoft Elsa", "Microsoft Isabella"],
  es: ["Monica", "Mónica", "Google español", "Microsoft Alvaro", "Microsoft Elvira"],
};

export function buildCurriculum(rows: CurriculumTopicRow[]): StoredCurriculum {
  const orderedRows = [...rows].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0));
  const topics: CurriculumTopic[] = orderedRows.map(rowToTopic);
  const sectionsByTitle = new Map<string, CurriculumTopic[]>();

  for (const topic of topics) {
    const existing = sectionsByTitle.get(topic.sectionTitle) ?? [];
    existing.push(topic);
    sectionsByTitle.set(topic.sectionTitle, existing);
  }

  const sections: CurriculumSection[] = Array.from(sectionsByTitle.entries()).map(
    ([title, sectionTopics]) => ({
      id: slugify(title),
      title,
      topics: sectionTopics,
    }),
  );

  return {
    sections,
    topics,
    phrases: topics.flatMap((topic) => topic.phrases),
  };
}

export function rowToTopic(row: CurriculumTopicRow): CurriculumTopic {
  const phraseCount = Math.max(
    row.phrases_en?.length ?? 0,
    row.phrases_fr?.length ?? 0,
    row.phrases_it?.length ?? 0,
    row.phrases_es?.length ?? 0,
  );
  const topicID = `topic-${row.id}`;
  const phrases: CurriculumPhrase[] = Array.from({ length: phraseCount }, (_, index) => ({
    id: row.phrase_ids?.[index] ?? `${topicID}-phrase-${index}`,
    index,
    translations: {
      en: row.phrases_en?.[index] ?? "",
      fr: row.phrases_fr?.[index] ?? "",
      it: row.phrases_it?.[index] ?? "",
      es: row.phrases_es?.[index] ?? "",
    },
  }));

  return {
    id: topicID,
    rowID: row.id,
    sortIndex: row.sort_index,
    sectionTitle: row.section_en,
    titles: {
      en: row.subsection_en,
      fr: row.subsection_fr,
      it: row.subsection_it,
      es: row.subsection_es,
    },
    phrases,
    ownerID: row.created_by,
    isPublished: row.is_published ?? true,
    sourceType: row.source_type ?? "system",
  };
}

export function areaCode(sectionTitle: string) {
  const trimmed = sectionTitle.trim();
  const prefixedCode = trimmed.match(/^([^:]+)\s*:/)?.[1]?.trim();
  return (prefixedCode || trimmed.charAt(0)).toUpperCase();
}

export function areaTitle(code: string) {
  switch (code) {
    case "A":
      return "Everyday activities";
    case "B":
      return "Personal and social life";
    case "C":
      return "The world around us";
    case "D":
      return "The world of work";
    case "E":
      return "The international world";
    default:
      return code;
  }
}

export function normalizeTitle(value: string) {
  return value
    .replace(/^[^:]{1,60}\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function displayTitle(value: string) {
  const normalized = normalizeTitle(value);
  if (/[a-z]/.test(normalized)) {
    return normalized;
  }

  return normalized
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      if (index > 0 && ["and", "or", "of", "the", "to", "a", "an"].includes(word)) {
        return word;
      }

      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function unlockSpeech() {
  const synth = speech();
  synth?.resume();
  return typeof window !== "undefined";
}

export function speak(text: string, language: AppLanguage) {
  if (typeof window === "undefined") {
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return speakInBrowser(trimmed, language);
}

function speakInBrowser(text: string, language: AppLanguage) {
  const synth = speech();
  if (!synth || typeof window === "undefined" || !("SpeechSynthesisUtterance" in window)) {
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  synth.resume();
  synth.cancel();
  const utterance = new window.SpeechSynthesisUtterance(trimmed);
  utterance.lang = languageVoice(language);
  const voice = bestBrowserVoice(synth.getVoices(), language);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.volume = 1;
  utterance.rate = 0.92;
  utterance.pitch = 1;
  synth.speak(utterance);
  synth.resume();
  return true;
}

function bestBrowserVoice(voices: SpeechSynthesisVoice[], language: AppLanguage) {
  const locale = languageVoice(language).toLowerCase();
  const languageCode = locale.split("-")[0];
  const candidates = voices.filter((voice) => voice.lang.toLowerCase().startsWith(languageCode));
  const preferredNames = browserVoiceNames[language].map((name) => name.toLowerCase());

  return candidates
    .map((voice) => {
      const name = voice.name.toLowerCase();
      const preferredIndex = preferredNames.findIndex((preferred) => name.includes(preferred));
      const exactLocale = voice.lang.toLowerCase() === locale ? 30 : 0;
      const preferred = preferredIndex >= 0 ? 60 - preferredIndex : 0;
      const local = voice.localService ? 10 : 0;
      const defaultVoice = voice.default ? 5 : 0;
      return { voice, score: preferred + exactLocale + local + defaultVoice };
    })
    .sort((a, b) => b.score - a.score)[0]?.voice ?? candidates[0] ?? null;
}
