import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://jomlceougvxmnlztppms.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvbWxjZW91Z3Z4bW5senRwcG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTIzMjAsImV4cCI6MjA5MzU2ODMyMH0.nvflZjGbg4gCSHVaE1H3ATxUc561YDtetXvcpWViGd8";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type PublishScope = {
  areaID?: string;
  subtopicID?: string;
  unitID?: string;
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json({ error: "Missing authorization" }, { status: 401 });
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return Response.json({ error: "Missing access token" }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json({ error: userError?.message ?? "Not signed in" }, { status: 401 });
  }

  const userID = userData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userID)
    .single();

  if (profileError || !["teacher", "admin"].includes(String(profile?.role))) {
    return Response.json({ error: "Teacher access required" }, { status: 403 });
  }

  const curriculumClient = supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
        },
      })
    : supabase;

  const body = await request.json().catch(() => ({}));
  const scopes = Array.isArray(body?.scopes) ? (body.scopes as PublishScope[]) : [];
  const areaIDs = [...new Set(scopes.map((scope) => scope.areaID).filter(Boolean) as string[])];
  const subtopicIDs = [...new Set(scopes.map((scope) => scope.subtopicID).filter(Boolean) as string[])];
  const unitIDs = [...new Set(scopes.map((scope) => scope.unitID).filter(Boolean) as string[])];

  const [areasResult, subtopicsResult, unitsResult, phrasesResult] = scopes.length
    ? await Promise.all([
        areaIDs.length
          ? curriculumClient.from("curriculum_areas").update({ is_published: true }).in("id", areaIDs).select("id")
          : { data: [], error: null },
        subtopicIDs.length
          ? curriculumClient.from("curriculum_subtopics").update({ is_published: true }).in("id", subtopicIDs).select("id")
          : { data: [], error: null },
        unitIDs.length
          ? curriculumClient.from("curriculum_units").update({ is_published: true }).in("id", unitIDs).select("id")
          : { data: [], error: null },
        unitIDs.length
          ? curriculumClient.from("curriculum_phrases").update({ is_published: true }).in("unit_id", unitIDs).select("id")
          : { data: [], error: null },
      ])
    : await Promise.all([
        curriculumClient.from("curriculum_areas").update({ is_published: true }).neq("is_published", true).select("id"),
        curriculumClient.from("curriculum_subtopics").update({ is_published: true }).neq("is_published", true).select("id"),
        curriculumClient.from("curriculum_units").update({ is_published: true }).neq("is_published", true).select("id"),
        curriculumClient.from("curriculum_phrases").update({ is_published: true }).neq("is_published", true).select("id"),
      ]);

  const publishError = areasResult.error ?? subtopicsResult.error ?? unitsResult.error ?? phrasesResult.error;
  if (publishError) {
    return Response.json({ error: publishError.message }, { status: 400 });
  }

  const published =
    (areasResult.data?.length ?? 0) +
    (subtopicsResult.data?.length ?? 0) +
    (unitsResult.data?.length ?? 0) +
    (phrasesResult.data?.length ?? 0);

  return Response.json({
    published,
    counts: {
      areas: areasResult.data?.length ?? 0,
      subtopics: subtopicsResult.data?.length ?? 0,
      units: unitsResult.data?.length ?? 0,
      phrases: phrasesResult.data?.length ?? 0,
    },
  });
}
