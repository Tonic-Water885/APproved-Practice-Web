import type {
  AppLanguage,
  TeacherAreaRow,
  TeacherCurriculumData,
  TeacherPhraseRow,
  TeacherSubtopicRow,
  TeacherUnitRow,
} from "./types";

export type TeacherLevel = "area" | "subtopic" | "unit" | "phrase";

export type TeacherNode =
  | { level: "area"; row: TeacherAreaRow }
  | { level: "subtopic"; row: TeacherSubtopicRow }
  | { level: "unit"; row: TeacherUnitRow }
  | { level: "phrase"; row: TeacherPhraseRow };

export const teacherLevelLabels: Record<TeacherLevel, string> = {
  area: "Topic",
  subtopic: "Subtopic",
  unit: "Sub-subtopic",
  phrase: "Phrase",
};

export function emptyTeacherData(): TeacherCurriculumData {
  return {
    areas: [],
    subtopics: [],
    units: [],
    phrases: [],
  };
}

function normalizedKey(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^[A-Z]\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function collapseTeacherData(data: TeacherCurriculumData): TeacherCurriculumData {
  const areaIDMap = new Map<string, string>();
  const areas: TeacherAreaRow[] = [];
  const seenAreas = new Map<string, TeacherAreaRow>();

  for (const area of sortRows(data.areas)) {
    const key = normalizedKey(area.title_en);
    const existing = seenAreas.get(key);
    if (existing) {
      areaIDMap.set(area.id, existing.id);
    } else {
      seenAreas.set(key, area);
      areaIDMap.set(area.id, area.id);
      areas.push(area);
    }
  }

  const subtopicIDMap = new Map<string, string>();
  const subtopics: TeacherSubtopicRow[] = [];
  const seenSubtopics = new Map<string, TeacherSubtopicRow>();

  for (const subtopic of sortRows(data.subtopics)) {
    const areaID = areaIDMap.get(subtopic.area_id) ?? subtopic.area_id;
    const key = `${areaID}:${normalizedKey(subtopic.title_en)}`;
    const existing = seenSubtopics.get(key);
    if (existing) {
      subtopicIDMap.set(subtopic.id, existing.id);
    } else {
      const collapsed = { ...subtopic, area_id: areaID };
      seenSubtopics.set(key, collapsed);
      subtopicIDMap.set(subtopic.id, collapsed.id);
      subtopics.push(collapsed);
    }
  }

  const unitIDMap = new Map<string, string>();
  const units: TeacherUnitRow[] = [];
  const seenUnits = new Map<string, TeacherUnitRow>();

  for (const unit of sortRows(data.units)) {
    const subtopicID = subtopicIDMap.get(unit.subtopic_id) ?? unit.subtopic_id;
    const key = `${subtopicID}:${normalizedKey(unit.title_en)}`;
    const existing = seenUnits.get(key);
    if (existing) {
      unitIDMap.set(unit.id, existing.id);
    } else {
      const collapsed = { ...unit, subtopic_id: subtopicID };
      seenUnits.set(key, collapsed);
      unitIDMap.set(unit.id, collapsed.id);
      units.push(collapsed);
    }
  }

  const phrases: TeacherPhraseRow[] = [];
  const seenPhrases = new Set<string>();

  for (const phrase of sortRows(data.phrases)) {
    const unitID = unitIDMap.get(phrase.unit_id) ?? phrase.unit_id;
    const key = [
      unitID,
      normalizedKey(phrase.text_en),
      normalizedKey(phrase.text_fr),
      normalizedKey(phrase.text_it),
      normalizedKey(phrase.text_es),
    ].join(":");
    if (seenPhrases.has(key)) continue;
    seenPhrases.add(key);
    phrases.push({ ...phrase, unit_id: unitID });
  }

  return { areas, subtopics, units, phrases };
}

export function sortRows<T extends { id?: string; sort_index: number | null; title_en?: string; text_en?: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const sortDiff = (a.sort_index ?? 0) - (b.sort_index ?? 0);
    if (sortDiff !== 0) return sortDiff;
    const idDiff = (a.id ?? "").localeCompare(b.id ?? "");
    if (idDiff !== 0) return idDiff;
    return (a.title_en ?? a.text_en ?? "").localeCompare(b.title_en ?? b.text_en ?? "");
  });
}

export function subtopicsFor(data: TeacherCurriculumData, areaID: string) {
  return sortRows(data.subtopics.filter((subtopic) => subtopic.area_id === areaID));
}

export function unitsFor(data: TeacherCurriculumData, subtopicID: string) {
  return sortRows(data.units.filter((unit) => unit.subtopic_id === subtopicID));
}

export function phrasesFor(data: TeacherCurriculumData, unitID: string) {
  return sortRows(data.phrases.filter((phrase) => phrase.unit_id === unitID));
}

export function countDescendants(data: TeacherCurriculumData, node: TeacherNode): number {
  if (node.level === "phrase") return 1;
  if (node.level === "unit") return 1 + phrasesFor(data, node.row.id).length;
  if (node.level === "subtopic") {
    const units = unitsFor(data, node.row.id);
    return 1 + units.reduce((total, unit) => total + countDescendants(data, { level: "unit", row: unit }), 0);
  }

  const subtopics = subtopicsFor(data, node.row.id);
  return 1 + subtopics.reduce((total, subtopic) => total + countDescendants(data, { level: "subtopic", row: subtopic }), 0);
}

export function rowsForRestore(data: TeacherCurriculumData, node: TeacherNode) {
  if (node.level === "phrase") {
    return { areas: [], subtopics: [], units: [], phrases: [node.row] };
  }

  if (node.level === "unit") {
    return {
      areas: [],
      subtopics: [],
      units: [node.row],
      phrases: phrasesFor(data, node.row.id),
    };
  }

  if (node.level === "subtopic") {
    const units = unitsFor(data, node.row.id);
    return {
      areas: [],
      subtopics: [node.row],
      units,
      phrases: units.flatMap((unit) => phrasesFor(data, unit.id)),
    };
  }

  const subtopics = subtopicsFor(data, node.row.id);
  const units = subtopics.flatMap((subtopic) => unitsFor(data, subtopic.id));
  return {
    areas: [node.row],
    subtopics,
    units,
    phrases: units.flatMap((unit) => phrasesFor(data, unit.id)),
  };
}

export function parsePhrasePairs(value: string, language: Exclude<AppLanguage, "en">) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [english, ...translationParts] = line.split("==");
      const phrase = {
        text_en: english?.trim() ?? "",
        text_fr: "",
        text_it: "",
        text_es: "",
        sort_index: index + 1,
      };
      phrase[`text_${language}` as const] = translationParts.join("==").trim();
      return phrase;
    })
    .filter((phrase) => phrase.text_en && (phrase.text_fr || phrase.text_it || phrase.text_es));
}

export function parseMultilingualPhraseRows(
  value: string,
  languages: Exclude<AppLanguage, "en">[],
) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [english, translations = ""] = line.split("==");
      const pieces = translations.split("**").map((piece) => piece.trim());
      const phrase = {
        text_en: english?.trim() ?? "",
        text_fr: "",
        text_es: "",
        text_it: "",
        sort_index: index + 1,
      };

      languages.forEach((language, languageIndex) => {
        phrase[`text_${language}` as const] = pieces[languageIndex] ?? "";
      });

      return phrase;
    })
    .filter((phrase) => phrase.text_en && (phrase.text_fr || phrase.text_es || phrase.text_it));
}
