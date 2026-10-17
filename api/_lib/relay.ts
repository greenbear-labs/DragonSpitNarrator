// The relay between the public website and the engine on the Mac mini. Browsers only ever talk to this;
// it holds the engine token, gives anonymous visitors a small daily allowance, and lets people with a
// personal key use everything. Routes mirror the engine's /v1 API under /api.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CounterStore } from "./store";

export type RelayConfig = {
  /** Public address of the engine (the Cloudflare Tunnel URL). Unset means the site runs in resting mode. */
  engineUrl: string | null;
  engineToken: string;
  /** Personal keys, including the engine token itself as "owner". */
  keys: { name: string; key: string }[];
  freeDailyChars: number;
  freeGlobalDailyChars: number;
  secureCookies: boolean;
};

const OWNER = "owner";

export function configFromEnv(env: Record<string, string | undefined>): RelayConfig {
  const engineToken = (env.ENGINE_TOKEN || "").trim();
  const keys = (env.NARRATOR_KEYS || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(":");
      return at > 0 ? { name: entry.slice(0, at), key: entry.slice(at + 1) } : { name: "guest", key: entry };
    })
    .filter((k) => k.key.length >= 16);
  if (engineToken) keys.push({ name: OWNER, key: engineToken });
  const number = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && value !== "" && value !== undefined ? n : fallback;
  };
  return {
    engineUrl: env.ENGINE_URL ? env.ENGINE_URL.replace(/\/+$/, "") : null,
    engineToken,
    keys,
    freeDailyChars: number(env.FREE_DAILY_CHARS, 1000),
    freeGlobalDailyChars: number(env.FREE_GLOBAL_DAILY_CHARS, 20000),
    secureCookies: env.NODE_ENV !== "development",
  };
}

type Access =
  | { tier: "key"; name: string }
  | { tier: "free"; visitor: string; ipHash: string; newVisitor: boolean };

const KEY_COOKIE = "dsn_key";
const VISITOR_COOKIE = "dsn_vid";
const YEAR = 365 * 24 * 3600;
const ENGINE_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 3500;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const RESTING = () => new HttpError(503, "The narrator is resting right now. Try again later.", "resting");

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function sameSecret(a: string, b: string) {
  return timingSafeEqual(sha256(a), sha256(b));
}

function parseCookies(header: string | null) {
  const cookies = new Map<string, string>();
  for (const part of (header || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) cookies.set(part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim()));
  }
  return cookies;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function today(now: Date) {
  return now.toISOString().slice(0, 10);
}

function nextMidnight(now: Date) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

type EngineClip = { id: string; status: string; tags: string[]; audio_url: string | null; [key: string]: unknown };
type EngineVoice = { id: string; source: string; featured: boolean; [key: string]: unknown };

