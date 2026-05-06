import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AppLanguage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const preferredVoices: Record<AppLanguage, string[]> = {
  en: ["Daniel", "Sandy (English (UK))", "Shelley (English (UK))", "Eddy (English (UK))"],
  fr: ["Thomas", "Eddy (French (France))", "Flo (French (France))", "Sandy (French (France))", "Shelley (French (France))", "Amélie", "Jacques"],
  it: ["Alice", "Eddy (Italian (Italy))", "Flo (Italian (Italy))", "Sandy (Italian (Italy))", "Shelley (Italian (Italy))"],
  es: ["Mónica", "Eddy (Spanish (Spain))", "Flo (Spanish (Spain))", "Sandy (Spanish (Spain))", "Shelley (Spanish (Spain))", "Paulina"],
};

let installedVoiceNames: Promise<Set<string>> | null = null;

async function getInstalledVoiceNames() {
  installedVoiceNames ??= execFileAsync("/usr/bin/say", ["-v", "?"], { timeout: 5000 }).then(({ stdout }) => {
    const names = new Set<string>();
    for (const line of stdout.split("\n")) {
      const match = line.match(/^(.+?)\s{2,}[a-z]{2}_[A-Z]{2}\s+#/);
      if (match?.[1]) {
        names.add(match[1].trim());
      }
    }
    return names;
  });

  return installedVoiceNames;
}

async function bestVoiceFor(language: AppLanguage) {
  const voices = await getInstalledVoiceNames();
  return preferredVoices[language].find((voice) => voices.has(voice)) ?? preferredVoices.en[0];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get("text") ?? "").trim().slice(0, 700);
  const language = (url.searchParams.get("lang") ?? "en") as AppLanguage;

  if (!text) {
    return Response.json({ error: "Missing text" }, { status: 400 });
  }

  const voice = await bestVoiceFor(language);

  if (url.searchParams.get("direct") === "1") {
    await execFileAsync("/usr/bin/killall", ["say"], { timeout: 1000 }).catch(() => undefined);
    const sayProcess = spawn("/usr/bin/say", ["-v", voice, text], {
      detached: true,
      stdio: "ignore",
    });
    sayProcess.unref();

    return Response.json(
      { voice },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-TTS-Voice": encodeURIComponent(voice),
        },
      },
    );
  }

  const base = join(tmpdir(), `approved-practice-tts-${randomUUID()}`);
  const aiffPath = `${base}.aiff`;
  const m4aPath = `${base}.m4a`;

  try {
    await execFileAsync("/usr/bin/say", ["-v", voice, "-o", aiffPath, text], { timeout: 12000 });
    await execFileAsync("/usr/bin/afconvert", [aiffPath, m4aPath, "-f", "m4af", "-d", "aac"], { timeout: 12000 });
    const audio = await readFile(m4aPath);

    return new Response(audio, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/mp4",
        "X-TTS-Voice": encodeURIComponent(voice),
      },
    });
  } catch (error) {
    const fallbackMessage = error instanceof Error ? error.message : "Device TTS failed";
    return Response.json({ error: fallbackMessage }, { status: 500 });
  } finally {
    await Promise.allSettled([rm(aiffPath, { force: true }), rm(m4aPath, { force: true })]);
  }
}
