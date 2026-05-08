"use client";

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Ear,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Pencil,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { areaCode, areaTitle, buildCurriculum, displayTitle, languageLabel, normalizeTitle, speak, targetLanguages, unlockSpeech } from "@/lib/curriculum";
import { applyReviewItems, defaultProgress, loadProgress, saveProgress, weeklyCards } from "@/lib/progress";
import { supabase } from "@/lib/supabase";
import {
  collapseTeacherData,
  countDescendants,
  emptyTeacherData,
  parseMultilingualPhraseRows,
  phrasesFor,
  rowsForRestore,
  sortRows,
  subtopicsFor,
  teacherLevelLabels,
  unitsFor,
  type TeacherLevel,
  type TeacherNode,
} from "@/lib/teacher-curriculum";
import type {
  AppLanguage,
  CurriculumTopic,
  CurriculumTopicRow,
  LearnResult,
  PhraseStatus,
  Profile,
  ProgressState,
  ReviewItem,
  SessionConfig,
  StoredCurriculum,
  TeacherAreaRow,
  TeacherCurriculumData,
  TeacherPhraseRow,
  TeacherSubtopicRow,
  TeacherUnitRow,
} from "@/lib/types";

type AppView = "dashboard" | "learn" | "practice" | "topics" | "saved" | "teacher" | "settings";
type PracticeMode = "write" | "choice" | "listening" | "flashcards";
type SessionMode = "learn" | PracticeMode;
type SessionPrompt = {
  phraseID: string;
  prompt: string;
  answer: string;
  topicTitle: string;
  sectionTitle: string;
};
type TeacherTableName = "curriculum_areas" | "curriculum_subtopics" | "curriculum_units" | "curriculum_phrases";
type PublishScope = { areaID?: string; subtopicID?: string; unitID?: string };
type AddResultSummary = {
  parsedRows: number;
  skippedDuplicates: number;
  insertedRows: number;
  publishedRows?: number;
};

const curriculumPageSize = 1000;

const roleLabels: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Admin",
};

const resultLabels: Record<LearnResult, string> = {
  forgot: "Forgot",
  partial: "Partially Recalled",
  perfect: "Perfect",
};

const storageKeyFor = (userID: string) => `approved-practice.progress.${userID}`;

