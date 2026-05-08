export type AppLanguage = "en" | "fr" | "it" | "es";

export type AppRole = "student" | "teacher" | "admin";

export type LearnResult = "forgot" | "partial" | "perfect";

export type PhraseStatus = "unseen" | "forgot" | "partial" | "perfect";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
};

export type CurriculumTopicRow = {
  id: string;
  sort_index: number;
  section_en: string;
  subsection_en: string;
  subsection_fr: string;
  subsection_it: string;
  subsection_es: string;
  phrases_en: string[];
  phrases_fr: string[];
  phrases_it: string[];
  phrases_es: string[];
  phrase_ids?: string[];
  updated_at?: string;
  created_by?: string | null;
  is_published?: boolean | null;
  source_type?: "system" | "teacher" | string | null;
  created_at?: string;
};

export type TeacherAreaRow = {
  id: string;
  code?: string | null;
  title_en: string;
  sort_index: number | null;
  created_by: string | null;
  is_published?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type TeacherSubtopicRow = {
  id: string;
  area_id: string;
  title_en: string;
  sort_index: number | null;
  created_by: string | null;
  is_published?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type TeacherUnitRow = {
  id: string;
  subtopic_id: string;
  title_en: string;
  sort_index: number | null;
  created_by: string | null;
  is_published?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type TeacherPhraseRow = {
  id: string;
  unit_id: string;
  text_en: string;
  text_fr: string | null;
  text_it: string | null;
  text_es: string | null;
  sort_index: number | null;
  created_by: string | null;
  is_published?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type TeacherCurriculumData = {
  areas: TeacherAreaRow[];
  subtopics: TeacherSubtopicRow[];
  units: TeacherUnitRow[];
  phrases: TeacherPhraseRow[];
};

export type CurriculumPhrase = {
  id: string;
  index: number;
  translations: Record<AppLanguage, string>;
};

export type CurriculumTopic = {
  id: string;
  rowID: string;
  sortIndex: number;
  sectionTitle: string;
  titles: Record<AppLanguage, string>;
  phrases: CurriculumPhrase[];
  ownerID?: string | null;
  isPublished: boolean;
  sourceType: string;
};

export type CurriculumSection = {
  id: string;
  title: string;
  topics: CurriculumTopic[];
};

export type StoredCurriculum = {
  sections: CurriculumSection[];
  topics: CurriculumTopic[];
  phrases: CurriculumPhrase[];
};

export type SessionConfig = {
  sourceLanguage: AppLanguage;
  targetLanguage: AppLanguage;
  topicIDs: string[];
  phraseIDs?: string[];
  timerSeconds: number;
  timerEnabled: boolean;
  autoContinueEnabled: boolean;
  shuffleEnabled: boolean;
  playAudioEnabled: boolean;
};

export type ReviewItem = {
  id: string;
  phraseID: string;
  prompt: string;
  answer: string;
  topicTitle: string;
  sectionTitle: string;
  result: LearnResult;
};

export type ProgressState = {
  preferredSourceLanguage: AppLanguage;
  preferredTargetLanguage: AppLanguage;
  preferredTimerSeconds: number;
  preferredPlayAudioEnabled: boolean;
  phraseStatuses: Record<string, PhraseStatus>;
  starredPhraseIDs: string[];
  dailyActivity: Record<string, number>;
  totalResponses: number;
  totalPerfect: number;
  totalPartial: number;
  totalForgotten: number;
  totalStudySeconds: number;
  currentStreak: number;
  lastStudyDayKey?: string;
};
