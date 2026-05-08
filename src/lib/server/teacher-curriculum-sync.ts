import type { SupabaseClient } from "@supabase/supabase-js";

import { areaCode, areaTitle, displayTitle, normalizeTitle } from "@/lib/curriculum";
import type {
  CurriculumTopicRow,
  TeacherAreaRow,
  TeacherPhraseRow,
  TeacherSubtopicRow,
  TeacherUnitRow,
} from "@/lib/types";

function keyFor(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function rowPhraseCount(row: CurriculumTopicRow) {
  return Math.max(
    row.phrases_en?.length ?? 0,
    row.phrases_fr?.length ?? 0,
    row.phrases_it?.length ?? 0,
    row.phrases_es?.length ?? 0,
  );
}

function importedAreaTitle(sectionTitle: string) {
  const code = areaCode(sectionTitle);
  if (/^[A-E]$/.test(code)) {
    return `${code}: ${areaTitle(code)}`;
  }

  return displayTitle(sectionTitle);
}

function nextSortIndex(rows: { sort_index: number | null }[]) {
  return rows.reduce((largest, row) => Math.max(largest, row.sort_index ?? 0), 0) + 1;
}

async function fetchAllRows<T>(supabase: SupabaseClient, table: string, columns = "*") {
  const pageSize = 1000;
  const rows: T[] = [];
  let start = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("sort_index", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);

    if (error) return { data: null, error };

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
    start += pageSize;
  }

  return { data: rows, error: null };
}

export async function ensureFlatCurriculumIsEditable(
  supabase: SupabaseClient,
  userID: string,
  providedFlatRows?: CurriculumTopicRow[],
) {
  const [flatResult, areasResult, subtopicsResult, unitsResult, phrasesResult] = await Promise.all([
    providedFlatRows
      ? Promise.resolve({ data: providedFlatRows, error: null })
      : fetchAllRows<CurriculumTopicRow>(
          supabase,
          "curriculum_topics",
          "id,sort_index,section_en,subsection_en,subsection_fr,subsection_it,subsection_es,phrases_en,phrases_fr,phrases_it,phrases_es,updated_at,created_by,is_published,source_type,created_at",
        ),
    fetchAllRows<TeacherAreaRow>(supabase, "curriculum_areas"),
    fetchAllRows<TeacherSubtopicRow>(supabase, "curriculum_subtopics"),
    fetchAllRows<TeacherUnitRow>(supabase, "curriculum_units"),
    fetchAllRows<TeacherPhraseRow>(supabase, "curriculum_phrases"),
  ]);

  const readError = (providedFlatRows ? null : flatResult.error) ?? areasResult.error ?? subtopicsResult.error ?? unitsResult.error ?? phrasesResult.error;
  if (readError) {
    throw new Error(readError.message);
  }

  const flatRows = (providedFlatRows ?? ((flatResult.data ?? []) as CurriculumTopicRow[])).filter((row) => row.section_en && row.subsection_en);
  const areas = [...((areasResult.data ?? []) as TeacherAreaRow[])];
  const subtopics = [...((subtopicsResult.data ?? []) as TeacherSubtopicRow[])];
  const units = [...((unitsResult.data ?? []) as TeacherUnitRow[])];
  const phrases = [...((phrasesResult.data ?? []) as TeacherPhraseRow[])];
  const imported = { areas: 0, subtopics: 0, units: 0, phrases: 0 };

  for (const row of flatRows) {
    const areaTitleEn = importedAreaTitle(row.section_en);
    const areaKey = keyFor(areaTitleEn);
    let area = areas.find((item) => keyFor(item.title_en) === areaKey);

    if (!area) {
      const areaResult = await supabase
        .from("curriculum_areas")
        .insert({
          title_en: areaTitleEn,
          sort_index: /^[A-E]$/.test(areaCode(row.section_en)) ? areaCode(row.section_en).charCodeAt(0) - 64 : nextSortIndex(areas),
          created_by: userID,
        })
        .select("*")
        .single();

      if (areaResult.error) throw new Error(areaResult.error.message);
      area = areaResult.data as TeacherAreaRow;
      areas.push(area);
      imported.areas += 1;
    }

    const subtopicTitle = displayTitle(row.section_en);
    const subtopicKey = `${area.id}:${keyFor(subtopicTitle)}`;
    let subtopic = subtopics.find((item) => `${item.area_id}:${keyFor(item.title_en)}` === subtopicKey);

    if (!subtopic) {
      const siblingSubtopics = subtopics.filter((item) => item.area_id === area.id);
      const subtopicResult = await supabase
        .from("curriculum_subtopics")
        .insert({
          area_id: area.id,
          title_en: subtopicTitle,
          sort_index: nextSortIndex(siblingSubtopics),
          created_by: userID,
        })
        .select("*")
        .single();

      if (subtopicResult.error) throw new Error(subtopicResult.error.message);
      subtopic = subtopicResult.data as TeacherSubtopicRow;
      subtopics.push(subtopic);
      imported.subtopics += 1;
    }

    const unitTitle = normalizeTitle(row.subsection_en);
    const unitKey = `${subtopic.id}:${keyFor(unitTitle)}`;
    let unit = units.find((item) => `${item.subtopic_id}:${keyFor(item.title_en)}` === unitKey);

    if (!unit) {
      const siblingUnits = units.filter((item) => item.subtopic_id === subtopic.id);
      const unitResult = await supabase
        .from("curriculum_units")
        .insert({
          subtopic_id: subtopic.id,
          title_en: unitTitle,
          sort_index: row.sort_index ?? nextSortIndex(siblingUnits),
          created_by: userID,
        })
        .select("*")
        .single();

      if (unitResult.error) throw new Error(unitResult.error.message);
      unit = unitResult.data as TeacherUnitRow;
      units.push(unit);
      imported.units += 1;
    }

    const existingPhraseKeys = new Set(
      phrases.filter((phrase) => phrase.unit_id === unit.id).map((phrase) => keyFor(phrase.text_en)),
    );
    const phraseRows = Array.from({ length: rowPhraseCount(row) }, (_, index) => ({
      unit_id: unit.id,
      text_en: row.phrases_en?.[index] ?? "",
      text_fr: row.phrases_fr?.[index] ?? "",
      text_it: row.phrases_it?.[index] ?? "",
      text_es: row.phrases_es?.[index] ?? "",
      sort_index: index + 1,
      created_by: userID,
    })).filter((phrase) => phrase.text_en.trim() && !existingPhraseKeys.has(keyFor(phrase.text_en)));

    if (phraseRows.length > 0) {
      const phraseResult = await supabase.from("curriculum_phrases").insert(phraseRows).select("*");
      if (phraseResult.error) throw new Error(phraseResult.error.message);
      phrases.push(...((phraseResult.data ?? []) as TeacherPhraseRow[]));
      imported.phrases += phraseRows.length;
    }
  }

  return imported;
}
