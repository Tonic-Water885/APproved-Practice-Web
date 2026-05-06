import type { LearnResult, PhraseStatus, ProgressState, ReviewItem } from "./types";

export const defaultProgress: ProgressState = {
  preferredSourceLanguage: "en",
  preferredTargetLanguage: "fr",
  preferredTimerSeconds: 10,
  preferredPlayAudioEnabled: true,
  phraseStatuses: {},
  starredPhraseIDs: [],
  dailyActivity: {},
  totalResponses: 0,
  totalPerfect: 0,
  totalPartial: 0,
  totalForgotten: 0,
  totalStudySeconds: 0,
  currentStreak: 0,
};

export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function applyReviewItems(
  progress: ProgressState,
  reviewItems: ReviewItem[],
  durationSeconds: number,
  preferences?: Partial<ProgressState>,
): ProgressState {
  const next: ProgressState = {
    ...progress,
    ...preferences,
    phraseStatuses: { ...progress.phraseStatuses },
    dailyActivity: { ...progress.dailyActivity },
    starredPhraseIDs: [...progress.starredPhraseIDs],
  };
  const today = dayKey();
  const perfectCount = reviewItems.filter((item) => item.result === "perfect").length;
  const partialCount = reviewItems.filter((item) => item.result === "partial").length;
  const forgotCount = reviewItems.filter((item) => item.result === "forgot").length;

  next.dailyActivity[today] = (next.dailyActivity[today] ?? 0) + reviewItems.length;
  next.totalResponses += reviewItems.length;
  next.totalPerfect += perfectCount;
  next.totalPartial += partialCount;
  next.totalForgotten += forgotCount;
  next.totalStudySeconds += durationSeconds;

  const grouped = new Map<string, LearnResult[]>();
  for (const item of reviewItems) {
    grouped.set(item.phraseID, [...(grouped.get(item.phraseID) ?? []), item.result]);
  }

  for (const [phraseID, results] of grouped) {
    const result = results.includes("forgot")
      ? "forgot"
      : results.includes("partial")
        ? "partial"
        : "perfect";
    next.phraseStatuses[phraseID] = updatedStatus(next.phraseStatuses[phraseID] ?? "unseen", result);
  }

  if (next.lastStudyDayKey !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    next.currentStreak = next.lastStudyDayKey === dayKey(yesterday) ? next.currentStreak + 1 : 1;
    next.lastStudyDayKey = today;
  }

  return next;
}

export function updatedStatus(current: PhraseStatus, result: LearnResult): PhraseStatus {
  if (result === "forgot") {
    return "forgot";
  }

  if (result === "partial") {
    return "partial";
  }

  return current === "forgot" || current === "partial" || current === "unseen" || current === "perfect"
    ? "perfect"
    : current;
}

export function loadProgress(storageKey: string): ProgressState {
  if (typeof window === "undefined") {
    return defaultProgress;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return defaultProgress;
    }

    return { ...defaultProgress, ...JSON.parse(raw) };
  } catch {
    return defaultProgress;
  }
}

export function saveProgress(storageKey: string, progress: ProgressState) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(progress));
}

export function weeklyCards(progress: ProgressState) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dayKey(date);
    return {
      id: key,
      day: date.toLocaleDateString(undefined, { weekday: "short" }),
      value: progress.dailyActivity[key] ?? 0,
    };
  });
}

