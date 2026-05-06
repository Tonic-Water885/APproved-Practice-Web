import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { TeacherLevel } from "@/lib/teacher-curriculum";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://jomlceougvxmnlztppms.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvbWxjZW91Z3Z4bW5senRwcG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTIzMjAsImV4cCI6MjA5MzU2ODMyMH0.nvflZjGbg4gCSHVaE1H3ATxUc561YDtetXvcpWViGd8";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const tableByLevel: Record<TeacherLevel, string> = {
  area: "curriculum_areas",
  subtopic: "curriculum_subtopics",
  unit: "curriculum_units",
  phrase: "curriculum_phrases",
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

  const body = await request.json().catch(() => null);
  const level = body?.level as TeacherLevel | undefined;
  const id = typeof body?.id === "string" ? body.id : "";
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
    : [];
  const match = typeof body?.match === "object" && body.match ? body.match as DeleteMatch : null;
  let deleteIDs = ids.length ? ids : id ? [id] : [];
  const table = level ? tableByLevel[level] : null;

  if (!level || !table || (deleteIDs.length === 0 && !match)) {
    return Response.json({ error: "Delete requires a valid normalized curriculum level and id" }, { status: 400 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json({ error: userError?.message ?? "Not signed in" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !["teacher", "admin"].includes(String(profile?.role))) {
    return Response.json({ error: "Teacher access required" }, { status: 403 });
  }

  const deleteClient = supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
        },
      })
    : userClient;

  if (match) {
    const matchedIDs = await findMatchingDeleteIDs(deleteClient, level, match);
    deleteIDs = Array.from(new Set([...deleteIDs, ...matchedIDs]));
  }

  if (deleteIDs.length === 0) {
    return Response.json({ error: "No matching normalized row could be found for this visible curriculum item." }, { status: 404 });
  }

  if (!supabaseServiceRoleKey) {
    let rpcDeletedTotal = 0;
    let rpcMissing = false;

    for (const deleteID of deleteIDs) {
      const { data: rpcDeletedCount, error: rpcError } = await userClient.rpc("teacher_delete_curriculum_node", {
        node_level: level,
        node_id: deleteID,
      });

      if (rpcError) {
        if (rpcError.code === "42883" || rpcError.message.toLowerCase().includes("function")) {
          rpcMissing = true;
          break;
        }

        return Response.json({ error: rpcError.message }, { status: 400 });
      }

      const deletedCount = Number(rpcDeletedCount ?? 0);
      rpcDeletedTotal += deletedCount;
    }

    if (!rpcMissing) {
      if (rpcDeletedTotal < 1) {
        return Response.json({ error: "No normalized row was deleted. Check that this row still exists." }, { status: 404 });
      }
      return Response.json({ deleted: rpcDeletedTotal, table, ids: deleteIDs });
    }
  }

  const { count: deletedCount, error: deleteError } = await deleteClient
    .from(table)
    .delete({ count: "exact" })
    .in("id", deleteIDs);

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 400 });
  }

  if (deletedCount === 0) {
    return Response.json(
      { error: "No normalized row was deleted. Check that this row exists and the teacher account is allowed to delete it. If RLS ownership is blocking deletes, deploy tools/supabase_teacher_delete_helpers.sql or set SUPABASE_SERVICE_ROLE_KEY for the web server." },
      { status: 404 },
    );
  }

  return Response.json({ deleted: deletedCount ?? deleteIDs.length, table, ids: deleteIDs });
}

type DeleteMatch = {
  areaCode?: string;
  areaTitle?: string;
  subtopicTitle?: string;
  unitTitle?: string;
  phrase?: {
    text_en?: string;
    text_fr?: string;
    text_it?: string;
    text_es?: string;
  };
};

function keyFor(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^[A-Z]\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function findMatchingDeleteIDs(
  client: SupabaseClient,
  level: TeacherLevel,
  match: DeleteMatch,
) {
  const { data: areas, error: areasError } = await client
    .from("curriculum_areas")
    .select("id,code,title_en");

  if (areasError) throw new Error(areasError.message);

  const areaCodeKey = keyFor(match.areaCode);
  const areaTitleKey = keyFor(match.areaTitle);
  const areaIDs = (areas ?? [])
    .filter((area) => {
      const codeMatches = areaCodeKey ? keyFor(area.code) === areaCodeKey : false;
      const titleMatches = areaTitleKey ? keyFor(area.title_en) === areaTitleKey : false;
      return codeMatches || titleMatches;
    })
    .map((area) => area.id as string);

  if (level === "area") return areaIDs;
  if (!areaIDs.length) return [];

  const { data: subtopics, error: subtopicsError } = await client
    .from("curriculum_subtopics")
    .select("id,area_id,title_en")
    .in("area_id", areaIDs);

  if (subtopicsError) throw new Error(subtopicsError.message);

  const subtopicTitleKey = keyFor(match.subtopicTitle);
  const subtopicIDs = (subtopics ?? [])
    .filter((subtopic) => keyFor(subtopic.title_en) === subtopicTitleKey)
    .map((subtopic) => subtopic.id as string);

  if (level === "subtopic") return subtopicIDs;
  if (!subtopicIDs.length) return [];

  const { data: units, error: unitsError } = await client
    .from("curriculum_units")
    .select("id,subtopic_id,title_en")
    .in("subtopic_id", subtopicIDs);

  if (unitsError) throw new Error(unitsError.message);

  const unitTitleKey = keyFor(match.unitTitle);
  const unitIDs = (units ?? [])
    .filter((unit) => keyFor(unit.title_en) === unitTitleKey)
    .map((unit) => unit.id as string);

  if (level === "unit") return unitIDs;
  if (!unitIDs.length) return [];

  const { data: phrases, error: phrasesError } = await client
    .from("curriculum_phrases")
    .select("id,unit_id,text_en,text_fr,text_it,text_es")
    .in("unit_id", unitIDs);

  if (phrasesError) throw new Error(phrasesError.message);

  const phraseKey = [
    match.phrase?.text_en,
    match.phrase?.text_fr,
    match.phrase?.text_it,
    match.phrase?.text_es,
  ].map(keyFor).join(":");

  return (phrases ?? [])
    .filter((phrase) => [phrase.text_en, phrase.text_fr, phrase.text_it, phrase.text_es].map(keyFor).join(":") === phraseKey)
    .map((phrase) => phrase.id as string);
}
