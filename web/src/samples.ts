// Pre-made sample clips in public/samples, written by scripts/make-samples.py on the Mac mini. They play
// even while the engine is offline, which is what keeps the page worth visiting when the Mac is asleep.

import type { Voice } from "./api";

export type Sample = { voice_id: string; file: string; text: string; emotion: string };
export type SampleManifest = { generated_at: string | null; voices: (Partial<Voice> & Sample)[] };

export async function loadSamples(): Promise<SampleManifest> {
  try {
    const response = await fetch("/samples/manifest.json", { cache: "no-cache" });
    const manifest = await response.json();
    return Array.isArray(manifest.voices) ? manifest : { generated_at: null, voices: [] };
  } catch {
    return { generated_at: null, voices: [] };
  }
}

const preset = (id: string, name: string, engine: Voice["engine"], gender: string, accent: string, description: string, supports_emotion: boolean): Voice => ({
  id,
  name,
  engine,
  description,
  gender,
  accent,
  grade: "",
  supports_emotion,
  source: "preset",
  featured: true,
  recommended: id === "kokoro:af_heart" || id === "chatterbox:default",
  created_at: null,
});

/** The free voices, shown while the engine can't be asked for its list. Mirrors the featured presets in engine/narrator_engine/catalog.py. */
export const OFFLINE_VOICES: Voice[] = [
  preset("kokoro:af_heart", "Heart", "kokoro", "female", "American", "Kokoro's top-graded voice", false),
  preset("chatterbox:default", "Chatterbox", "chatterbox", "male", "", "Chatterbox's built-in male voice, with full emotion control", true),
  preset("kokoro:af_bella", "Bella", "kokoro", "female", "American", "American female", false),
  preset("kokoro:af_nicole", "Nicole", "kokoro", "female", "American", "American female, soft delivery", false),
  preset("kokoro:bf_emma", "Emma", "kokoro", "female", "British", "British female", false),
  preset("qwen3:ryan", "Ryan", "qwen3", "male", "", "Dynamic male voice with strong rhythmic drive (native English)", true),
  preset("qwen3:aiden", "Aiden", "qwen3", "male", "", "Sunny American male with a clear midrange (native English)", true),
];
