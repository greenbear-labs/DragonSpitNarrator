// Tests for the website relay (api/_lib/relay.ts) against a stand-in engine. Run with `npm test`.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { configFromEnv, createRelay, pathOf } from "../../api/_lib/relay";
import { MemoryStore } from "../../api/_lib/store";

const ENGINE = "http://engine.test";
const TOKEN = "engine-token-0123456789abcdef";
const FRIEND_KEY = "friend-key-0123456789abcdef";

type FakeClip = { id: string; status: string; text: string; voice_id: string; tags: string[]; audio_url: string | null };

let clips: FakeClip[];
let engineUp: boolean;
let received: { path: string; init: RequestInit }[];

const voices = [
  { id: "kokoro:af_heart", source: "preset", featured: true },
  { id: "qwen3:dylan", source: "preset", featured: false },
  { id: "custom:alex", source: "custom", featured: true },
];

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// The fake engine behind the relay.
globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  if (url.origin !== ENGINE) throw new Error(`unexpected fetch ${url}`);
  if (!engineUp) throw new TypeError("fetch failed");
  const path = url.pathname;
  received.push({ path: path + url.search, init });
  if (path === "/health") return reply({ ok: true });
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  const method = init.method || "GET";
  if (path === "/v1/emotions") return reply({ emotions: [{ name: "neutral", description: "" }] });
  if (path === "/v1/voices" && method === "GET") {
    const featured = url.searchParams.get("featured") === "true";
    return reply({ voices: voices.filter((v) => !featured || v.featured) });
  }
  if (path === "/v1/voices" && method === "POST") return reply({ id: "custom:new" }, 201);
  if (path === "/v1/clips" && method === "POST") {
    const body = JSON.parse(String(init.body));
    const clip = { id: `c${clips.length + 1}`, status: "queued", text: body.text, voice_id: body.voice_id, tags: body.tags, audio_url: null, sent: body };
    clips.push(clip);
    return reply(clip, 202);
  }
  if (path === "/v1/clips") {
    const tag = url.searchParams.get("tag");
    return reply({ clips: clips.filter((c) => !tag || c.tags.includes(tag)) });
  }
  const match = path.match(/^\/v1\/clips\/([^/]+)(\/audio)?$/);
  const clip = match && clips.find((c) => c.id === match[1]);
  if (!clip) return reply({ detail: "Clip not found" }, 404);
  if (match![2]) {
    const range = headers.get("range");
    return new Response("audio-bytes", {
      status: range ? 206 : 200,
      headers: { "Content-Type": "audio/mpeg", ...(range ? { "Content-Range": "bytes 0-4/11" } : {}) },
    });
  }
  if (method === "DELETE") {
    clips = clips.filter((c) => c !== clip);
    return new Response(null, { status: 204 });
  }
  return reply(clip);
};

let handle: ReturnType<typeof createRelay>;
let store: MemoryStore;

function relay(env: Record<string, string> = {}) {
  store = new MemoryStore();
  handle = createRelay(
    configFromEnv({ ENGINE_URL: ENGINE, ENGINE_TOKEN: TOKEN, NARRATOR_KEYS: `friend:${FRIEND_KEY}`, FREE_DAILY_CHARS: "100", ...env }),
    store,
  );
}