export function createRelay(config: RelayConfig, store: CounterStore, now: () => Date = () => new Date()) {
  const cookie = (name: string, value: string, maxAge: number) =>
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${config.secureCookies ? "; Secure" : ""}`;

  function findKey(supplied: string) {
    return config.keys.find((k) => sameSecret(k.key, supplied));
  }

  function identify(request: Request): { access: Access; setCookies: string[] } {
    const setCookies: string[] = [];
    const cookies = parseCookies(request.headers.get("cookie"));
    const header = request.headers.get("authorization") || "";
    const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : cookies.get(KEY_COOKIE) || "";
    if (supplied) {
      const match = findKey(supplied);
      if (match) return { access: { tier: "key", name: match.name }, setCookies };
      if (header) throw new HttpError(401, "That key isn't valid", "bad-key");
      setCookies.push(cookie(KEY_COOKIE, "", 0)); // a key that was switched off
    }
    let visitor = cookies.get(VISITOR_COOKIE) || "";
    const newVisitor = !/^[a-f0-9]{24}$/.test(visitor);
    if (newVisitor) {
      visitor = randomBytes(12).toString("hex");
      setCookies.push(cookie(VISITOR_COOKIE, visitor, YEAR));
    }
    const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
    // Store a salted hash rather than the address itself.
    const ipHash = sha256(`${config.engineToken}:${ip}`).toString("hex").slice(0, 24);
    return { access: { tier: "free", visitor, ipHash, newVisitor }, setCookies };
  }

  const visitorTag = (access: Access) => (access.tier === "free" ? `visitor-${access.visitor.slice(0, 16)}` : "");

  async function engine(path: string, init: RequestInit = {}, timeoutMs = ENGINE_TIMEOUT_MS): Promise<Response> {
    if (!config.engineUrl) throw RESTING();
    let response: Response;
    try {
      response = await fetch(config.engineUrl + path, {
        ...init,
        headers: { Authorization: `Bearer ${config.engineToken}`, ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw RESTING();
    }
    // Cloudflare answers 502/530 when the tunnel is up but the Mac isn't.
    if ([502, 503, 504, 521, 522, 523, 530].includes(response.status)) throw RESTING();
    return response;
  }

  async function engineJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await engine(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof body.detail === "string" ? body.detail : response.statusText || "Engine error";
      throw new HttpError(response.status === 401 ? 502 : response.status, detail);
    }
    return body as T;
  }

  function publicClip(clip: EngineClip) {
    return { ...clip, audio_url: clip.audio_url ? `/api/clips/${clip.id}/audio` : null };
  }

  async function quota(access: Access) {
    const day = today(now());
    if (access.tier === "key") return null;
    const keys = [`q:${day}:ip:${access.ipHash}`, `q:${day}:v:${access.visitor}`, `q:${day}:all`];
    const [ip, visitor, all] = await store.get(keys);
    const used = Math.max(ip, visitor);
    return {
      keys,
      limit: config.freeDailyChars,
      used,
      remaining: Math.max(0, config.freeDailyChars - used),
      demoFull: all >= config.freeGlobalDailyChars,
      globalUsed: all,
      resetsAt: nextMidnight(now()),
    };
  }

  async function engineOnline() {
    if (!config.engineUrl) return false;
    try {
      const response = await fetch(config.engineUrl + "/health", { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function ownClip(access: Access, id: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(404, "Clip not found");
    const clip = await engineJson<EngineClip>(`/v1/clips/${id}`);
    if (access.tier === "free" && !clip.tags.includes(visitorTag(access))) throw new HttpError(404, "Clip not found");
    return clip;
  }

  function requireKey(access: Access, what: string) {
    if (access.tier !== "key") throw new HttpError(403, `${what} needs a key`, "needs-key");
  }

  async function route(request: Request, path: string[], access: Access): Promise<Response> {
    const method = request.method;
    const [first, second, third] = path;
    const url = new URL(request.url);
    url.searchParams.delete("__path");

    if (first === "status" && method === "GET") {
      const [online, q] = await Promise.all([engineOnline(), quota(access)]);
      return json({
        engine: online ? "online" : "resting",
        access: access.tier === "key" ? { tier: "key", name: access.name } : { tier: "free" },
        quota: q && { limit: q.limit, used: q.used, remaining: q.remaining, resets_at: q.resetsAt, demo_full: q.demoFull },
        features: { clone: access.tier === "key", library: access.tier === "key" },
      });
    }

    if (first === "session") {
      if (method === "DELETE") return json(null, 204, { "Set-Cookie": cookie(KEY_COOKIE, "", 0) });
      if (method === "POST") {
        const body = await request.json().catch(() => ({}));
        const match = typeof body.key === "string" ? findKey(body.key.trim()) : undefined;
        if (!match) throw new HttpError(401, "That key isn't valid", "bad-key");
        return json({ name: match.name }, 200, { "Set-Cookie": cookie(KEY_COOKIE, body.key.trim(), YEAR) });
      }
    }

    if (first === "emotions" && method === "GET") return json(await engineJson("/v1/emotions"));

    if (first === "voices" && !second && method === "GET") {
      if (access.tier === "key") return json(await engineJson(`/v1/voices${url.search}`));
      const { voices } = await engineJson<{ voices: EngineVoice[] }>("/v1/voices?featured=true");
      return json({ voices: voices.filter((v) => v.source === "preset") });
    }

    if (first === "voices" && !second && method === "POST") {
      requireKey(access, "Cloning a voice");
      const response = await engine("/v1/voices", {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type") || "" },
        body: await request.arrayBuffer(),
      }, 60_000);
      return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
    }

    if (first === "voices" && second && !third && method === "DELETE") {
      requireKey(access, "Deleting a voice");
      const response = await engine(`/v1/voices/${encodeURIComponent(second)}`, { method: "DELETE" });
      return response.status === 204 ? json(null, 204) : json(await response.json().catch(() => ({})), response.status);
    }

    if (first === "clips" && !second && method === "GET") {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
      const tag = access.tier === "free" ? visitorTag(access) : url.searchParams.get("tag");
      if (access.tier === "free" && access.newVisitor) return json({ clips: [] });
      const params = new URLSearchParams({ limit: String(limit) });
      if (tag) params.set("tag", tag);
      const { clips } = await engineJson<{ clips: EngineClip[] }>(`/v1/clips?${params}`);
      return json({ clips: clips.map(publicClip) });
    }

    if (first === "clips" && !second && method === "POST") return createClip(request, access);

    if (first === "clips" && second && !third && method === "GET") return json(publicClip(await ownClip(access, second)));

    if (first === "clips" && second && !third && method === "DELETE") {
      requireKey(access, "Deleting clips");
      await ownClip(access, second);
      const response = await engine(`/v1/clips/${second}`, { method: "DELETE" });
      return json(null, response.status === 204 ? 204 : response.status);
    }

    if (first === "clips" && second && third === "audio" && method === "GET") {
      await ownClip(access, second);
      const format = url.searchParams.get("format");
      const query = format === "wav" || format === "mp3" ? `?format=${format}` : "";
      const range = request.headers.get("range");
      const response = await engine(`/v1/clips/${second}/audio${query}`, { headers: range ? { Range: range } : {} }, 30_000);
      const headers = new Headers({ "Cache-Control": "private, max-age=86400" });
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
        const value = response.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(response.body, { status: response.status, headers });
    }

    throw new HttpError(404, "Not found");
  }

  async function createClip(request: Request, access: Access): Promise<Response> {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "Write something to narrate first");

    if (access.tier === "key") {
      const tags = Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === "string") : [];
      if (access.name !== OWNER) tags.push(`by-${access.name}`);
      const clip = await engineJson<EngineClip>("/v1/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, tags }),
      });
      return json(publicClip(clip), 202);
    }

    const chars = body.text.length;
    const q = (await quota(access))!;
    if (q.demoFull || q.globalUsed + chars > config.freeGlobalDailyChars) {
      throw new HttpError(429, "The free demo has used up today's narration. It resets at midnight UTC.", "demo-full");
    }
    if (chars > q.remaining) {
      const message =
        q.remaining === 0
          ? "You've used today's free characters. They reset at midnight UTC."
          : `That's ${chars.toLocaleString("en-US")} characters, and you have ${q.remaining.toLocaleString("en-US")} free characters left today.`;
      throw new HttpError(429, message, "quota");
    }

    const tag = visitorTag(access);
    const [{ voices }, { clips }] = await Promise.all([
      engineJson<{ voices: EngineVoice[] }>("/v1/voices?featured=true"),
      access.newVisitor ? Promise.resolve({ clips: [] as EngineClip[] }) : engineJson<{ clips: EngineClip[] }>(`/v1/clips?tag=${tag}&limit=20`),
    ]);
    if (!voices.some((v) => v.id === body.voice_id && v.source === "preset")) {
      throw new HttpError(403, "That voice needs a key", "needs-key");
    }
    if (clips.some((c) => c.status === "queued" || c.status === "running")) {
      throw new HttpError(429, "Your last clip is still being made. Try again when it's done.", "busy");
    }

    const clip = await engineJson<EngineClip>("/v1/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: body.text,
        voice_id: body.voice_id,
        emotion: typeof body.emotion === "string" ? body.emotion : "neutral",
        intensity: typeof body.intensity === "number" ? body.intensity : 0.6,
        speed: typeof body.speed === "number" ? body.speed : 1,
        format: "mp3",
        tags: ["public", tag],
      }),
    });
    await store.add(q.keys, chars, 2 * 24 * 3600);
    return json(publicClip(clip), 202);
  }

  return async function handle(request: Request, path: string[]): Promise<Response> {
    let setCookies: string[] = [];
    let response: Response;
    try {
      const identity = identify(request);
      setCookies = identity.setCookies;
      response = await route(request, path, identity.access);
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ detail: err.message, code: err.code }, err.status);
      } else {
        console.error("relay error", err);
        response = json({ detail: "Something went wrong in the relay" }, 500);
      }
    }
    for (const value of setCookies) response.headers.append("Set-Cookie", value);
    return response;
  };
}

/** Turns /api/clips/abc/audio (or the ?__path= the Vercel rewrite adds) into ["clips", "abc", "audio"]. */
export function pathOf(request: Request): string[] {
  const url = new URL(request.url);
  const raw = url.searchParams.get("__path") ?? url.pathname.replace(/^\/api\/?/, "");
  return raw.split("/").filter(Boolean);
}
