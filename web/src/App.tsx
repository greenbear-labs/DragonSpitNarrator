import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, Clip, DirectEngine, DirectSettings, Emotion, Relay, Status, Voice, loadDirect, saveDirect } from "./api";
import { ClipList } from "./ClipList";
import { CloneVoice } from "./CloneVoice";
import { Composer } from "./Composer";
import { KeyPanel } from "./KeyPanel";
import { OFFLINE_VOICES, SampleManifest, loadSamples } from "./samples";

const POLL_MS = 1500;

export function App() {
  const [direct, setDirect] = useState<DirectSettings>(loadDirect);
  const relay = useMemo(() => new Relay(), []);
  const backend = useMemo(() => (direct.token ? new DirectEngine(direct.url, direct.token) : relay), [direct, relay]);
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>(OFFLINE_VOICES);
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [samples, setSamples] = useState<SampleManifest>({ generated_at: null, voices: [] });
  const [showKey, setShowKey] = useState(false);
  const [showClone, setShowClone] = useState(false);

  useEffect(() => {
    loadSamples().then(setSamples);
  }, []);

  const refreshStatus = useCallback(() => backend.status().then(setStatus).catch(() => {}), [backend]);

  const connect = useCallback(async () => {
    setProblem(null);
    try {
      const s = await backend.status();
      setStatus(s);
      if (s.engine !== "online") return;
      const [v, e, c] = await Promise.all([backend.voices(), backend.emotions(), backend.clips()]);
      setVoices(v);
      setEmotions(e);
      setClips(c);
    } catch (err) {
      if (err instanceof ApiError && err.code === "bad-key") setShowKey(true);
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }, [backend]);

  useEffect(() => {
    connect();
  }, [connect]);

  // Poll clips that are still being generated, then refresh the allowance once they finish.
  const pendingKey = clips
    .filter((c) => c.status === "queued" || c.status === "running")
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(async () => {
      const updates = await Promise.all(pendingKey.split(",").map((id) => backend.clip(id).catch(() => null)));
      setClips((current) => current.map((c) => updates.find((u) => u?.id === c.id) ?? c));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingKey, backend]);

  const changeDirect = (next: DirectSettings) => {
    saveDirect(next);
    setDirect(next);
    setVoices(OFFLINE_VOICES);
    setClips([]);
    setShowKey(false);
  };

  const signIn = async (key: string) => {
    await relay.signIn(key);
    setShowKey(false);
    await connect();
  };

  const signOut = async () => {
    await relay.signOut();
    setShowKey(false);
    setVoices(OFFLINE_VOICES);
    setClips([]);
    await connect();
  };

  const voiceById = useMemo(() => new Map(voices.map((v) => [v.id, v])), [voices]);
  const keyed = status?.access.tier === "key";
  const resting = status?.engine === "resting";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Dragon Spit Narrator</span>
        </div>
        <button className="ghost" onClick={() => setShowKey(true)}>
          {direct.token ? "Direct to engine" : keyed ? "Key in use" : "Have a key?"}
        </button>
      </header>

      <section className="hero">
        <h1>Natural narration from open-source voices</h1>
        <p>
          Type a line, pick a voice, and a Mac mini at Green Bear Labs turns it into speech with open-source models (Kokoro,
          Chatterbox and Qwen3-TTS). Nothing goes to a paid voice service.
        </p>
        <StatusLine status={status} problem={problem} onRetry={connect} />
      </section>

      {resting && (
        <section className="notice">
          <strong>The narrator is resting.</strong> The Mac mini that does the talking is offline right now.
          {samples.voices.length > 0 ? " Press ▶ on any voice to hear a clip it made earlier." : " Check back a little later."}
        </section>
      )}

      <main className="stack-lg">
        <Composer
          backend={backend}
          status={status}
          voices={voices}
          emotions={emotions}
          samples={samples}
          onCreated={(clip) => {
            setClips((c) => [clip, ...c]);
            refreshStatus();
          }}
          onCloneVoice={() => setShowClone(true)}
          onNeedKey={() => setShowKey(true)}
        />
        <ClipList
          backend={backend}
          title={status?.features.library ? "Clips" : "Your clips"}
          canDelete={status?.features.library ?? false}
          clips={clips}
          voiceById={voiceById}
          onDeleted={(id) => setClips((c) => c.filter((x) => x.id !== id))}
        />
      </main>

      <footer className="footer">
        <p>
          Built by Alex at Green Bear Labs.
          {status?.quota && ` Everyone gets ${status.quota.limit.toLocaleString()} free characters a day.`} Your clips stay on
          the Mac mini and only you can see them.
        </p>
      </footer>

      {showKey && (
        <KeyPanel status={status} direct={direct} onSignIn={signIn} onSignOut={signOut} onDirect={changeDirect} onClose={() => setShowKey(false)} />
      )}

      {showClone && (
        <CloneVoice
          backend={backend}
          onClose={() => setShowClone(false)}
          onAdded={(voice) => {
            setVoices((v) => [voice, ...v]);
            setShowClone(false);
          }}
        />
      )}
    </div>
  );
}

function StatusLine({ status, problem, onRetry }: { status: Status | null; problem: string | null; onRetry: () => void }) {
  if (problem) {
    return (
      <button className="pill pill-offline" onClick={onRetry}>
        <span className="dot" />
        {problem}. Try again
      </button>
    );
  }
  if (!status) {
    return (
      <span className="pill pill-connecting">
        <span className="dot" />
        Waking the narrator…
      </span>
    );
  }
  const online = status.engine === "online";
  let label = online ? "Narrator online" : "Narrator resting";
  if (online && status.access.tier === "key") label += ` · unlimited (${status.access.name})`;
  else if (online && status.quota) label += ` · ${status.quota.remaining.toLocaleString()} free characters left today`;
  return (
    <button className={`pill ${online ? "pill-ok" : "pill-offline"}`} onClick={onRetry} title="Check again">
      <span className="dot" />
      {label}
    </button>
  );
}