class Browser {
  cookies = new Map<string, string>();
  constructor(readonly ip = "203.0.113.5") {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const request = new Request(`https://narrator.test/api/${path}`, {
      method,
      headers: {
        "x-forwarded-for": this.ip,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const response = await handle(request, pathOf(request));
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, value] = pair.split("=");
      if (cookie.includes("Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json, headers: response.headers };
  }

  clip(text: string, voice_id = "kokoro:af_heart", extra: Record<string, unknown> = {}) {
    return this.call("POST", "clips", { text, voice_id, emotion: "neutral", intensity: 0.5, speed: 1, format: "wav", tags: ["mine"], ...extra });
  }
}

const finishAll = () => clips.forEach((c) => ((c.status = "done"), (c.audio_url = `/v1/clips/${c.id}/audio`)));

beforeEach(() => {
  clips = [];
  engineUp = true;
  received = [];
  relay();
});

describe("free visitors", () => {
  it("get a daily allowance and a visitor cookie", async () => {
    const browser = new Browser();
    const status = await browser.call("GET", "status");
    assert.equal(status.status, 200);
    assert.equal(status.json.engine, "online");
    assert.deepEqual(status.json.access, { tier: "free" });
    assert.equal(status.json.quota.remaining, 100);
    assert.equal(status.json.features.clone, false);
    assert.ok(browser.cookies.has("dsn_vid"));
  });

  it("spend characters on clips and are stopped at the limit", async () => {
    const browser = new Browser();
    await browser.call("GET", "status");
    const made = await browser.clip("a".repeat(60));
    assert.equal(made.status, 202);
    assert.equal(made.json.audio_url, null);
    const sent = (clips[0] as any).sent;
    assert.equal(sent.format, "mp3");
    assert.deepEqual(sent.tags[0], "public");
    assert.match(sent.tags[1], /^visitor-[a-f0-9]{16}$/);

    finishAll();
    assert.equal((await browser.call("GET", "status")).json.quota.remaining, 40);
    const tooLong = await browser.clip("b".repeat(41));
    assert.equal(tooLong.status, 429);
    assert.equal(tooLong.json.code, "quota");
    assert.equal((await browser.clip("b".repeat(40))).status, 202);
  });

  it("can't dodge the limit by clearing cookies", async () => {
    const browser = new Browser();
    await browser.call("GET", "status");
    await browser.clip("a".repeat(90));
    finishAll();
    browser.cookies.clear();
    const status = await browser.call("GET", "status");
    assert.equal(status.json.quota.remaining, 10);
  });

  it("wait for their last clip before starting another", async () => {
    const browser = new Browser();
    await browser.call("GET", "status");
    await browser.clip("one");
    const second = await browser.clip("two");
    assert.equal(second.status, 429);
    assert.equal(second.json.code, "busy");
  });

  it("only see featured preset voices and can't use others", async () => {
    const browser = new Browser();
    const list = await browser.call("GET", "voices");
    assert.deepEqual(list.json.voices.map((v: any) => v.id), ["kokoro:af_heart"]);
    for (const voice of ["custom:alex", "qwen3:dylan"]) {
      const made = await browser.clip("hello", voice);
      assert.equal(made.status, 403);
      assert.equal(made.json.code, "needs-key");
    }
    assert.equal(clips.length, 0);
  });

  it("only see their own clips", async () => {
    const alice = new Browser("198.51.100.1");
    const bob = new Browser("198.51.100.2");
    await alice.call("GET", "status");
    await bob.call("GET", "status");
    const clip = (await alice.clip("alice's line")).json;
    finishAll();

    assert.equal((await alice.call("GET", `clips/${clip.id}`)).status, 200);
    assert.equal((await bob.call("GET", `clips/${clip.id}`)).status, 404);
    assert.equal((await bob.call("GET", `clips/${clip.id}/audio`)).status, 404);
    assert.deepEqual((await bob.call("GET", "clips")).json.clips, []);
    assert.equal((await alice.call("GET", "clips")).json.clips.length, 1);

    const audio = await alice.call("GET", `clips/${clip.id}/audio`, undefined, { range: "bytes=0-4" });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get("content-range"), "bytes 0-4/11");
    assert.equal(audio.json, "audio-bytes");
  });

  it("can't clone or delete", async () => {
    const browser = new Browser();
    const form = new FormData();
    form.set("name", "x");
    assert.equal((await browser.call("POST", "voices", form)).status, 403);
    await browser.call("GET", "status");
    const clip = (await browser.clip("hi")).json;
    assert.equal((await browser.call("DELETE", `clips/${clip.id}`)).status, 403);
  });

  it("share a site-wide daily cap that protects the Mac", async () => {
    relay({ FREE_GLOBAL_DAILY_CHARS: "150" });
    for (const ip of ["192.0.2.1", "192.0.2.2"]) {
      const browser = new Browser(ip);
      await browser.call("GET", "status");
      assert.equal((await browser.clip("a".repeat(70))).status, 202);
      finishAll();
    }
    const third = new Browser("192.0.2.3");
    await third.call("GET", "status");
    const blocked = await third.clip("a".repeat(20));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, "demo-full");
  });
});

describe("keys", () => {
  it("sign in with a cookie and lift the limits", async () => {
    const browser = new Browser();
    assert.equal((await browser.call("POST", "session", { key: "wrong-key-0123456789" })).status, 401);
    const signIn = await browser.call("POST", "session", { key: FRIEND_KEY });
    assert.equal(signIn.json.name, "friend");
    assert.ok(browser.cookies.has("dsn_key"));

    const status = await browser.call("GET", "status");
    assert.deepEqual(status.json.access, { tier: "key", name: "friend" });
    assert.equal(status.json.quota, null);
    assert.equal(status.json.features.clone, true);

    const made = await browser.clip("x".repeat(5000), "custom:alex");
    assert.equal(made.status, 202);
    assert.equal((clips[0] as any).sent.format, "wav");
    assert.deepEqual(clips[0].tags, ["mine", "by-friend"]);

    const voicesList = await browser.call("GET", "voices");
    assert.equal(voicesList.json.voices.length, 3);

    await browser.call("DELETE", "session");
    assert.ok(!browser.cookies.has("dsn_key"));
    assert.deepEqual((await browser.call("GET", "status")).json.access, { tier: "free" });
  });

  it("accept the engine token as the owner's key over a Bearer header", async () => {
    const script = new Browser();
    const status = await script.call("GET", "status", undefined, { authorization: `Bearer ${TOKEN}` });
    assert.deepEqual(status.json.access, { tier: "key", name: "owner" });
    const made = await script.clip("hello", "kokoro:af_heart", {});
    assert.equal(made.status, 202);
    const bad = await script.call("GET", "status", undefined, { authorization: "Bearer nope" });
    assert.equal(bad.status, 401);
  });

  it("forget a key that has been switched off", async () => {
    const browser = new Browser();
    await browser.call("POST", "session", { key: FRIEND_KEY });
    relay({ NARRATOR_KEYS: "" });
    const status = await browser.call("GET", "status");
    assert.deepEqual(status.json.access, { tier: "free" });
    assert.ok(!browser.cookies.has("dsn_key"));
  });

  it("pass voice uploads and deletes through", async () => {
    const browser = new Browser();
    await browser.call("POST", "session", { key: FRIEND_KEY });
    const form = new FormData();
    form.set("name", "Alex");
    form.set("reference", new Blob(["RIFF"]), "reference.wav");
    const added = await browser.call("POST", "voices", form);
    assert.equal(added.status, 201);
    const upload = received.find((r) => r.path === "/v1/voices" && r.init.method === "POST")!;
    assert.match(new Headers(upload.init.headers).get("content-type")!, /^multipart\/form-data; boundary=/);

    await browser.clip("hi");
    assert.equal((await browser.call("DELETE", "clips/c1")).status, 204);
    assert.equal(clips.length, 0);
  });
});

describe("resting mode", () => {
  it("reports resting when the Mac is offline", async () => {
    engineUp = false;
    const browser = new Browser();
    const status = await browser.call("GET", "status");
    assert.equal(status.json.engine, "resting");
    const made = await browser.clip("hello");
    assert.equal(made.status, 503);
    assert.equal(made.json.code, "resting");
  });

  it("rests when no engine address is configured", async () => {
    relay({ ENGINE_URL: "" });
    const browser = new Browser();
    assert.equal((await browser.call("GET", "status")).json.engine, "resting");
    assert.equal((await browser.call("GET", "voices")).status, 503);
  });
});

describe("routing", () => {
  it("reads the path from the Vercel rewrite", () => {
    assert.deepEqual(pathOf(new Request("https://x.test/api/relay?__path=clips/c1/audio&format=wav")), ["clips", "c1", "audio"]);
    assert.deepEqual(pathOf(new Request("https://x.test/api/clips/c1")), ["clips", "c1"]);
  });

  it("drops keys that are too short to be safe", () => {
    const config = configFromEnv({ NARRATOR_KEYS: "a:short, b:long-enough-key-123456\nc:another-long-key-123456", ENGINE_TOKEN: TOKEN });
    assert.deepEqual(config.keys.map((k) => k.name), ["b", "c", "owner"]);
  });
});