async function fetchAllTeacherRows<T>(table: TeacherTableName, publishedOnly = false) {
  const rows: T[] = [];
  let nextStart = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select("*");

    if (publishedOnly) {
      query = query.eq("is_published", true);
    }

    const { data, error } = await query
      .order("sort_index", { ascending: true })
      .order("id", { ascending: true })
      .range(nextStart, nextStart + curriculumPageSize - 1);
    if (error) return { data: null, error };

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < curriculumPageSize) break;
    nextStart += curriculumPageSize;
  }

  return { data: rows, error: null };
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<CurriculumTopicRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("dashboard");
  const [progress, setProgress] = useState<ProgressState>(defaultProgress);
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null);
  const [sessionMode, setSessionMode] = useState<SessionMode>("learn");
  const [sessionPrompts, setSessionPrompts] = useState<SessionPrompt[]>([]);
  const [initialAudioSpoken, setInitialAudioSpoken] = useState(false);
  const [teacherHasUnpublishedChanges, setTeacherHasUnpublishedChanges] = useState(false);

  const curriculum = useMemo(() => buildCurriculum(rows), [rows]);
  const isTeacher = profile?.role === "teacher" || profile?.role === "admin";
  const storageKey = session?.user.id ? storageKeyFor(session.user.id) : "approved-practice.progress.guest";

  const fetchProfile = useCallback(async (user: User) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("id", user.id)
      .single();

    if (error) {
      setProfile({
        id: user.id,
        email: user.email ?? "",
        full_name: user.email?.split("@")[0] ?? "Student",
        role: "student",
      });
      return;
    }

    setProfile(data as Profile);
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const fetchCurriculum = useCallback(async (showSuccess = false) => {
    setCurriculumLoading(true);
    const [areas, subtopics, units, phrases] = await Promise.all([
      fetchAllTeacherRows<TeacherAreaRow>("curriculum_areas", true),
      fetchAllTeacherRows<TeacherSubtopicRow>("curriculum_subtopics", true),
      fetchAllTeacherRows<TeacherUnitRow>("curriculum_units", true),
      fetchAllTeacherRows<TeacherPhraseRow>("curriculum_phrases", true),
    ]);

    const normalizedError = areas.error ?? subtopics.error ?? units.error ?? phrases.error;
    if (normalizedError) {
      setMessage(`Curriculum could not load: ${normalizedError.message}`);
      setCurriculumLoading(false);
      return false;
    }

    setRows(normalizedRowsToCurriculumTopics({
      areas: (areas.data ?? []) as TeacherAreaRow[],
      subtopics: (subtopics.data ?? []) as TeacherSubtopicRow[],
      units: (units.data ?? []) as TeacherUnitRow[],
      phrases: (phrases.data ?? []) as TeacherPhraseRow[],
    }));
    if (showSuccess) {
      showToast("Curriculum refreshed successfully.");
    }
    setCurriculumLoading(false);
    return true;
  }, [showToast]);

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) {
        setProgress(loadProgress(storageKeyFor(data.session.user.id)));
        void fetchProfile(data.session.user);
        void fetchCurriculum();
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);
      if (nextSession) {
        setProgress(loadProgress(storageKeyFor(nextSession.user.id)));
        void fetchProfile(nextSession.user);
        void fetchCurriculum();
      } else {
        setProgress(defaultProgress);
        setRows([]);
        setView("dashboard");
      }
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [fetchCurriculum, fetchProfile]);

  useEffect(() => {
    if (session?.user.id) {
      saveProgress(storageKey, progress);
    }
  }, [progress, session?.user.id, storageKey]);

  useEffect(() => {
    if (!teacherHasUnpublishedChanges) return;

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [teacherHasUnpublishedChanges]);

  const navigateWithTeacherGuard = useCallback((nextView: AppView) => {
    if (view === "teacher" && nextView !== "teacher" && teacherHasUnpublishedChanges) {
      const shouldLeave = window.confirm("You have unpublished teacher changes. Leave Teacher Tools without publishing?");
      if (!shouldLeave) return;
    }
    setView(nextView);
  }, [teacherHasUnpublishedChanges, view]);

  function finishSession(reviewItems: ReviewItem[], durationSeconds: number, config: SessionConfig) {
    const preferredStudyLanguage = config.targetLanguage === "en" ? config.sourceLanguage : config.targetLanguage;
    setProgress((current) =>
      applyReviewItems(current, reviewItems, durationSeconds, {
        preferredSourceLanguage: "en",
        preferredTargetLanguage: preferredStudyLanguage,
        preferredTimerSeconds: config.timerSeconds,
        preferredPlayAudioEnabled: config.playAudioEnabled,
      }),
    );
  }

  function startSession(config: SessionConfig, mode: SessionMode) {
    unlockSpeech();
    const prompts = makePrompts(curriculum, config);
    const firstPrompt = prompts[0];
    const startedAudio = Boolean(firstPrompt && config.playAudioEnabled && speak(firstPrompt.prompt, config.sourceLanguage));
    setSessionPrompts(prompts);
    setInitialAudioSpoken(startedAudio);
    setSessionConfig(config);
    setSessionMode(mode);
  }

  if (loading) {
    return <LoadingScreen text="Opening APproved Practice" />;
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (sessionConfig) {
    return (
      <SessionRunner
        config={sessionConfig}
        curriculum={curriculum}
        mode={sessionMode}
        preparedPrompts={sessionPrompts}
        initialAudioSpoken={initialAudioSpoken}
        onBack={() => {
          setSessionPrompts([]);
          setSessionConfig(null);
        }}
        onFinish={(items, seconds) => {
          finishSession(items, seconds, sessionConfig);
          setSessionPrompts([]);
          setSessionConfig(null);
          setView("dashboard");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-app text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1180px] flex-col gap-5 px-4 py-4 md:px-8 md:py-7">
        <Sidebar
          view={view}
          profile={profile}
          isTeacher={isTeacher}
          onNavigate={navigateWithTeacherGuard}
          onSignOut={() => {
            if (teacherHasUnpublishedChanges && !window.confirm("You have unpublished teacher changes. Sign out without publishing?")) return;
            void supabase.auth.signOut();
          }}
        />
        <section className="min-w-0 flex-1 pb-10">
          {message ? <Notice message={message} onClose={() => setMessage(null)} /> : null}
          {curriculumLoading && curriculum.sections.length === 0 ? (
            <LoadingScreen text="Downloading curriculum topics" compact />
          ) : null}
          {!curriculumLoading && curriculum.sections.length === 0 ? (
            <EmptyState
              title="No curriculum loaded"
              body="The app is connected, but Supabase did not return curriculum rows for this account."
              action="Refresh curriculum"
              onAction={() => void fetchCurriculum(true)}
            />
          ) : null}
          {curriculum.sections.length > 0 && view === "dashboard" ? (
            <Dashboard
              progress={progress}
              onNavigate={navigateWithTeacherGuard}
              onRefresh={() => void fetchCurriculum(true)}
              isRefreshing={curriculumLoading}
            />
          ) : null}
          {curriculum.sections.length > 0 && view === "learn" ? (
            <SetupFlow
              title="Learn"
              mode="learn"
              curriculum={curriculum}
              progress={progress}
              onStart={startSession}
            />
          ) : null}
          {curriculum.sections.length > 0 && view === "practice" ? (
            <PracticeHub
              curriculum={curriculum}
              progress={progress}
              onStart={startSession}
              onMessage={setMessage}
            />
          ) : null}
          {curriculum.sections.length > 0 && view === "topics" ? (
            <TopicsView
              curriculum={curriculum}
              progress={progress}
              setProgress={setProgress}
              onStart={startSession}
            />
          ) : null}
          {curriculum.sections.length > 0 && view === "saved" ? (
            <SavedView
              curriculum={curriculum}
              progress={progress}
              setProgress={setProgress}
              onStart={startSession}
            />
          ) : null}
          {view === "teacher" ? (
            <TeacherTools
              userID={session.user.id}
              canUse={isTeacher}
              onChanged={() => void fetchCurriculum()}
              onMessage={setMessage}
              onDirtyChange={setTeacherHasUnpublishedChanges}
            />
          ) : null}
          {view === "settings" ? (
            <SettingsView
              profile={profile}
              progress={progress}
              setProgress={setProgress}
              onRefresh={() => void fetchCurriculum(true)}
              isRefreshing={curriculumLoading}
              onMessage={setMessage}
            />
          ) : null}
        </section>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"welcome" | "login" | "signup">("welcome");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
              data: {
                full_name: fullName.trim(),
                role: "student",
              },
            },
          })
        : await supabase.auth.signInWithPassword({ email: normalizedEmail, password });

    if (result.error) {
      setError(result.error.message);
    }
    setBusy(false);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-app px-5 py-8 text-slate-900">
      <section className="w-full max-w-3xl">
        {mode === "welcome" ? (
          <div className="space-y-7">
            <div className="space-y-3">
              <h1 className="text-5xl font-black tracking-normal text-slate-900">APproved Practice</h1>
              <p className="max-w-xl text-lg font-semibold text-slate-600">
                Active recall language learning for focused daily progress.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <FeatureCard icon={Sparkles} title="Learn with recall" body="Flashcards that repeat weak phrases intelligently." />
              <FeatureCard icon={Pencil} title="Practise in ways" body="Write, multiple choice, and listening in one place." />
              <FeatureCard icon={Star} title="Track what matters" body="Star difficult cards and focus mistakes quickly." />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button className="primary-button" onClick={() => setMode("signup")}>Get Started</button>
              <button className="secondary-button" onClick={() => setMode("login")}>Log In</button>
            </div>
          </div>
        ) : (
          <form
            className="panel max-w-xl space-y-5 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <button className="icon-text" type="button" onClick={() => setMode("welcome")}>
              <ChevronLeft size={18} /> Back
            </button>
            <div>
              <h1 className="text-4xl font-black">{mode === "signup" ? "Create account" : "Log In"}</h1>
              <p className="mt-2 font-semibold text-slate-600">
                {mode === "signup"
                  ? "New accounts start as students. Teacher access is approved separately."
                  : "Sign back in to continue your practice."}
              </p>
            </div>
            {mode === "signup" ? (
              <Input label="Name" value={fullName} onChange={setFullName} placeholder="Enter your full name" />
            ) : null}
            <Input label="Email" value={email} onChange={setEmail} placeholder="Enter your email" type="email" />
            <Input label="Password" value={password} onChange={setPassword} placeholder="Enter your password" type="password" />
            {error ? <p className="font-bold text-red-600">{error}</p> : null}
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Please wait..." : mode === "signup" ? "Create Account" : "Log In"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function Sidebar({
  view,
  profile,
  isTeacher,
  onNavigate,
  onSignOut,
}: {
  view: AppView;
  profile: Profile | null;
  isTeacher: boolean;
  onNavigate: (view: AppView) => void;
  onSignOut: () => void;
}) {
  const items: { view: AppView; label: string; icon: typeof LayoutDashboard }[] = [
    { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { view: "learn", label: "Learn", icon: BookOpen },
    { view: "practice", label: "Practice", icon: Pencil },
    { view: "topics", label: "Topics", icon: GraduationCap },
    { view: "saved", label: "Starred & Mistakes", icon: Star },
    ...(isTeacher ? [{ view: "teacher" as const, label: "Teacher Tools", icon: ShieldCheck }] : []),
    { view: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside className="app-nav flex shrink-0 flex-col gap-3 p-3">
      <div className="px-2 py-1 md:px-3">
        <div className="nav-title-row flex items-center justify-between gap-4">
          <h1 className="text-2xl font-black">APproved Practice</h1>
          <button className="nav-button signout-button" onClick={onSignOut}>
            <LogOut size={18} />
            <span>Log Out</span>
          </button>
        </div>
        <p className="mt-1 truncate text-sm font-bold text-slate-500">
          {profile?.full_name ?? "Student"} · {roleLabels[profile?.role ?? "student"]}
        </p>
      </div>
      <nav className="nav-scroll flex gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              className={`nav-button ${view === item.view ? "nav-button-active" : ""}`}
              onClick={() => onNavigate(item.view)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function Dashboard({
  progress,
  onNavigate,
  onRefresh,
  isRefreshing,
}: {
  progress: ProgressState;
  onNavigate: (view: AppView) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const stats = getStats(progress);
  const week = weeklyCards(progress);
  const maxWeek = Math.max(...week.map((day) => day.value), 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-4xl font-black md:text-5xl">APproved Practice</h2>
          <p className="mt-1 font-semibold text-slate-600">Your language learning, all in one place.</p>
        </div>
        <button className="secondary-button compact" disabled={isRefreshing} onClick={onRefresh}>
          <RefreshCw className={isRefreshing ? "spin-icon" : ""} size={17} /> {isRefreshing ? "Refreshing..." : "Refresh Curriculum"}
        </button>
      </header>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Shortcut tone="blue" title="Learn" body="Flashcards and active recall" icon={BookOpen} onClick={() => onNavigate("learn")} />
        <Shortcut tone="green" title="Practice" body="Write, multiple choice, and listen" icon={Pencil} onClick={() => onNavigate("practice")} />
        <Shortcut tone="orange" title="Topics" body="Organised by curriculum area" icon={GraduationCap} onClick={() => onNavigate("topics")} />
        <Shortcut tone="pink" title="Starred & Mistakes" body="Target difficult phrases" icon={Star} onClick={() => onNavigate("saved")} />
      </div>
      <h3 className="mt-2 text-3xl font-black">Progress</h3>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <section className="panel p-6">
          <div className="flex items-center justify-between">
            <h3 className="section-heading">Momentum</h3>
            <span className="pill">{progress.currentStreak} day streak</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <Metric label="Mastered" value={stats.mastered} detail="cards" />
            <Metric label="Accuracy" value={`${stats.accuracy}%`} detail="overall" />
            <Metric label="Review" value={`${stats.review}%`} detail="retained" />
            <Metric label="Cards Due" value={stats.due} detail="review" />
          </div>
        </section>
        <section className="panel p-6">
          <h3 className="section-heading">Knowledge Breakdown</h3>
          <div className="mt-5 space-y-4">
            <MasteryBar title="Confident" value={stats.mastered} total={stats.seen} color="bg-emerald-500" />
            <MasteryBar title="Needs Review" value={stats.partial} total={stats.seen} color="bg-amber-400" />
            <MasteryBar title="Mistakes" value={stats.mistakes} total={stats.seen} color="bg-rose-500" />
          </div>
        </section>
      </div>
      <section className="panel p-6">
        <div className="flex items-center justify-between">
          <h3 className="section-heading">Daily Cards</h3>
          <span className="text-sm font-bold text-slate-500">Last 7 days</span>
        </div>
        <div className="mt-5 flex h-56 items-end gap-3">
          {week.map((day) => (
            <div key={day.id} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-black">{day.value}</span>
              <div className="flex h-36 w-full items-end rounded-2xl bg-white/55">
                <div className="w-full rounded-2xl bg-gradient-to-t from-teal-200 to-teal-400" style={{ height: `${Math.max(8, (day.value / maxWeek) * 144)}px` }} />
              </div>
              <span className="text-xs font-bold text-slate-500">{day.day}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SetupFlow({
  title,
  mode,
  curriculum,
  progress,
  onStart,
  fixedPhraseIDs,
}: {
  title: string;
  mode: SessionMode;
  curriculum: StoredCurriculum;
  progress: ProgressState;
  onStart: (config: SessionConfig, mode: SessionMode) => void;
  fixedPhraseIDs?: string[];
}) {
  const [source, setSource] = useState<AppLanguage>(progress.preferredSourceLanguage);
  const initialStudyLanguage =
    progress.preferredTargetLanguage !== "en"
      ? progress.preferredTargetLanguage
      : progress.preferredSourceLanguage !== "en"
        ? progress.preferredSourceLanguage
        : "fr";
  const [target, setTarget] = useState<AppLanguage>(initialStudyLanguage);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [timerEnabled, setTimerEnabled] = useState(mode === "learn");
  const [autoContinue, setAutoContinue] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [playAudio, setPlayAudio] = useState(true);
  const [timerSeconds, setTimerSeconds] = useState(progress.preferredTimerSeconds);

  const fixedDirectionMode = mode === "write" || mode === "listening";
  const studyLanguage = target === "en" ? "fr" : target;
  const effectiveSource = fixedDirectionMode ? (mode === "listening" ? studyLanguage : "en") : source;
  const effectiveTarget = fixedDirectionMode ? (mode === "listening" ? "en" : studyLanguage) : target;
  const filteredCurriculum = useMemo(
    () => filterCurriculumForLanguages(curriculum, [effectiveSource, effectiveTarget]),
    [curriculum, effectiveSource, effectiveTarget],
  );
  const grouped = groupSectionsByArea(filteredCurriculum);
  const availableTopicIDs = useMemo(() => new Set(filteredCurriculum.topics.map((topic) => topic.id)), [filteredCurriculum]);
  const visibleSelected = useMemo(() => new Set([...selected].filter((id) => availableTopicIDs.has(id))), [availableTopicIDs, selected]);
  const selectedCount = visibleSelected.size;

  function start() {
    onStart(
      {
        sourceLanguage: effectiveSource,
        targetLanguage: effectiveTarget,
        topicIDs: [...visibleSelected],
        phraseIDs: fixedPhraseIDs,
        timerSeconds,
        timerEnabled,
        autoContinueEnabled: autoContinue,
        shuffleEnabled: shuffle,
        playAudioEnabled: playAudio,
      },
      mode,
    );
  }

  function chooseTarget(language: AppLanguage) {
    if (fixedDirectionMode) {
      setSource("en");
      setTarget(language);
      return;
    }

    setSource("en");
    setTarget(language);
  }

  function swap() {
    setSource(target);
    setTarget(source);
  }

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-4xl font-black">{title}</h2>
        <p className="mt-1 font-semibold text-slate-600">
          {fixedPhraseIDs ? `${fixedPhraseIDs.length} focused phrases selected` : `${selectedCount} topics selected`}
        </p>
      </header>
      <section className="panel p-4">
        {fixedDirectionMode ? (
          <div className="grid gap-3">
            <p className="text-sm font-black uppercase text-slate-500">
              {mode === "write" ? `English to ${languageLabel(studyLanguage)}` : `${languageLabel(studyLanguage)} to English`}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {targetLanguages.map((language) => (
                <button
                  key={language.code}
                  className={`choice-chip ${studyLanguage === language.code ? "choice-chip-active" : ""}`}
                  onClick={() => chooseTarget(language.code)}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
            <LanguageTile label={languageLabel(source)} />
            <button className="icon-button mx-auto" onClick={swap} title="Swap languages">⇄</button>
            <div className="grid grid-cols-3 gap-2">
              {targetLanguages.map((language) => (
                <button
                  key={language.code}
                  className={`choice-chip ${target === language.code ? "choice-chip-active" : ""}`}
                  onClick={() => chooseTarget(language.code)}
                >
                  {language.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Toggle label="Timer" checked={timerEnabled} onChange={setTimerEnabled} />
          <Toggle label="Auto Continue" checked={autoContinue} onChange={setAutoContinue} />
          <Toggle label="Shuffle" checked={shuffle} onChange={setShuffle} />
          <Toggle label="Play Audio" checked={playAudio} onChange={setPlayAudio} />
        </div>
        <label className="mt-4 block text-sm font-black text-slate-500">
          Timer Seconds
          <input
            className="mt-2 w-full accent-teal-500"
            min={4}
            max={30}
            type="range"
            value={timerSeconds}
            onChange={(event) => setTimerSeconds(Number(event.target.value))}
          />
          <span className="text-slate-900">{timerSeconds}s</span>
        </label>
      </section>
      {!fixedPhraseIDs ? (
        <TopicSelector grouped={grouped} selected={visibleSelected} setSelected={setSelected} />
      ) : null}
      <div className="sticky bottom-4 z-10">
        <button className="primary-button shadow-xl" disabled={!fixedPhraseIDs && visibleSelected.size === 0} onClick={start}>
          Start
        </button>
      </div>
    </div>
  );
}

function PracticeHub({
  curriculum,
  progress,
  onStart,
  onMessage,
}: {
  curriculum: StoredCurriculum;
  progress: ProgressState;
  onStart: (config: SessionConfig, mode: SessionMode) => void;
  onMessage: (message: string) => void;
}) {
  const base = (mode: PracticeMode, phraseIDs?: string[]) => (
    <SetupFlow
      title={mode === "write" ? "Write" : mode === "choice" ? "Multiple Choice" : mode === "listening" ? "Listening" : "Flashcards"}
      mode={mode}
      curriculum={curriculum}
      progress={progress}
      fixedPhraseIDs={phraseIDs}
      onStart={onStart}
    />
  );
  const [focused, setFocused] = useState<React.ReactNode | null>(null);
  const starred = progress.starredPhraseIDs;
  const mistakes = Object.entries(progress.phraseStatuses).filter(([, status]) => status === "forgot").map(([id]) => id);

  if (focused) {
    return (
      <div className="space-y-4">
        <button className="icon-text" onClick={() => setFocused(null)}><ChevronLeft size={18} /> Practice</button>
        {focused}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-4xl font-black">Practice</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ModeCard tone="green" icon={Pencil} title="Write" body="Type the translation and rate your recall" onClick={() => setFocused(base("write"))} />
        <ModeCard tone="blue" icon={CheckCircle2} title="Multiple Choice" body="Choose the correct translation" onClick={() => setFocused(base("choice"))} />
        <ModeCard tone="orange" icon={Ear} title="Listening" body="Hear the phrase and interpret it" onClick={() => setFocused(base("listening"))} />
        <ModeCard
          tone="yellow"
          icon={Star}
          title="Starred Practice"
          body={`${starred.length} saved phrases`}
          onClick={() => starred.length ? setFocused(base("flashcards", starred)) : onMessage("No starred terms available")}
        />
        <ModeCard
          tone="pink"
          icon={Sparkles}
          title="Mistake Practice"
          body={`${mistakes.length} phrases to fix`}
          onClick={() => mistakes.length ? setFocused(base("flashcards", mistakes)) : onMessage("No mistakes available")}
        />
      </div>
    </div>
  );
}

function SessionRunner({
  config,
  curriculum,
  mode,
  preparedPrompts,
  initialAudioSpoken,
  onFinish,
}: {
  config: SessionConfig;
  curriculum: StoredCurriculum;
  mode: SessionMode;
  preparedPrompts: SessionPrompt[];
  initialAudioSpoken: boolean;
  onBack: () => void;
  onFinish: (items: ReviewItem[], seconds: number) => void;
}) {
  const prompts = useMemo(
    () => (preparedPrompts.length ? preparedPrompts : makePrompts(curriculum, config)),
    [config, curriculum, preparedPrompts],
  );
  const [queue, setQueue] = useState(prompts.slice(1));
  const [current, setCurrent] = useState(prompts[0]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [startedAt] = useState(() => Date.now());
  const [revealed, setRevealed] = useState(false);
  const [hasSeenTranslation, setHasSeenTranslation] = useState(false);
  const [input, setInput] = useState("");
  const [suggested, setSuggested] = useState<LearnResult | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [endedEarly, setEndedEarly] = useState(false);
  const [completedSeconds, setCompletedSeconds] = useState(0);
  const [timer, setTimer] = useState(1);
  const spokenPromptID = useRef<string | null>(initialAudioSpoken && prompts[0] ? prompts[0].phraseID : null);
  const isFlashcardMode = mode === "learn" || mode === "flashcards";
  const choices = useMemo(
    () => (current && (mode === "choice" || mode === "listening") ? makeChoices(prompts, current, config.shuffleEnabled) : []),
    [config.shuffleEnabled, current, mode, prompts],
  );

  useEffect(() => {
    if (!current || !config.playAudioEnabled) return;
    if (spokenPromptID.current === current.phraseID) {
      return;
    }
    unlockSpeech();
    if (mode === "listening" || mode === "choice" || mode === "write") {
      speak(current.prompt, config.sourceLanguage);
    } else if (isFlashcardMode) {
      speak(current.prompt, config.sourceLanguage);
    }
    spokenPromptID.current = current.phraseID;
  }, [current, config.playAudioEnabled, config.sourceLanguage, initialAudioSpoken, mode, isFlashcardMode]);

  useEffect(() => {
    if (!isFlashcardMode || !config.timerEnabled || hasSeenTranslation || !current) return;
    window.setTimeout(() => setTimer(1), 0);
    const started = Date.now();
    const handle = window.setInterval(() => {
      const progress = Math.max(0, 1 - (Date.now() - started) / (config.timerSeconds * 1000));
      setTimer(progress);
      if (progress <= 0) {
        setRevealed(true);
        setHasSeenTranslation(true);
        if (config.playAudioEnabled) {
          unlockSpeech();
          speak(current.answer, config.targetLanguage);
        }
        window.clearInterval(handle);
      }
    }, 50);
    return () => window.clearInterval(handle);
  }, [config.playAudioEnabled, config.targetLanguage, config.timerEnabled, config.timerSeconds, current, hasSeenTranslation, isFlashcardMode]);

  const flipCard = useCallback(() => {
    if (!current) return;
    const nextRevealed = !revealed;
    setRevealed(nextRevealed);
    if (nextRevealed) {
      setHasSeenTranslation(true);
      if (config.playAudioEnabled) {
        unlockSpeech();
        speak(current.answer, config.targetLanguage);
      }
    } else if (config.playAudioEnabled) {
      unlockSpeech();
      speak(current.prompt, config.sourceLanguage);
    }
  }, [config.playAudioEnabled, config.sourceLanguage, config.targetLanguage, current, revealed]);

  const register = useCallback((result: LearnResult) => {
    if (!current) return;
    const reviewItem: ReviewItem = {
      id: crypto.randomUUID(),
      phraseID: current.phraseID,
      prompt: current.prompt,
      answer: current.answer,
      topicTitle: current.topicTitle,
      sectionTitle: current.sectionTitle,
      result,
    };
    const nextItems = [...items, reviewItem];
    const nextQueue = [...queue];
    if (result === "forgot") {
      nextQueue.splice(Math.min(5, nextQueue.length), 0, current);
    } else if (result === "partial") {
      nextQueue.push(current);
    }

    setItems(nextItems);
    setInput("");
    setSuggested(null);
    setSelectedChoice(null);
    setRevealed(false);
    setHasSeenTranslation(false);
    setTimer(1);
    if (nextQueue.length === 0) {
      setCompletedSeconds(Math.round((Date.now() - startedAt) / 1000));
      setComplete(true);
      return;
    }
    if (config.playAudioEnabled) {
      unlockSpeech();
      speak(nextQueue[0].prompt, config.sourceLanguage);
      spokenPromptID.current = nextQueue[0].phraseID;
    }
    setCurrent(nextQueue[0]);
    setQueue(nextQueue.slice(1));
  }, [config.playAudioEnabled, config.sourceLanguage, current, items, queue, startedAt]);

  function finishNow(finalItems = items) {
    onFinish(finalItems, Math.round((Date.now() - startedAt) / 1000));
  }

  function endSession() {
    setEndedEarly(true);
    setCompletedSeconds(Math.round((Date.now() - startedAt) / 1000));
    setComplete(true);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      if (complete || isTyping) return;

      if (isFlashcardMode && event.code === "Space") {
        event.preventDefault();
        unlockSpeech();
        flipCard();
        return;
      }

      if (isFlashcardMode && hasSeenTranslation) {
        const ratingByKey: Record<string, LearnResult> = {
          "1": "forgot",
          "2": "partial",
          "3": "perfect",
        };
        const rating = ratingByKey[event.key];
        if (rating) {
          event.preventDefault();
          register(rating);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [complete, hasSeenTranslation, isFlashcardMode, flipCard, register]);

  if (!current && !complete) {
    return <LoadingScreen text="Preparing session" />;
  }

  if (complete) {
    const perfect = items.filter((item) => item.result === "perfect").length;
    const partial = items.filter((item) => item.result === "partial").length;
    const forgot = items.filter((item) => item.result === "forgot").length;
    const percent = items.length ? Math.round((perfect / items.length) * 100) : 0;
    return (
      <main className="min-h-screen bg-app px-4 py-6 text-slate-900">
        <section className="mx-auto max-w-3xl space-y-5">
          <h1 className="text-4xl font-black">{endedEarly ? "Session ended" : mode === "learn" || mode === "flashcards" ? "Session completed" : "Practice completed"}</h1>
          <div className="panel p-6">
            <div className="text-6xl font-black">{percent}%</div>
            <p className="mt-2 text-lg font-bold text-slate-600">{perfect} / {items.length} perfect</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Perfect" value={perfect} detail="cards" />
            <Metric label="Partial" value={partial} detail="cards" />
            <Metric label="Forgot" value={forgot} detail="cards" />
            <Metric label="Time" value={formatDuration(completedSeconds)} detail="duration" />
          </div>
          <div className="panel max-h-80 overflow-auto p-4">
            {items.map((item) => (
              <div key={item.id} className="border-b border-white/50 py-3 last:border-0">
                <p className="font-black">{item.prompt}</p>
                <p className="font-semibold text-slate-600">{item.answer}</p>
                <span className={`result-dot ${item.result}`}>{resultLabels[item.result]}</span>
              </div>
            ))}
          </div>
          <button className="primary-button" onClick={() => finishNow()}>Finish</button>
        </section>
      </main>
    );
  }

  const questionNumber = items.length + 1;
  const total = Math.max(items.length + queue.length + 1, 1);
  const evaluation = mode === "write" ? evaluateAnswer(input, current.answer) : null;

  return (
    <main className="min-h-screen bg-app px-4 py-5 text-slate-900">
      <section className="mx-auto flex min-h-[calc(100vh-40px)] max-w-4xl flex-col gap-4">
        <header className="flex items-center justify-between">
          <span className="font-black">Question {questionNumber} of {total}</span>
          <button className="end-button" onClick={endSession}>End</button>
        </header>
        {isFlashcardMode && config.timerEnabled ? <div className="timer-track"><div style={{ width: `${timer * 100}%` }} /></div> : null}
        <div className="flex flex-1 flex-col justify-center gap-5">
          {mode === "listening" ? (
            <button className="audio-card" onClick={() => {
              unlockSpeech();
              speak(current.prompt, config.sourceLanguage);
            }}>
              <Volume2 size={54} />
              <span>Play Audio</span>
            </button>
          ) : (
            <button
              className={`flashcard ${revealed ? "revealed" : ""}`}
              onClick={() => isFlashcardMode && flipCard()}
            >
              <span className="flashcard-inner">
                <span className="flashcard-face flashcard-front">
                  <span className="text-xs font-black uppercase text-teal-500">{languageLabel(config.sourceLanguage)}</span>
                  <strong>{current.prompt}</strong>
                </span>
                <span className="flashcard-face flashcard-back">
                  <span className="text-xs font-black uppercase text-teal-500">{languageLabel(config.targetLanguage)}</span>
                  <strong>{current.answer}</strong>
                </span>
              </span>
              <span
                className="flashcard-audio"
                onClick={(event) => {
                  event.stopPropagation();
                  unlockSpeech();
                  speak(revealed && isFlashcardMode ? current.answer : current.prompt, revealed && isFlashcardMode ? config.targetLanguage : config.sourceLanguage);
                }}
              >
                <Volume2 size={24} />
              </span>
            </button>
          )}

          {isFlashcardMode ? (
            hasSeenTranslation ? <RatingButtons onRate={register} /> : <button className="primary-button" onClick={flipCard}>Flip Card</button>
          ) : null}

          {mode === "write" ? (
            <div className="space-y-4">
              <textarea
                className="answer-box"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setSuggested(null);
                }}
                placeholder={`Enter ${languageLabel(config.targetLanguage)}...`}
              />
              {suggested ? (
                <div className="panel p-4">
                  <p className="text-sm font-black uppercase text-slate-500">Your Answer</p>
                  <p className="mt-1 text-lg font-bold">
                    {highlightedAnswer(input, current.answer).map((part, index) => (
                      <span key={`${part.text}-${index}`} className={`answer-token ${part.status}`}>{part.text}</span>
                    ))}
                  </p>
                  <p className="text-sm font-black uppercase text-slate-500">Correct Answer</p>
                  <p className="mt-1 text-lg font-bold">{current.answer}</p>
                  <p className="mt-2 font-black text-teal-700">{evaluation?.feedback}</p>
                  <RatingButtons onRate={register} suggested={suggested} />
                </div>
              ) : (
                <button
                  className="primary-button"
                  onClick={() => {
                    const result = evaluateAnswer(input, current.answer).result;
                    setSuggested(input.trim() ? result : "forgot");
                    if (config.playAudioEnabled) {
                      unlockSpeech();
                      speak(current.answer, config.targetLanguage);
                    }
                  }}
                >
                  {input.trim() ? "Submit" : "Don't know"}
                </button>
              )}
            </div>
          ) : null}

          {mode === "choice" || mode === "listening" ? (
            <div className="grid gap-3">
              {choices.map((choice) => {
                const revealedChoice = selectedChoice !== null;
                const state = revealedChoice ? (choice === current.answer ? "correct" : choice === selectedChoice ? "wrong" : "") : "";
                return (
                  <button
                    key={choice}
                    className={`choice-option ${state}`}
                    disabled={revealedChoice}
                    onClick={() => setSelectedChoice(choice)}
                  >
                    {choice}
                  </button>
                );
              })}
              {selectedChoice !== null ? (
                <button className="primary-button" onClick={() => register(selectedChoice === current.answer ? "perfect" : "forgot")}>Next</button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function TopicsView({
  curriculum,
  progress,
  setProgress,
  onStart,
}: {
  curriculum: StoredCurriculum;
  progress: ProgressState;
  setProgress: (next: ProgressState | ((current: ProgressState) => ProgressState)) => void;
  onStart: (config: SessionConfig, mode: SessionMode) => void;
}) {
  const [openArea, setOpenArea] = useState<string | null>(null);
  const [openSectionID, setOpenSectionID] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<CurriculumTopic | null>(null);
  const browseLanguage = studyLanguageFromProgress(progress);
  const filteredCurriculum = useMemo(() => filterCurriculumForLanguages(curriculum, ["en", browseLanguage]), [browseLanguage, curriculum]);
  const grouped = groupSectionsByArea(filteredCurriculum);
  const openGroup = grouped.find((group) => group.code === openArea) ?? null;
  const openSection = openGroup?.sections.find((section) => section.id === openSectionID) ?? null;
  const visibleSelectedTopic = selectedTopic && filteredCurriculum.topics.some((topic) => topic.id === selectedTopic.id)
    ? selectedTopic
    : null;

  if (visibleSelectedTopic) {
    return (
      <div className="space-y-5">
        <button className="icon-text" onClick={() => setSelectedTopic(null)}>
          <ChevronLeft size={18} /> {openSection ? displayTitle(openSection.title) : "Topics"}
        </button>
        <section className="panel p-5">
          <p className="text-sm font-black text-slate-500">{displayTitle(visibleSelectedTopic.sectionTitle)}</p>
          <h2 className="mt-1 text-3xl font-black">{normalizeTitle(visibleSelectedTopic.titles.en)}</h2>
          <p className="mt-2 font-semibold text-slate-600">{visibleSelectedTopic.phrases.length} phrases</p>
          <PhraseList topic={visibleSelectedTopic} language={browseLanguage} progress={progress} setProgress={setProgress} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button className="primary-button" onClick={() => onStart(makeDefaultConfig(progress, [visibleSelectedTopic.id]), "learn")}>
              Learn Topic
            </button>
            <button className="secondary-button" onClick={() => onStart(makeDefaultConfig(progress, [visibleSelectedTopic.id]), "write")}>
              Write
            </button>
            <button className="secondary-button" onClick={() => onStart(makeDefaultConfig(progress, [visibleSelectedTopic.id]), "choice")}>
              Multiple Choice
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (grouped.length === 0) {
    return <EmptyState title="No topics for this language" body="Choose another language in practice settings, or add translations for this language in Teacher Tools." />;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-4xl font-black">
            {openSection ? displayTitle(openSection.title) : openGroup ? areaGroupLabel(openGroup) : "Topics"}
          </h2>
          <p className="mt-1 font-semibold text-slate-600">
            {openSection ? "Choose a subtopic to view phrases." : openGroup ? "Choose a curriculum subtopic." : "Browse vocabulary with curriculum topics."}
          </p>
        </div>
        {openSection ? (
          <button className="secondary-button compact" onClick={() => setOpenSectionID(null)}>
            <ChevronLeft size={17} /> {openGroup ? areaGroupLabel(openGroup) : "Area"}
          </button>
        ) : openGroup ? (
          <button
            className="secondary-button compact"
            onClick={() => {
              setOpenArea(null);
              setOpenSectionID(null);
            }}
          >
            <ChevronLeft size={17} /> All areas
          </button>
        ) : null}
      </header>
      {!openGroup ? (
        <div className="grid gap-5">
          {grouped.map((group) => (
            <AreaCard key={group.code} group={group} onClick={() => setOpenArea(group.code)} />
          ))}
        </div>
      ) : openSection ? (
        <div className="grid gap-5">
          {openSection.topics.map((topic, index) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              tone={toneForIndex(index)}
              onClick={() => setSelectedTopic(topic)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-5">
          {openGroup?.sections.map((section, index) => (
            <SectionCard
              key={section.id}
              section={section}
              tone={toneForIndex(index)}
              onClick={() => setOpenSectionID(section.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedView({
  curriculum,
  progress,
  setProgress,
  onStart,
}: {
  curriculum: StoredCurriculum;
  progress: ProgressState;
  setProgress: (next: ProgressState | ((current: ProgressState) => ProgressState)) => void;
  onStart: (config: SessionConfig, mode: SessionMode) => void;
}) {
  const [tab, setTab] = useState<"mistakes" | "starred">("mistakes");
  const phraseIDs =
    tab === "starred"
      ? progress.starredPhraseIDs
      : Object.entries(progress.phraseStatuses).filter(([, status]) => status === "forgot").map(([id]) => id);
  const displayLanguage = studyLanguageFromProgress(progress);
  const filteredCurriculum = useMemo(() => filterCurriculumForLanguages(curriculum, ["en", displayLanguage]), [curriculum, displayLanguage]);
  const topics = topicsForPhraseIDs(filteredCurriculum, phraseIDs);
  const availablePhraseIDs = new Set(filteredCurriculum.phrases.map((phrase) => phrase.id));
  const visiblePhraseIDs = phraseIDs.filter((id) => availablePhraseIDs.has(id));

  return (
    <div className="space-y-5">
      <h2 className="text-4xl font-black">Starred & Mistakes</h2>
      <div className="segmented">
        <button className={tab === "mistakes" ? "active" : ""} onClick={() => setTab("mistakes")}>Mistakes</button>
        <button className={tab === "starred" ? "active" : ""} onClick={() => setTab("starred")}>Starred</button>
      </div>
      {visiblePhraseIDs.length ? (
        <>
          <div className="grid gap-3">
            {topics.map((topic) => (
              <section className="panel p-4" key={topic.id}>
                <h3 className="font-black">{normalizeTitle(topic.titles.en)}</h3>
                <PhraseList topic={topic} language={displayLanguage} progress={progress} setProgress={setProgress} />
              </section>
            ))}
          </div>
          <button className="primary-button" onClick={() => onStart(makeDefaultConfig(progress, [], visiblePhraseIDs), "flashcards")}>
            Practice {tab === "mistakes" ? "Mistakes" : "Starred"}
          </button>
        </>
      ) : (
        <EmptyState title={`No ${tab} yet`} body="Items will appear here as you practise." />
      )}
    </div>
  );
}

function TeacherTools({
  userID,
  canUse,
  onChanged,
  onMessage,
  onDirtyChange,
}: {
  userID: string;
  canUse: boolean;
  onChanged: () => void;
  onMessage: (message: string) => void;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  const [mode, setMode] = useState<"add" | "edit" | "delete">("add");
  const [data, setData] = useState<TeacherCurriculumData>(emptyTeacherData);
  const [rawData, setRawData] = useState<TeacherCurriculumData>(emptyTeacherData);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editNode, setEditNode] = useState<TeacherNode | null>(null);
  const [areaID, setAreaID] = useState("");
  const [subtopicID, setSubtopicID] = useState("");
  const [unitID, setUnitID] = useState("");
  const [title, setTitle] = useState("");
  const [areaChoice, setAreaChoice] = useState<"existing" | "new">("existing");
  const [subtopicChoice, setSubtopicChoice] = useState<"existing" | "new">("existing");
  const [unitChoice, setUnitChoice] = useState<"existing" | "new">("existing");
  const [newAreaTitle, setNewAreaTitle] = useState("");
  const [newSubtopicTitle, setNewSubtopicTitle] = useState("");
  const [newUnitTitle, setNewUnitTitle] = useState("");
  const [languageTicks, setLanguageTicks] = useState<Record<Exclude<AppLanguage, "en">, boolean>>({ fr: true, es: true, it: true });
  const [bulkPairs, setBulkPairs] = useState("");
  const [phraseDraft, setPhraseDraft] = useState({ text_en: "", text_fr: "", text_it: "", text_es: "" });
  const [undo, setUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [, setHasUnpublishedChanges] = useState(false);
  const [, setLastAddSummary] = useState<AddResultSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ node: TeacherNode; total: number; restore: TeacherCurriculumData; ids: string[] } | null>(null);

  const selectedAreaSubtopics = areaChoice === "existing" && areaID ? subtopicsFor(data, areaID) : [];
  const selectedSubtopicUnits = subtopicChoice === "existing" && subtopicID ? unitsFor(data, subtopicID) : [];
  const selectedBulkLanguages = (["fr", "es", "it"] as Exclude<AppLanguage, "en">[]).filter((language) => languageTicks[language]);
  const bulkPlaceholder = `English phrase==${selectedBulkLanguages.map((language) => languageLabel(language)).join("**") || "Translation"}\nI like school==${selectedBulkLanguages.map((language) => ({ fr: "J'aime l'école", es: "Me gusta el colegio", it: "Mi piace la scuola" })[language]).join("**")}`;
  const bulkPreviewRows = parseMultilingualPhraseRows(bulkPairs, selectedBulkLanguages);

  function markTeacherDirty(isDirty: boolean) {
    setHasUnpublishedChanges(isDirty);
    onDirtyChange(isDirty);
  }

  const fetchTeacherData = useCallback(async () => {
    setLoading(true);
    const [areas, subtopics, units, phrases] = await Promise.all([
      fetchAllTeacherRows<TeacherAreaRow>("curriculum_areas"),
      fetchAllTeacherRows<TeacherSubtopicRow>("curriculum_subtopics"),
      fetchAllTeacherRows<TeacherUnitRow>("curriculum_units"),
      fetchAllTeacherRows<TeacherPhraseRow>("curriculum_phrases"),
    ]);
    const error = areas.error ?? subtopics.error ?? units.error ?? phrases.error;
    if (error) {
      onMessage(`Teacher curriculum could not load: ${error.message}`);
    } else {
      const nextData = {
        areas: (areas.data ?? []) as TeacherAreaRow[],
        subtopics: (subtopics.data ?? []) as TeacherSubtopicRow[],
        units: (units.data ?? []) as TeacherUnitRow[],
        phrases: (phrases.data ?? []) as TeacherPhraseRow[],
      };
      setRawData(nextData);
      setData(collapseTeacherData(nextData));
    }
    setLoading(false);
  }, [onMessage]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    if (canUse) {
      void Promise.resolve().then(fetchTeacherData);
    }
  }, [canUse, fetchTeacherData]);

  if (!canUse) {
    return <EmptyState title="Teacher access required" body="Your account is signed in, but teacher tools only unlock after the owner approves your profile role in Supabase." />;
  }

  function resetDrafts() {
    setTitle("");
    setBulkPairs("");
    setNewAreaTitle("");
    setNewSubtopicTitle("");
    setNewUnitTitle("");
    setPhraseDraft({ text_en: "", text_fr: "", text_it: "", text_es: "" });
    setEditNode(null);
  }

  async function reloadAfterChange(message: string) {
    await fetchTeacherData();
    await onChanged();
    onMessage(message);
  }

  async function saveAddChanges(publishImmediately = false) {
    setSaving(true);
    const createdIDs: { table: string; id: string }[] = [];
    let resolvedAreaID = areaID;
    let resolvedSubtopicID = subtopicID;
    let resolvedUnitID = unitID;

    if (areaChoice === "new") {
      const existingArea = data.areas.find((area) => teacherKey(area.title_en) === teacherKey(newAreaTitle));
      if (existingArea) {
        resolvedAreaID = existingArea.id;
      } else {
        const result = await supabase.from("curriculum_areas").insert({
          code: nextAreaCode(data.areas, newAreaTitle),
          title_en: newAreaTitle.trim(),
          sort_index: data.areas.length + 1,
          created_by: userID,
          is_published: false,
        }).select("id").single();
        if (result.error) {
          onMessage(`Add failed: ${result.error.message}`);
          setSaving(false);
          return;
        }
        resolvedAreaID = result.data.id;
        createdIDs.push({ table: "curriculum_areas", id: result.data.id });
      }
    }

    if (subtopicChoice === "new") {
      const areaSubtopics = subtopicsFor(data, resolvedAreaID);
      const existingSubtopic = areaSubtopics.find((subtopic) => teacherKey(subtopic.title_en) === teacherKey(newSubtopicTitle));
      if (existingSubtopic) {
        resolvedSubtopicID = existingSubtopic.id;
      } else {
        const result = await supabase.from("curriculum_subtopics").insert({
          area_id: resolvedAreaID,
          title_en: newSubtopicTitle.trim(),
          sort_index: areaSubtopics.length + 1,
          created_by: userID,
          is_published: false,
        }).select("id").single();
        if (result.error) {
          onMessage(`Add failed: ${result.error.message}`);
          setSaving(false);
          return;
        }
        resolvedSubtopicID = result.data.id;
        createdIDs.push({ table: "curriculum_subtopics", id: result.data.id });
      }
    }

    if (unitChoice === "new") {
      const subtopicUnits = unitsFor(data, resolvedSubtopicID);
      const existingUnit = subtopicUnits.find((unit) => teacherKey(unit.title_en) === teacherKey(newUnitTitle));
      if (existingUnit) {
        resolvedUnitID = existingUnit.id;
      } else {
        const result = await supabase.from("curriculum_units").insert({
          subtopic_id: resolvedSubtopicID,
          title_en: newUnitTitle.trim(),
          sort_index: subtopicUnits.length + 1,
          created_by: userID,
          is_published: false,
        }).select("id").single();
        if (result.error) {
          onMessage(`Add failed: ${result.error.message}`);
          setSaving(false);
          return;
        }
        resolvedUnitID = result.data.id;
        createdIDs.push({ table: "curriculum_units", id: result.data.id });
      }
    }

    const existingPhraseKeys = new Set(phrasesFor(data, resolvedUnitID).map((phrase) => teacherKey(phrase.text_en)));
    const phraseStartIndex = phrasesFor(data, resolvedUnitID).length;
    const parsedPhrases = parseMultilingualPhraseRows(bulkPairs, selectedBulkLanguages);
    const phrases = parsedPhrases
      .filter((phrase) => !existingPhraseKeys.has(teacherKey(phrase.text_en)))
      .map((phrase, index) => ({
        ...phrase,
        unit_id: resolvedUnitID,
        sort_index: phraseStartIndex + index + 1,
        created_by: userID,
        is_published: false,
      }));
    const skippedDuplicates = parsedPhrases.length - phrases.length;

    if (phrases.length === 0) {
      setLastAddSummary({ parsedRows: parsedPhrases.length, skippedDuplicates, insertedRows: 0 });
      onMessage(`Parsed ${parsedPhrases.length} row${parsedPhrases.length === 1 ? "" : "s"}, skipped ${skippedDuplicates} duplicate${skippedDuplicates === 1 ? "" : "s"}, inserted 0 rows.`);
      setSaving(false);
      return;
    }

    const result = await supabase.from("curriculum_phrases").insert(phrases).select("id");
    if (result.error) {
      onMessage(`Add failed: ${result.error.message}`);
      setSaving(false);
      return;
    }
    createdIDs.push(...(result.data ?? []).map((row) => ({ table: "curriculum_phrases", id: row.id })));

    const addSummary = { parsedRows: parsedPhrases.length, skippedDuplicates, insertedRows: phrases.length };
    setLastAddSummary(addSummary);
    const scope = { areaID: resolvedAreaID, subtopicID: resolvedSubtopicID, unitID: resolvedUnitID };
    setUndo({
      label: `Undo add`,
      run: async () => {
        if (!window.confirm("Undo this add? The new items will be removed.")) return;
        for (const row of [...createdIDs].reverse()) {
          await supabase.from(row.table).delete().eq("id", row.id);
        }
        setUndo(null);
        markTeacherDirty(true);
        await reloadAfterChange("Add undone. Publish when ready.");
      },
    });
    resetDrafts();
    markTeacherDirty(true);
    if (publishImmediately) {
      const publishedRows = await publishScopes([scope], false);
      if (publishedRows !== null) {
        markTeacherDirty(false);
        const publishedSummary = { ...addSummary, publishedRows };
        setLastAddSummary(publishedSummary);
        await reloadAfterChange(addSummaryText(publishedSummary));
      }
    } else {
      await reloadAfterChange(`${addSummaryText(addSummary)} Press Publish Changes when ready.`);
    }
    setSaving(false);
  }

  async function updateNode(publishImmediately = false) {
    if (!editNode) return;
    setSaving(true);
    const previous = editNode.row;
    const table = tableForLevel(editNode.level);

    if (editNode.level !== "phrase" && titleWouldDuplicate(data, editNode, title)) {
      onMessage(`Update failed: another ${teacherLevelLabels[editNode.level].toLowerCase()} already uses that title here.`);
      setSaving(false);
      return;
    }

    if (editNode.level === "phrase" && phraseWouldDuplicate(data, editNode.row, phraseDraft.text_en)) {
      onMessage("Update failed: another phrase in this sub-subtopic already uses that English text.");
      setSaving(false);
      return;
    }

    const payload =
      editNode.level === "phrase"
        ? { ...phraseDraft, is_published: false }
        : { title_en: title.trim(), is_published: false };
    const { error } = await supabase.from(table).update(payload).eq("id", previous.id);
    if (error) {
      onMessage(`Update failed: ${error.message}`);
    } else {
      setUndo({
        label: "Undo edit",
        run: async () => {
          if (!window.confirm("Undo this edit?")) return;
          await supabase.from(table).update(previous).eq("id", previous.id);
          setUndo(null);
          markTeacherDirty(true);
          await reloadAfterChange("Edit undone.");
        },
      });
      resetDrafts();
      markTeacherDirty(true);
      if (publishImmediately) {
        const publishedRows = await publishScopes([scopeForNode(data, editNode)], false);
        if (publishedRows !== null) {
          markTeacherDirty(false);
          await reloadAfterChange(`Updated and published ${publishedRows} row${publishedRows === 1 ? "" : "s"}.`);
        }
      } else {
        await reloadAfterChange("Updated. Press Publish Changes when ready.");
      }
    }
    setSaving(false);
  }

  async function deleteNode(node: TeacherNode) {
    const total = countDescendants(data, node);
    const restore = rowsForRestore(data, node);
    const deleteIDs = matchingRawIDsForNode(rawData, node);
    setPendingDelete({ node, total, restore, ids: deleteIDs.length ? deleteIDs : [node.row.id] });
    markTeacherDirty(true);
  }

  async function publishDelete() {
    if (!pendingDelete) return;
    const warning = pendingDelete.node.level === "phrase"
      ? ""
      : `\n\nThis will also remove the ${pendingDelete.total - 1} item${pendingDelete.total - 1 === 1 ? "" : "s"} inside it.`;
    if (!window.confirm(`Publish this deletion?\n\n${nodeLabel(pendingDelete.node)}${warning}\n\nTotal rows affected: ${pendingDelete.total}`)) return;
    setSaving(true);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) {
      onMessage("Delete failed: please sign in again.");
      setSaving(false);
      return;
    }

    const response = await fetch("/api/teacher/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({
        level: pendingDelete.node.level,
        id: pendingDelete.node.row.id,
        ids: pendingDelete.ids,
        match: deleteMatchForNode(rawData, pendingDelete.node),
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      onMessage(`Delete failed: ${result.error ?? "Unknown error"}`);
    } else {
      setUndo({
        label: `Undo delete (${pendingDelete.total} row${pendingDelete.total === 1 ? "" : "s"})`,
        run: async () => {
          if (!window.confirm("Undo this delete? The removed content will be restored.")) return;
          if (pendingDelete.restore.areas.length) await supabase.from("curriculum_areas").insert(pendingDelete.restore.areas);
          if (pendingDelete.restore.subtopics.length) await supabase.from("curriculum_subtopics").insert(pendingDelete.restore.subtopics);
          if (pendingDelete.restore.units.length) await supabase.from("curriculum_units").insert(pendingDelete.restore.units);
          if (pendingDelete.restore.phrases.length) await supabase.from("curriculum_phrases").insert(pendingDelete.restore.phrases);
          setUndo(null);
          markTeacherDirty(true);
          await reloadAfterChange("Delete undone.");
        },
      });
      setPendingDelete(null);
      markTeacherDirty(false);
      await reloadAfterChange("Deletion published.");
    }
    setSaving(false);
  }

  async function publishScopes(scopes: PublishScope[], confirmFirst = true) {
    if (confirmFirst && !window.confirm("Publish these curriculum changes?")) return null;
    setPublishing(true);
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) {
      onMessage("Publish failed: please sign in again.");
      setPublishing(false);
      return null;
    }
    const response = await fetch("/api/teacher/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionData.session.access_token}`,
      },
      body: JSON.stringify({ scopes }),
    });
    const result = await response.json();
    if (!response.ok) {
      onMessage(`Publish failed: ${result.error ?? "Unknown error"}`);
      setPublishing(false);
      return null;
    }
    setPublishing(false);
    return Number(result.published ?? 0);
  }

  function chooseEditNode(node: TeacherNode) {
    setEditNode(node);
    if (node.level === "phrase") {
      setPhraseDraft({
        text_en: node.row.text_en,
        text_fr: node.row.text_fr ?? "",
        text_it: node.row.text_it ?? "",
        text_es: node.row.text_es ?? "",
      });
    } else {
      setTitle(node.row.title_en);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-4xl font-black">Teacher Tools</h2>
          <p className="mt-1 font-semibold text-slate-600">Manage the shared normalized curriculum, then publish to the student-compatible table.</p>
        </div>
      </header>

      <div className="segmented teacher-tabs">
        {(["add", "edit", "delete"] as const).map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
            {item === "add" ? "Add" : item === "edit" ? "Edit" : "Delete"}
          </button>
        ))}
      </div>

      {undo ? (
        <section className="undo-banner">
          <span>{undo.label} is available for this browser session.</span>
          <button className="secondary-button compact" onClick={() => void undo.run()}>Undo</button>
        </section>
      ) : null}

      {mode === "add" ? (
        <section className="panel space-y-5 p-4">
          <TeacherAddStep
            title="Topic"
            mode={areaChoice}
            setMode={(value) => {
              setAreaChoice(value);
              setAreaID("");
              setSubtopicID("");
              setUnitID("");
              if (value === "new") {
                setSubtopicChoice("new");
                setUnitChoice("new");
              }
            }}
            existingLabel="Add to existing topic"
            newLabel="Create new topic"
            selectLabel="Existing topic"
            inputLabel="New topic title"
            value={areaID}
            onValue={setAreaID}
            newValue={newAreaTitle}
            onNewValue={setNewAreaTitle}
            options={sortRows(data.areas).map((area) => ({ value: area.id, label: areaLabel(area) }))}
          />
          <TeacherAddStep
            title="Subtopic"
            mode={subtopicChoice}
            setMode={(value) => {
              setSubtopicChoice(value);
              setSubtopicID("");
              setUnitID("");
              if (value === "new") {
                setUnitChoice("new");
              }
            }}
            existingLabel="Add to existing subtopic"
            newLabel="Create new subtopic"
            selectLabel="Existing subtopic"
            inputLabel="New subtopic title"
            value={subtopicID}
            onValue={setSubtopicID}
            newValue={newSubtopicTitle}
            onNewValue={setNewSubtopicTitle}
            options={selectedAreaSubtopics.map((subtopic) => ({ value: subtopic.id, label: displayTitle(subtopic.title_en) }))}
            existingDisabled={areaChoice === "new" || !areaID}
          />
          <TeacherAddStep
            title="Sub-subtopic"
            mode={unitChoice}
            setMode={(value) => {
              setUnitChoice(value);
              setUnitID("");
            }}
            existingLabel="Add to existing sub-subtopic"
            newLabel="Create new sub-subtopic"
            selectLabel="Existing sub-subtopic"
            inputLabel="New sub-subtopic title"
            value={unitID}
            onValue={setUnitID}
            newValue={newUnitTitle}
            onNewValue={setNewUnitTitle}
            options={selectedSubtopicUnits.map((unit) => ({ value: unit.id, label: displayTitle(unit.title_en) }))}
            existingDisabled={subtopicChoice === "new" || !subtopicID}
          />
          <div className="teacher-language-row">
            {(["fr", "es", "it"] as Exclude<AppLanguage, "en">[]).map((languageCode) => (
              <label key={languageCode} className="teacher-language-toggle">
                <input
                  type="checkbox"
                  checked={languageTicks[languageCode]}
                  onChange={(event) => setLanguageTicks({ ...languageTicks, [languageCode]: event.target.checked })}
                />
                Add {languageLabel(languageCode)}
              </label>
            ))}
          </div>
          <TextArea label="Bulk import phrases" value={bulkPairs} onChange={setBulkPairs} placeholder={bulkPlaceholder} />
          <BulkImportPreview rows={bulkPreviewRows} languages={selectedBulkLanguages} />
          <button className="primary-button" disabled={saving || publishing || !canPublishTeacherAdd(areaChoice, subtopicChoice, unitChoice, areaID, subtopicID, unitID, newAreaTitle, newSubtopicTitle, newUnitTitle, selectedBulkLanguages, bulkPairs)} onClick={() => void saveAddChanges(true)}>
            <Save size={18} /> {saving || publishing ? "Publishing..." : "Publish Changes"}
          </button>
        </section>
      ) : null}

      {mode === "edit" ? (
        <section className="panel space-y-4 p-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <TeacherTree data={data} action="edit" onChoose={chooseEditNode} framed={false} />
            <section className="rounded-[22px] border border-white/80 bg-white/70 p-4">
              {editNode ? (
                <div className="space-y-3">
                  <h3 className="section-heading">Edit {teacherLevelLabels[editNode.level]}</h3>
                  {editNode.level === "phrase" ? (
                    <div className="grid gap-3">
                      <Input label="English" value={phraseDraft.text_en} onChange={(value) => setPhraseDraft({ ...phraseDraft, text_en: value })} placeholder="English" multiline />
                      <Input label="French" value={phraseDraft.text_fr} onChange={(value) => setPhraseDraft({ ...phraseDraft, text_fr: value })} placeholder="French" multiline />
                      <Input label="Italian" value={phraseDraft.text_it} onChange={(value) => setPhraseDraft({ ...phraseDraft, text_it: value })} placeholder="Italian" multiline />
                      <Input label="Spanish" value={phraseDraft.text_es} onChange={(value) => setPhraseDraft({ ...phraseDraft, text_es: value })} placeholder="Spanish" multiline />
                    </div>
                  ) : (
                    <Input label="English title" value={title} onChange={setTitle} placeholder="Title" multiline />
                  )}
                  <div className="flex gap-2">
                    <button className="primary-button" disabled={saving || publishing} onClick={() => void updateNode(true)}><Save size={18} /> {saving || publishing ? "Publishing..." : "Publish Edit"}</button>
                    <button className="secondary-button compact" onClick={resetDrafts}><X size={18} /> Clear</button>
                  </div>
                </div>
              ) : <EmptyState title="Choose something to edit" body="Open a dropdown on the left, then press Edit next to any topic, subtopic, sub-subtopic, or phrase." />}
            </section>
          </div>
        </section>
      ) : null}

      {mode === "delete" ? (
        <section className="panel space-y-4 p-4">
          <TeacherTree data={data} action="delete" onChoose={(node) => void deleteNode(node)} framed={false} pendingNode={pendingDelete?.node ?? null} />
          {pendingDelete ? (
            <section className="delete-pending-banner">
              <div>
                <strong>Ready to delete: {nodeLabel(pendingDelete.node)}</strong>
                <span>{pendingDelete.total} item{pendingDelete.total === 1 ? "" : "s"} will be removed when you publish.</span>
              </div>
              <button className="secondary-button compact" onClick={() => {
                setPendingDelete(null);
                markTeacherDirty(false);
              }}>
                Cancel
              </button>
            </section>
          ) : null}
          <button className="primary-button" disabled={saving || !pendingDelete} onClick={() => void publishDelete()}>
            <Save size={18} /> {saving ? "Publishing..." : "Publish Deletion"}
          </button>
        </section>
      ) : null}

      {loading ? <LoadingScreen text="Loading teacher curriculum" compact /> : null}
    </div>
  );
}

function canPublishTeacherAdd(
  areaChoice: "existing" | "new",
  subtopicChoice: "existing" | "new",
  unitChoice: "existing" | "new",
  areaID: string,
  subtopicID: string,
  unitID: string,
  newAreaTitle: string,
  newSubtopicTitle: string,
  newUnitTitle: string,
  languages: Exclude<AppLanguage, "en">[],
  bulkPairs: string,
) {
  const hasArea = areaChoice === "new" ? newAreaTitle.trim().length > 0 : areaID.length > 0;
  const hasSubtopic = subtopicChoice === "new" ? newSubtopicTitle.trim().length > 0 : subtopicID.length > 0;
  const hasUnit = unitChoice === "new" ? newUnitTitle.trim().length > 0 : unitID.length > 0;
  return hasArea && hasSubtopic && hasUnit && languages.length > 0 && bulkPairs.trim().length > 0;
}

function addSummaryText(summary: AddResultSummary) {
  const parts = [
    `Parsed ${summary.parsedRows} row${summary.parsedRows === 1 ? "" : "s"}`,
    `skipped ${summary.skippedDuplicates} duplicate${summary.skippedDuplicates === 1 ? "" : "s"}`,
    `inserted ${summary.insertedRows} row${summary.insertedRows === 1 ? "" : "s"}`,
  ];

  if (typeof summary.publishedRows === "number") {
    parts.push(`published ${summary.publishedRows} row${summary.publishedRows === 1 ? "" : "s"}`);
  }

  return `${parts.join(", ")}.`;
}

function tableForLevel(level: TeacherLevel) {
  return {
    area: "curriculum_areas",
    subtopic: "curriculum_subtopics",
    unit: "curriculum_units",
    phrase: "curriculum_phrases",
  }[level];
}

function teacherKey(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^[A-Z]\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function areaLabel(area: TeacherAreaRow) {
  const title = displayTitle(area.title_en);
  return isDefaultArea(area) ? `${area.code?.trim()}: ${title}` : title;
}

function nodeLabel(node: TeacherNode) {
  if (node.level === "phrase") return node.row.text_en;
  if (node.level === "area") return areaLabel(node.row);
  return displayTitle(node.row.title_en);
}

function titleWouldDuplicate(data: TeacherCurriculumData, node: Exclude<TeacherNode, { level: "phrase" }>, nextTitle: string) {
  const nextKey = teacherKey(nextTitle);
  if (!nextKey) return false;

  if (node.level === "area") {
    return data.areas.some((area) => area.id !== node.row.id && teacherKey(area.title_en) === nextKey);
  }

  if (node.level === "subtopic") {
    return data.subtopics.some((subtopic) => subtopic.id !== node.row.id && subtopic.area_id === node.row.area_id && teacherKey(subtopic.title_en) === nextKey);
  }

  return data.units.some((unit) => unit.id !== node.row.id && unit.subtopic_id === node.row.subtopic_id && teacherKey(unit.title_en) === nextKey);
}

function phraseWouldDuplicate(data: TeacherCurriculumData, phrase: TeacherPhraseRow, nextEnglish: string) {
  const nextKey = teacherKey(nextEnglish);
  if (!nextKey) return false;
  return data.phrases.some((item) => item.id !== phrase.id && item.unit_id === phrase.unit_id && teacherKey(item.text_en) === nextKey);
}

function matchingRawIDsForNode(data: TeacherCurriculumData, node: TeacherNode) {
  if (node.level === "area") {
    const areaKey = teacherKey(node.row.title_en);
    const areaCodeKey = teacherKey(node.row.code);
    return data.areas
      .filter((area) => teacherKey(area.title_en) === areaKey || (areaCodeKey && teacherKey(area.code) === areaCodeKey))
      .map((area) => area.id);
  }

  if (node.level === "subtopic") {
    const parentArea = data.areas.find((area) => area.id === node.row.area_id);
    const areaKey = teacherKey(parentArea?.title_en);
    const areaCodeKey = teacherKey(parentArea?.code);
    const subtopicKey = teacherKey(node.row.title_en);
    return data.subtopics
      .filter((subtopic) => {
        const rawArea = data.areas.find((area) => area.id === subtopic.area_id);
        const sameArea = teacherKey(rawArea?.title_en) === areaKey || (areaCodeKey && teacherKey(rawArea?.code) === areaCodeKey);
        return sameArea && teacherKey(subtopic.title_en) === subtopicKey;
      })
      .map((subtopic) => subtopic.id);
  }

  if (node.level === "unit") {
    const parentSubtopic = data.subtopics.find((subtopic) => subtopic.id === node.row.subtopic_id);
    const parentArea = data.areas.find((area) => area.id === parentSubtopic?.area_id);
    const areaKey = teacherKey(parentArea?.title_en);
    const areaCodeKey = teacherKey(parentArea?.code);
    const subtopicKey = teacherKey(parentSubtopic?.title_en);
    const unitKey = teacherKey(node.row.title_en);
    return data.units
      .filter((unit) => {
        const rawSubtopic = data.subtopics.find((subtopic) => subtopic.id === unit.subtopic_id);
        const rawArea = data.areas.find((area) => area.id === rawSubtopic?.area_id);
        const sameArea = teacherKey(rawArea?.title_en) === areaKey || (areaCodeKey && teacherKey(rawArea?.code) === areaCodeKey);
        return sameArea && teacherKey(rawSubtopic?.title_en) === subtopicKey && teacherKey(unit.title_en) === unitKey;
      })
      .map((unit) => unit.id);
  }

  const parentUnit = data.units.find((unit) => unit.id === node.row.unit_id);
  const parentSubtopic = data.subtopics.find((subtopic) => subtopic.id === parentUnit?.subtopic_id);
  const parentArea = data.areas.find((area) => area.id === parentSubtopic?.area_id);
  const areaKey = teacherKey(parentArea?.title_en);
  const areaCodeKey = teacherKey(parentArea?.code);
  const subtopicKey = teacherKey(parentSubtopic?.title_en);
  const unitKey = teacherKey(parentUnit?.title_en);
  const phraseKey = [node.row.text_en, node.row.text_fr, node.row.text_it, node.row.text_es].map(teacherKey).join(":");

  return data.phrases
    .filter((phrase) => {
      const rawUnit = data.units.find((unit) => unit.id === phrase.unit_id);
      const rawSubtopic = data.subtopics.find((subtopic) => subtopic.id === rawUnit?.subtopic_id);
      const rawArea = data.areas.find((area) => area.id === rawSubtopic?.area_id);
      const sameArea = teacherKey(rawArea?.title_en) === areaKey || (areaCodeKey && teacherKey(rawArea?.code) === areaCodeKey);
      const rawPhraseKey = [phrase.text_en, phrase.text_fr, phrase.text_it, phrase.text_es].map(teacherKey).join(":");
      return sameArea && teacherKey(rawSubtopic?.title_en) === subtopicKey && teacherKey(rawUnit?.title_en) === unitKey && rawPhraseKey === phraseKey;
    })
    .map((phrase) => phrase.id);
}

function deleteMatchForNode(data: TeacherCurriculumData, node: TeacherNode) {
  if (node.level === "area") {
    return {
      areaCode: node.row.code ?? "",
      areaTitle: node.row.title_en,
    };
  }

  if (node.level === "subtopic") {
    const parentArea = data.areas.find((area) => area.id === node.row.area_id);
    return {
      areaCode: parentArea?.code ?? "",
      areaTitle: parentArea?.title_en ?? "",
      subtopicTitle: node.row.title_en,
    };
  }

  if (node.level === "unit") {
    const parentSubtopic = data.subtopics.find((subtopic) => subtopic.id === node.row.subtopic_id);
    const parentArea = data.areas.find((area) => area.id === parentSubtopic?.area_id);
    return {
      areaCode: parentArea?.code ?? "",
      areaTitle: parentArea?.title_en ?? "",
      subtopicTitle: parentSubtopic?.title_en ?? "",
      unitTitle: node.row.title_en,
    };
  }

  const parentUnit = data.units.find((unit) => unit.id === node.row.unit_id);
  const parentSubtopic = data.subtopics.find((subtopic) => subtopic.id === parentUnit?.subtopic_id);
  const parentArea = data.areas.find((area) => area.id === parentSubtopic?.area_id);
  return {
    areaCode: parentArea?.code ?? "",
    areaTitle: parentArea?.title_en ?? "",
    subtopicTitle: parentSubtopic?.title_en ?? "",
    unitTitle: parentUnit?.title_en ?? "",
    phrase: {
      text_en: node.row.text_en,
      text_fr: node.row.text_fr ?? "",
      text_it: node.row.text_it ?? "",
      text_es: node.row.text_es ?? "",
    },
  };
}

function scopeForNode(data: TeacherCurriculumData, node: TeacherNode): PublishScope {
  if (node.level === "area") return { areaID: node.row.id };
  if (node.level === "subtopic") return { subtopicID: node.row.id };
  if (node.level === "unit") return { unitID: node.row.id };

  const parentUnit = data.units.find((unit) => unit.id === node.row.unit_id);
  return parentUnit ? { unitID: parentUnit.id } : {};
}

function isSameTeacherNode(left: TeacherNode | null | undefined, right: TeacherNode) {
  return Boolean(left && left.level === right.level && left.row.id === right.row.id);
}

function nextAreaCode(areas: TeacherAreaRow[], title: string) {
  const used = new Set(areas.map((area) => area.code?.trim()).filter(Boolean));
  const firstLetter = title.trim().charAt(0).toUpperCase();
  if (/^[A-Z]$/.test(firstLetter) && !used.has(firstLetter)) {
    return firstLetter;
  }

  for (let code = 65; code <= 90; code += 1) {
    const candidate = String.fromCharCode(code);
    if (!used.has(candidate)) return candidate;
  }

  let index = areas.length + 1;
  while (used.has(`custom-${index}`)) {
    index += 1;
  }
  return `custom-${index}`;
}

function BulkImportPreview({ rows, languages }: { rows: ReturnType<typeof parseMultilingualPhraseRows>; languages: Exclude<AppLanguage, "en">[] }) {
  if (!rows.length) {
    return (
      <section className="bulk-preview empty">
        <strong>Preview</strong>
        <span>Paste phrases above to check them before publishing.</span>
      </section>
    );
  }

  return (
    <section className="bulk-preview">
      <strong>Preview</strong>
      <div className="bulk-preview-table">
        <table>
          <thead>
            <tr>
              <th>English</th>
              {languages.map((language) => <th key={language}>{languageLabel(language)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 1).map((row, index) => (
              <tr key={`${row.text_en}-${index}`}>
                <td>{row.text_en}</td>
                {languages.map((language) => <td key={language}>{row[`text_${language}`] || <span className="muted-cell">Empty</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeacherAddStep({
  title,
  mode,
  setMode,
  existingLabel,
  newLabel,
  selectLabel,
  inputLabel,
  value,
  onValue,
  newValue,
  onNewValue,
  options,
  existingDisabled = false,
}: {
  title: string;
  mode: "existing" | "new";
  setMode: (mode: "existing" | "new") => void;
  existingLabel: string;
  newLabel: string;
  selectLabel: string;
  inputLabel: string;
  value: string;
  onValue: (value: string) => void;
  newValue: string;
  onNewValue: (value: string) => void;
  options: { value: string; label: string }[];
  existingDisabled?: boolean;
}) {
  return (
    <section className="teacher-add-step">
      <div>
        <h3>{title}</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button className={`choice-chip ${mode === "existing" ? "choice-chip-active" : ""}`} disabled={existingDisabled} onClick={() => setMode("existing")}>
            {existingLabel}
          </button>
          <button className={`choice-chip ${mode === "new" ? "choice-chip-active" : ""}`} onClick={() => setMode("new")}>
            {newLabel}
          </button>
        </div>
      </div>
      {mode === "existing" ? (
        <SelectBox label={selectLabel} value={value} onChange={onValue} options={options} />
      ) : (
        <Input label={inputLabel} value={newValue} onChange={onNewValue} placeholder={inputLabel} />
      )}
    </section>
  );
}

function TeacherTree({
  data,
  action,
  onChoose,
  framed = true,
  pendingNode = null,
}: {
  data: TeacherCurriculumData;
  action: "edit" | "delete";
  onChoose: (node: TeacherNode) => void;
  framed?: boolean;
  pendingNode?: TeacherNode | null;
}) {
  const buttonLabel = action === "edit" ? "Edit" : "Delete";
  const className = framed ? "panel space-y-3 p-4" : "space-y-3";
  return (
    <section className={className}>
      <h3 className="section-heading">{action === "edit" ? "Edit curriculum" : "Delete curriculum"}</h3>
      {sortRows(data.areas).map((area) => {
        const areaNode: TeacherNode = { level: "area", row: area };
        return (
        <details key={area.id} className={`teacher-tree-node ${isSameTeacherNode(pendingNode, areaNode) ? "pending-delete" : ""}`}>
          <summary>
            <ChevronDown className="teacher-tree-chevron" size={18} />
            <span className="teacher-tree-title">{areaLabel(area)}</span>
            <button className={action === "delete" ? "danger-button compact" : "secondary-button compact"} onClick={(event) => { event.preventDefault(); onChoose(areaNode); }}>
              {buttonLabel}
            </button>
          </summary>
          <div className="teacher-tree-children">
            {subtopicsFor(data, area.id).map((subtopic) => {
              const subtopicNode: TeacherNode = { level: "subtopic", row: subtopic };
              return (
              <details key={subtopic.id} className={`teacher-tree-node ${isSameTeacherNode(pendingNode, subtopicNode) ? "pending-delete" : ""}`}>
                <summary>
                  <ChevronDown className="teacher-tree-chevron" size={18} />
                  <span className="teacher-tree-title">{displayTitle(subtopic.title_en)}</span>
                  <button className={action === "delete" ? "danger-button compact" : "secondary-button compact"} onClick={(event) => { event.preventDefault(); onChoose(subtopicNode); }}>
                    {buttonLabel}
                  </button>
                </summary>
                <div className="teacher-tree-children">
                  {unitsFor(data, subtopic.id).map((unit) => {
                    const unitNode: TeacherNode = { level: "unit", row: unit };
                    return (
                    <details key={unit.id} className={`teacher-tree-node ${isSameTeacherNode(pendingNode, unitNode) ? "pending-delete" : ""}`}>
                      <summary>
                        <ChevronDown className="teacher-tree-chevron" size={18} />
                        <span className="teacher-tree-title">{displayTitle(unit.title_en)}</span>
                        <button className={action === "delete" ? "danger-button compact" : "secondary-button compact"} onClick={(event) => { event.preventDefault(); onChoose(unitNode); }}>
                          {buttonLabel}
                        </button>
                      </summary>
                      <div className="teacher-tree-children">
                        {phrasesFor(data, unit.id).map((phrase) => {
                          const phraseNode: TeacherNode = { level: "phrase", row: phrase };
                          return (
                          <article key={phrase.id} className={`teacher-phrase-item ${isSameTeacherNode(pendingNode, phraseNode) ? "pending-delete" : ""}`}>
                            <span>{phrase.text_en}</span>
                            <button className={action === "delete" ? "danger-button compact" : "secondary-button compact"} onClick={() => onChoose(phraseNode)}>
                              {buttonLabel}
                            </button>
                          </article>
                        );})}
                      </div>
                    </details>
                  );})}
                </div>
              </details>
            );})}
          </div>
        </details>
      );})}
      {data.areas.length === 0 ? <EmptyState title="No curriculum yet" body="Use Add to create your first topic." /> : null}
    </section>
  );
}

function SelectBox({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-500">{label}</span>
      <select className="text-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose...</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-500">{label}</span>
      <textarea className="text-input min-h-40" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}
function SettingsView({
  profile,
  progress,
  setProgress,
  onRefresh,
  isRefreshing,
  onMessage,
}: {
  profile: Profile | null;
  progress: ProgressState;
  setProgress: (progress: ProgressState) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onMessage: (message: string) => void;
}) {
  async function deleteAccount() {
    const { error } = await supabase.functions.invoke("delete-account", { method: "POST" });
    if (error) {
      onMessage(`Delete failed: ${error.message}`);
    } else {
      await supabase.auth.signOut();
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-4xl font-black">Settings</h2>
      <section className="panel divide-y divide-white/50">
        <SettingRow title="Name" value={profile?.full_name ?? "Unknown"} />
        <SettingRow title="Email" value={profile?.email ?? "Unknown"} />
        <SettingRow title="Role" value={roleLabels[profile?.role ?? "student"]} />
        <SettingRow title="Progress" value={`${getStats(progress).seen} cards seen`} />
      </section>
      <div className="grid gap-3 md:grid-cols-3">
        <button className="secondary-button" disabled={isRefreshing} onClick={onRefresh}>
          <Download className={isRefreshing ? "spin-icon" : ""} size={18} /> {isRefreshing ? "Refreshing..." : "Refresh Curriculum"}
        </button>
        <button className="danger-button" onClick={() => setProgress(defaultProgress)}><Trash2 size={18} /> Reset Progress</button>
        <button className="danger-button" onClick={() => void deleteAccount()}><Trash2 size={18} /> Delete Account</button>
      </div>
    </div>
  );
}

function PhraseList({
  topic,
  language,
  progress,
  setProgress,
}: {
  topic: CurriculumTopic;
  language: Exclude<AppLanguage, "en">;
  progress: ProgressState;
  setProgress: (next: ProgressState | ((current: ProgressState) => ProgressState)) => void;
}) {
  const phrases = topic.phrases.filter((phrase) => phrase.translations.en.trim() && phrase.translations[language].trim());

  return (
    <div className="mt-3 grid gap-2">
      {phrases.map((phrase) => (
        <div key={phrase.id} className="phrase-row">
          <button
            className={`star-button ${progress.starredPhraseIDs.includes(phrase.id) ? "active" : ""}`}
            onClick={() =>
              setProgress((current) => ({
                ...current,
                starredPhraseIDs: current.starredPhraseIDs.includes(phrase.id)
                  ? current.starredPhraseIDs.filter((id) => id !== phrase.id)
                  : [...current.starredPhraseIDs, phrase.id],
              }))
            }
          >
            <Star size={18} fill="currentColor" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-black">{phrase.translations.en}</p>
            <p className="font-semibold text-slate-600">{phrase.translations[language]}</p>
          </div>
          <button className="icon-button" onClick={() => {
            unlockSpeech();
            speak(phrase.translations[language], language);
          }}><Volume2 size={18} /></button>
          <StatusPill status={progress.phraseStatuses[phrase.id] ?? "unseen"} />
        </div>
      ))}
    </div>
  );
}

function TopicSelector({
  grouped,
  selected,
  setSelected,
}: {
  grouped: ReturnType<typeof groupSectionsByArea>;
  selected: Set<string>;
  setSelected: (topics: Set<string>) => void;
}) {
  if (grouped.length === 0) {
    return <EmptyState title="No topics for this language" body="Choose another language or add translations for this one in Teacher Tools." />;
  }

  return (
    <section className="panel overflow-hidden">
      {grouped.map((group) => {
        const topicIDs = group.sections.flatMap((section) => section.topics.map((topic) => topic.id));
        const allSelected = topicIDs.every((id) => selected.has(id));
        return (
          <details key={group.code} className="selector-area">
            <summary>
              <button
                className={`tick-button ${allSelected ? "active" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  const next = new Set(selected);
                  topicIDs.forEach((id) => allSelected ? next.delete(id) : next.add(id));
                  setSelected(next);
                }}
              >
                {allSelected ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </button>
              <span className="min-w-0 flex-1">{areaGroupLabel(group)}</span>
              <ChevronDown className="selector-chevron" size={20} />
            </summary>
            <div className="space-y-2 pb-4 pl-7 pr-4">
              {group.sections.map((section) => {
                const sectionTopicIDs = section.topics.map((topic) => topic.id);
                const sectionSelected = sectionTopicIDs.length > 0 && sectionTopicIDs.every((id) => selected.has(id));
                return (
                  <details key={section.id} className="selector-section">
                    <summary>
                      <button
                        aria-label={`${sectionSelected ? "Clear" : "Select"} ${displayTitle(section.title)}`}
                        className={`tick-button ${sectionSelected ? "active" : ""}`}
                        disabled={sectionTopicIDs.length === 0}
                        onClick={(event) => {
                          event.preventDefault();
                          const next = new Set(selected);
                          sectionTopicIDs.forEach((id) => sectionSelected ? next.delete(id) : next.add(id));
                          setSelected(next);
                        }}
                      >
                        {sectionSelected ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      </button>
                      <span className="min-w-0 flex-1">{displayTitle(section.title)}</span>
                      <ChevronDown className="selector-chevron" size={18} />
                    </summary>
                    <div className="grid gap-2 border-l-2 border-teal-100 py-2 pl-5">
                      {section.topics.map((topic) => (
                        <button
                          key={topic.id}
                          className={`topic-select ${selected.has(topic.id) ? "active" : ""}`}
                          onClick={() => {
                            const next = new Set(selected);
                            if (next.has(topic.id)) next.delete(topic.id);
                            else next.add(topic.id);
                            setSelected(next);
                          }}
                        >
                          {selected.has(topic.id) ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                          {normalizeTitle(topic.titles.en)}
                        </button>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function RatingButtons({ onRate, suggested }: { onRate: (result: LearnResult) => void; suggested?: LearnResult }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(["forgot", "partial", "perfect"] as LearnResult[]).map((result) => (
        <button key={result} className={`rating-button ${result} ${suggested === result ? "suggested" : ""}`} onClick={() => onRate(result)}>
          {resultLabels[result]}
        </button>
      ))}
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string; multiline?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-500">{label}</span>
      {multiline ? (
        <textarea className="text-input edit-textarea" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      ) : (
        <input className="text-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} />
      )}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl bg-white/55 px-4 py-3 font-black">
      {label}
      <input className="h-5 w-5 accent-teal-500" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function FeatureCard({ icon: Icon, title, body }: { icon: typeof Sparkles; title: string; body: string }) {
  return <div className="panel p-5"><Icon className="text-teal-500" /><h2 className="mt-4 text-lg font-black">{title}</h2><p className="mt-1 font-semibold text-slate-600">{body}</p></div>;
}

function Shortcut({ icon: Icon, title, body, onClick, tone }: { icon: typeof BookOpen; title: string; body: string; onClick: () => void; tone: string }) {
  return <button className={`shortcut-card tone-${tone}`} onClick={onClick}><span className="card-icon"><Icon size={28} /></span><span>{title}</span><small>{body}</small></button>;
}

function ModeCard({ icon: Icon, title, body, onClick, tone }: { icon: typeof BookOpen; title: string; body: string; onClick: () => void; tone: string }) {
  return <button className={`mode-card tone-${tone}`} onClick={onClick}><span className="card-icon"><Icon size={30} /></span><span>{title}</span><small>{body}</small></button>;
}

function AreaCard({
  group,
  onClick,
}: {
  group: ReturnType<typeof groupSectionsByArea>[number];
  onClick: () => void;
}) {
  const phraseCount = group.sections.flatMap((section) => section.topics).reduce((total, topic) => total + topic.phrases.length, 0);
  const toneByCode: Record<string, string> = { A: "blue", B: "pink", C: "orange", D: "green", E: "purple" };
  return (
    <button className={`area-card tone-${toneByCode[group.code] ?? "blue"}`} onClick={onClick}>
      <span>
        <strong>{areaGroupLabel(group)}</strong>
        <small>{group.sections.length} subtopics</small>
        <em>{phraseCount} phrases</em>
      </span>
      <ChevronRight size={28} />
    </button>
  );
}

function SectionCard({
  section,
  tone,
  onClick,
}: {
  section: StoredCurriculum["sections"][number];
  tone: string;
  onClick: () => void;
}) {
  const phraseCount = section.topics.reduce((total, topic) => total + topic.phrases.length, 0);
  return (
    <button className={`area-card tone-${tone}`} onClick={onClick}>
      <span>
        <strong>{displayTitle(section.title)}</strong>
        <small>{section.topics.length} subtopics</small>
        <em>{phraseCount} phrases</em>
      </span>
      <ChevronRight size={28} />
    </button>
  );
}

function TopicCard({
  topic,
  tone,
  onClick,
}: {
  topic: CurriculumTopic;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className={`area-card topic-drill-card tone-${tone}`} onClick={onClick}>
      <span>
        <strong>{normalizeTitle(topic.titles.en)}</strong>
        <small>{displayTitle(topic.sectionTitle)}</small>
        <em>{topic.phrases.length} phrases</em>
      </span>
      <ChevronRight size={28} />
    </button>
  );
}

function toneForIndex(index: number) {
  return ["blue", "pink", "orange", "green", "purple", "yellow"][index % 6];
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function MasteryBar({ title, value, total, color }: { title: string; value: number; total: number; color: string }) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return <div><div className="mb-2 flex justify-between text-sm font-black"><span>{title}</span><span>{percent}%</span></div><div className="h-3 rounded-full bg-white/60"><div className={`h-3 rounded-full ${color}`} style={{ width: `${percent}%` }} /></div></div>;
}

function StatusPill({ status }: { status: PhraseStatus }) {
  return <span className={`status-pill ${status}`}>{status === "partial" ? "Review" : status}</span>;
}

function SettingRow({ title, value }: { title: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 p-4"><span className="font-black">{title}</span><span className="text-right font-semibold text-slate-600">{value}</span></div>;
}

function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="mb-4 flex items-center justify-between gap-3 rounded-3xl bg-teal-100 px-4 py-3 font-bold text-teal-900"><span>{message}</span><button onClick={onClose}><X size={18} /></button></div>;
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="panel grid min-h-72 place-items-center p-8 text-center"><div><h2 className="text-3xl font-black">{title}</h2><p className="mt-2 max-w-md font-semibold text-slate-600">{body}</p>{action ? <button className="primary-button mt-5" onClick={onAction}>{action}</button> : null}</div></div>;
}

function LoadingScreen({ text, compact = false }: { text: string; compact?: boolean }) {
  return <div className={`grid place-items-center ${compact ? "min-h-72" : "min-h-screen bg-app"}`}><div className="text-center"><RefreshCw className="mx-auto animate-spin text-teal-500" size={32} /><p className="mt-4 text-xl font-black">{text}</p></div></div>;
}

function LanguageTile({ label }: { label: string }) {
  return <div className="rounded-2xl bg-white/60 px-4 py-3 font-black">{label}</div>;
}

function groupSectionsByArea(curriculum: StoredCurriculum) {
  const groups = new Map<string, typeof curriculum.sections>();
  const titles = new Map<string, string>();
  const showCode = new Map<string, boolean>();

  for (const section of curriculum.sections) {
    const code = areaCode(section.title);
    const prefix = section.title.match(/^([^:]+)\s*:/)?.[1]?.trim() ?? code;
    const isDefaultArea = /^[A-E]$/.test(code);

    titles.set(code, isDefaultArea ? areaTitle(code) : displayTitle(prefix));
    showCode.set(code, isDefaultArea);
    groups.set(code, [...(groups.get(code) ?? []), { ...section, title: normalizeTitle(section.title) }]);
  }

  return Array.from(groups.entries()).map(([code, sections]) => ({
    code,
    title: titles.get(code) ?? code,
    showCode: showCode.get(code) ?? false,
    sections,
  }));
}

function areaGroupLabel(group: ReturnType<typeof groupSectionsByArea>[number]) {
  return group.showCode ? `${group.code}: ${group.title}` : group.title;
}

function filterCurriculumForLanguages(curriculum: StoredCurriculum, languages: AppLanguage[]): StoredCurriculum {
  const requiredLanguages = [...new Set(languages)].filter(Boolean);
  const topics = curriculum.topics
    .map((topic) => ({
      ...topic,
      phrases: topic.phrases.filter((phrase) =>
        requiredLanguages.every((language) => phrase.translations[language]?.trim()),
      ),
    }))
    .filter((topic) => topic.phrases.length > 0);
  const topicIDs = new Set(topics.map((topic) => topic.id));
  const topicByID = new Map(topics.map((topic) => [topic.id, topic]));
  const sections = curriculum.sections
    .map((section) => ({
      ...section,
      topics: section.topics
        .filter((topic) => topicIDs.has(topic.id))
        .map((topic) => topicByID.get(topic.id) ?? topic),
    }))
    .filter((section) => section.topics.length > 0);

  return {
    sections,
    topics,
    phrases: topics.flatMap((topic) => topic.phrases),
  };
}

function studyLanguageFromProgress(progress: ProgressState): Exclude<AppLanguage, "en"> {
  if (progress.preferredTargetLanguage !== "en") return progress.preferredTargetLanguage;
  if (progress.preferredSourceLanguage !== "en") return progress.preferredSourceLanguage;
  return "fr";
}

function isDefaultArea(area: TeacherAreaRow) {
  const code = area.code?.trim().toUpperCase();
  return Boolean(code && /^[A-E]$/.test(code) && displayTitle(area.title_en) === areaTitle(code));
}

function makeDefaultConfig(progress: ProgressState, topicIDs: string[], phraseIDs?: string[]): SessionConfig {
  return {
    sourceLanguage: progress.preferredSourceLanguage,
    targetLanguage: progress.preferredTargetLanguage,
    topicIDs,
    phraseIDs,
    timerSeconds: progress.preferredTimerSeconds,
    timerEnabled: false,
    autoContinueEnabled: false,
    shuffleEnabled: true,
    playAudioEnabled: progress.preferredPlayAudioEnabled,
  };
}

function normalizedRowsToCurriculumTopics(data: TeacherCurriculumData): CurriculumTopicRow[] {
  const rows: CurriculumTopicRow[] = [];
  const sortedAreas = sortRows(data.areas);

  for (const area of sortedAreas) {
    const areaPrefix = isDefaultArea(area) ? (area.code?.trim() ?? area.title_en) : area.title_en;
    const areaSubtopics = sortRows(data.subtopics.filter((subtopic) => subtopic.area_id === area.id));
    for (const subtopic of areaSubtopics) {
      const subtopicUnits = sortRows(data.units.filter((unit) => unit.subtopic_id === subtopic.id));
      for (const unit of subtopicUnits) {
        const unitPhrases = sortRows(data.phrases.filter((phrase) => phrase.unit_id === unit.id));
        rows.push({
          id: unit.id,
          sort_index: (area.sort_index ?? 0) * 10000 + (subtopic.sort_index ?? 0) * 100 + (unit.sort_index ?? 0),
          section_en: `${areaPrefix}: ${subtopic.title_en}`,
          subsection_en: unit.title_en,
          subsection_fr: unit.title_en,
          subsection_it: unit.title_en,
          subsection_es: unit.title_en,
          phrases_en: unitPhrases.map((phrase) => phrase.text_en),
          phrases_fr: unitPhrases.map((phrase) => phrase.text_fr ?? ""),
          phrases_it: unitPhrases.map((phrase) => phrase.text_it ?? ""),
          phrases_es: unitPhrases.map((phrase) => phrase.text_es ?? ""),
          updated_at: unit.updated_at,
          created_by: unit.created_by,
          is_published: unit.is_published,
          source_type: "teacher",
          created_at: unit.created_at,
        });
      }
    }
  }

  return rows;
}

function getStats(progress: ProgressState) {
  const statuses = Object.values(progress.phraseStatuses);
  const mastered = statuses.filter((status) => status === "perfect").length;
  const partial = statuses.filter((status) => status === "partial").length;
  const mistakes = statuses.filter((status) => status === "forgot").length;
  const seen = mastered + partial + mistakes;
  const accuracy = progress.totalResponses ? Math.round((progress.totalPerfect / progress.totalResponses) * 100) : 0;
  const review = progress.totalResponses ? Math.round(((progress.totalPerfect + progress.totalPartial) / progress.totalResponses) * 100) : 0;
  return { mastered, partial, mistakes, seen, due: partial + mistakes, accuracy, review };
}

function makePrompts(curriculum: StoredCurriculum, config: SessionConfig) {
  const selectedTopics = config.phraseIDs
    ? topicsForPhraseIDs(curriculum, config.phraseIDs)
    : curriculum.topics.filter((topic) => config.topicIDs.includes(topic.id));
  const phraseSet = config.phraseIDs ? new Set(config.phraseIDs) : null;
  const prompts = selectedTopics.flatMap((topic) =>
    topic.phrases
      .filter((phrase) => !phraseSet || phraseSet.has(phrase.id))
      .map((phrase) => ({
        phraseID: phrase.id,
        prompt: phrase.translations[config.sourceLanguage].trim(),
        answer: phrase.translations[config.targetLanguage].trim(),
        topicTitle: topic.titles[config.targetLanguage] || topic.titles.en,
        sectionTitle: topic.sectionTitle,
      }))
      .filter((prompt) => prompt.prompt && prompt.answer),
  );
  return config.shuffleEnabled ? prompts.sort(() => Math.random() - 0.5) : prompts;
}

function topicsForPhraseIDs(curriculum: StoredCurriculum, phraseIDs: string[]) {
  const set = new Set(phraseIDs);
  return curriculum.topics
    .map((topic) => ({ ...topic, phrases: topic.phrases.filter((phrase) => set.has(phrase.id)) }))
    .filter((topic) => topic.phrases.length);
}

function makeChoices(prompts: ReturnType<typeof makePrompts>, current: ReturnType<typeof makePrompts>[number], shuffle: boolean) {
  const wrong = [...new Set(prompts.map((prompt) => prompt.answer).filter((answer) => answer !== current.answer))];
  const chosen = (shuffle ? wrong.sort(() => Math.random() - 0.5) : wrong).slice(0, 3);
  while (chosen.length < 3 && wrong.length) chosen.push(wrong[chosen.length % wrong.length]);
  return [...chosen, current.answer].sort(() => Math.random() - 0.5);
}

function evaluateAnswer(input: string, answer: string): { result: LearnResult; feedback: string } {
  const normalizedInput = normalizeAnswer(input);
  const normalizedAnswer = normalizeAnswer(answer);
  if (!normalizedInput) return { result: "forgot", feedback: "" };
  if (normalizedInput === normalizedAnswer) return { result: "perfect", feedback: "100% correct" };
  const inputWords = normalizedInput.split(" ");
  const answerWords = normalizedAnswer.split(" ");
  const exact = answerWords.filter((word, index) => inputWords[index] === word).length;
  const close = answerWords.filter((word) => inputWords.some((inputWord) => levenshtein(word, inputWord) <= 2)).length;
  const score = Math.max(exact, close) / Math.max(answerWords.length, 1);
  return score >= 0.7 ? { result: "partial", feedback: "Partially recalled" } : { result: "forgot", feedback: "" };
}

function highlightedAnswer(input: string, answer: string): { text: string; status: "exact" | "close" | "none" }[] {
  const originalWords = input.trim().split(/\s+/).filter(Boolean);
  const inputWords = normalizeAnswer(input).split(" ").filter(Boolean);
  const answerWords = normalizeAnswer(answer).split(" ").filter(Boolean);
  const used = new Set<number>();

  return originalWords.map((word, index) => {
    const normalized = inputWords[index] ?? normalizeAnswer(word);
    const exactIndex = answerWords.findIndex((answerWord, answerIndex) => !used.has(answerIndex) && answerWord === normalized);
    if (exactIndex >= 0) {
      used.add(exactIndex);
      return { text: word, status: "exact" };
    }

    const closeIndex = answerWords.findIndex((answerWord, answerIndex) => !used.has(answerIndex) && levenshtein(answerWord, normalized) <= 2);
    if (closeIndex >= 0) {
      used.add(closeIndex);
      return { text: word, status: "close" };
    }

    return { text: word, status: "none" };
  });
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function normalizeAnswer(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1] ? matrix[i - 1][j - 1] : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[a.length][b.length];
}
