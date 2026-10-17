// Clients for the narrator. Normally the page talks to the relay at /api (api/_lib/relay.ts), which
// applies the free allowance and personal keys. "Direct" mode talks to the engine on the Mac mini
// itself (engine/narrator_engine/api.py) with the engine token, for use on that computer.

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

export const ENGINE_LABELS: Record<Voice["engine"], string> = {
  kokoro: "Kokoro",
  chatterbox: "Chatterbox",
  qwen3: "Qwen3-TTS",
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

export type Quota = { limit: number; used: number; remaining: number; resets_at: string; demo_full: boolean };

export type Status = {
  engine: "online" | "resting";
  access: { tier: "free" } | { tier: "key"; name: string };
  quota: Quota | null;
  features: { clone: boolean; library: boolean };
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError("Can't reach the narrator", 0, "resting");
  }
  if (!response.ok) {
    let detail = response.statusText;
    let code: string | undefined;
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      code = body.code;
    } catch {
      // keep statusText
    }
    throw new ApiError(detail, response.status, code);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

const jsonPost = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface Backend {
  readonly mode: "relay" | "direct";
  status(): Promise<Status>;
  voices(): Promise<Voice[]>;
  emotions(): Promise<Emotion[]>;
  clips(limit?: number): Promise<Clip[]>;
  clip(id: string): Promise<Clip>;
  createClip(body: ClipRequest): Promise<Clip>;
  deleteClip(id: string): Promise<void>;
  addVoice(form: FormData): Promise<Voice>;
  deleteVoice(id: string): Promise<void>;
  audioUrl(clip: Clip, format?: "mp3" | "wav"): string;
}

export class Relay implements Backend {
  readonly mode = "relay";
  private base = "/api";

  status = () => call<Status>(`${this.base}/status`);
  voices = () => call<{ voices: Voice[] }>(`${this.base}/voices`).then((r) => r.voices);
  emotions = () => call<{ emotions: Emotion[] }>(`${this.base}/emotions`).then((r) => r.emotions);
  clips = (limit = 100) => call<{ clips: Clip[] }>(`${this.base}/clips?limit=${limit}`).then((r) => r.clips);
  clip = (id: string) => call<Clip>(`${this.base}/clips/${id}`);
  createClip = (body: ClipRequest) => call<Clip>(`${this.base}/clips`, jsonPost(body));
  deleteClip = (id: string) => call<void>(`${this.base}/clips/${id}`, { method: "DELETE" });
  addVoice = (form: FormData) => call<Voice>(`${this.base}/voices`, { method: "POST", body: form });
  deleteVoice = (id: string) => call<void>(`${this.base}/voices/${encodeURIComponent(id)}`, { method: "DELETE" });

  // The relay keeps the visitor's session in a cookie, so audio links need nothing extra.
  audioUrl(clip: Clip, format?: "mp3" | "wav") {
    return `${clip.audio_url}${format ? `?format=${format}` : ""}`;
  }

  signIn = (key: string) => call<{ name: string }>(`${this.base}/session`, jsonPost({ key }));
  signOut = () => call<void>(`${this.base}/session`, { method: "DELETE" });
}

export class DirectEngine implements Backend {
  readonly mode = "direct";
  readonly url: string;

  constructor(
    url: string,
    readonly token: string,
  ) {
    this.url = url.replace(/\/+$/, "");
  }

  private request = <T,>(path: string, init: RequestInit = {}) =>
    call<T>(this.url + path, { ...init, headers: { Authorization: `Bearer ${this.token}`, ...init.headers } });

  async status(): Promise<Status> {
    try {
      await this.request("/v1/emotions");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) throw new ApiError("The engine didn't accept that token", 401, "bad-key");
      return { engine: "resting", access: { tier: "key", name: "direct" }, quota: null, features: { clone: true, library: true } };
    }
    return { engine: "online", access: { tier: "key", name: "direct" }, quota: null, features: { clone: true, library: true } };
  }

  voices = () => this.request<{ voices: Voice[] }>("/v1/voices").then((r) => r.voices);
  emotions = () => this.request<{ emotions: Emotion[] }>("/v1/emotions").then((r) => r.emotions);
  clips = (limit = 100) => this.request<{ clips: Clip[] }>(`/v1/clips?limit=${limit}`).then((r) => r.clips);
  clip = (id: string) => this.request<Clip>(`/v1/clips/${id}`);
  createClip = (body: ClipRequest) => this.request<Clip>("/v1/clips", jsonPost(body));
  deleteClip = (id: string) => this.request<void>(`/v1/clips/${id}`, { method: "DELETE" });
  addVoice = (form: FormData) => this.request<Voice>("/v1/voices", { method: "POST", body: form });
  deleteVoice = (id: string) => this.request<void>(`/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE" });

  // <audio> and download links can't send headers, so the token rides in the query string.
  audioUrl(clip: Clip, format?: "mp3" | "wav") {
    const params = new URLSearchParams({ token: this.token });
    if (format) params.set("format", format);
    return `${this.url}${clip.audio_url}?${params}`;
  }
}

const DIRECT_KEY = "narrator.settings";
export const DEFAULT_ENGINE_URL = "http://127.0.0.1:8765";

/** Saved direct-connection settings; a token means direct mode is on. */
export type DirectSettings = { url: string; token: string };

export function loadDirect(): DirectSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(DIRECT_KEY) || "{}");
    return { url: saved.url || DEFAULT_ENGINE_URL, token: saved.token || "" };
  } catch {
    return { url: DEFAULT_ENGINE_URL, token: "" };
  }
}

export function saveDirect(settings: DirectSettings) {
  try {
    localStorage.setItem(DIRECT_KEY, JSON.stringify(settings));
  } catch {
    // private mode: settings last for this visit only
  }
}
