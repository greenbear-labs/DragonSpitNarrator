// Client for the narrator engine running on the Mac mini (see engine/narrator_engine/api.py).

export type Voice = {
  id: string;
  name: string;
  engine: "kokoro" | "chatterbox" | "qwen3";
  description: string;
  gender: string;
  accent: string;
  grade: string;
  supports_emotion: boolean;
  source: "preset" | "custom";
  featured: boolean;
  recommended: boolean;
  created_at: string | null;
};

export type Emotion = { name: string; description: string };

export type Clip = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  text: string;
  voice_id: string;
  engine: string;
  emotion: string;
  intensity: number;
  speed: number;
  format: "mp3" | "wav";
  tags: string[];
  duration_s: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  audio_url: string | null;
};

export type ClipRequest = {
  text: string;
  voice_id: string;
  emotion: string;
  intensity: number;
  speed: number;
  format: "mp3" | "wav";
  tags: string[];
};

export type Health = {
  ok: boolean;
  version: string;
  engines: Record<string, { state: string; last_error: string | null }>;
};

export class EngineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class Engine {
  readonly url: string;

  constructor(url: string, readonly token: string) {
    this.url = url.replace(/\/+$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url + path, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
      });
    } catch {
      throw new EngineError("Can't reach the engine", 0);
    }
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json();
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch {
        // keep statusText
      }
      throw new EngineError(detail, response.status);
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }

  health = () => this.request<Health>("/health");
  voices = () => this.request<{ voices: Voice[] }>("/v1/voices").then((r) => r.voices);
  emotions = () => this.request<{ emotions: Emotion[] }>("/v1/emotions").then((r) => r.emotions);
  clips = (limit = 100) => this.request<{ clips: Clip[] }>(`/v1/clips?limit=${limit}`).then((r) => r.clips);
  clip = (id: string) => this.request<Clip>(`/v1/clips/${id}`);
  deleteClip = (id: string) => this.request<void>(`/v1/clips/${id}`, { method: "DELETE" });
  deleteVoice = (id: string) => this.request<void>(`/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE" });

  createClip = (body: ClipRequest) =>
    this.request<Clip>("/v1/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  addVoice = (form: FormData) => this.request<Voice>("/v1/voices", { method: "POST", body: form });

  // <audio> and download links can't send headers, so the token rides in the query string.
  audioUrl(clip: Clip, format?: "mp3" | "wav") {
    const params = new URLSearchParams({ token: this.token });
    if (format) params.set("format", format);
    return `${this.url}${clip.audio_url}?${params}`;
  }
}

const SETTINGS_KEY = "narrator.settings";
export const DEFAULT_ENGINE_URL = "http://127.0.0.1:8765";

export type Settings = { url: string; token: string };

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { url: saved.url || DEFAULT_ENGINE_URL, token: saved.token || "" };
  } catch {
    return { url: DEFAULT_ENGINE_URL, token: "" };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode: settings last for this visit only
  }
}
