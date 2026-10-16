import { useCallback, useEffect, useMemo, useState } from "react";
import { Clip, Emotion, Engine, EngineError, Settings, Voice, loadSettings, saveSettings } from "./api";
import { ClipList } from "./ClipList";
import { CloneVoice } from "./CloneVoice";
import { Composer } from "./Composer";
import { SettingsPanel } from "./SettingsPanel";

type Connection =
  | { state: "connecting" }
  | { state: "ok" }
  | { state: "no-token" }
  | { state: "bad-token" }
  | { state: "offline"; message: string };

const POLL_MS = 1500;

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const engine = useMemo(() => new Engine(settings.url, settings.token), [settings]);
  const [connection, setConnection] = useState<Connection>({ state: "connecting" });
  const [voices, setVoices] = useState<Voice[]>([]);
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showClone, setShowClone] = useState(false);

  const connect = useCallback(async () => {
    setConnection({ state: "connecting" });
    if (!engine.token) {
      setConnection({ state: "no-token" });
      setShowSettings(true);
      return;
    }
    try {
      const [v, e, c] = await Promise.all([engine.voices(), engine.emotions(), engine.clips()]);
      setVoices(v);
      setEmotions(e);
      setClips(c);
      setConnection({ state: "ok" });
    } catch (err) {
      if (err instanceof EngineError && err.status === 401) {
        setConnection({ state: "bad-token" });
        setShowSettings(true);
      } else {
        setConnection({ state: "offline", message: err instanceof Error ? err.message : String(err) });
      }
    }
  }, [engine]);

  useEffect(() => {
    connect();
  }, [connect]);

  // Poll clips that are still being generated.
  const pending = clips.filter((c) => c.status === "queued" || c.status === "running").map((c) => c.id);
  const pendingKey = pending.join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(async () => {
      const updates = await Promise.all(pendingKey.split(",").map((id) => engine.clip(id).catch(() => null)));
      setClips((current) => current.map((c) => updates.find((u) => u?.id === c.id) ?? c));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingKey, engine]);

  const updateSettings = (next: Settings) => {
    saveSettings(next);
    setSettings(next);
    setShowSettings(false);
  };

  const voiceById = useMemo(() => new Map(voices.map((v) => [v.id, v])), [voices]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Dragon Spit Narrator</span>
        </div>
        <div className="topbar-actions">
          <ConnectionPill connection={connection} onRetry={connect} />
          <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
            Engine settings
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel settings={settings} connection={connection.state} onSave={updateSettings} onClose={() => setShowSettings(false)} />
      )}

      {connection.state === "offline" && <OfflineHelp url={settings.url} onRetry={connect} />}

      <main className="layout">
        <Composer
          engine={engine}
          voices={voices}
          emotions={emotions}
          disabled={connection.state !== "ok"}
          onCreated={(clip) => setClips((c) => [clip, ...c])}
          onCloneVoice={() => setShowClone(true)}
        />
        <ClipList
          engine={engine}
          clips={clips}
          voiceById={voiceById}
          onDeleted={(id) => setClips((c) => c.filter((x) => x.id !== id))}
        />
      </main>

      {showClone && (
        <CloneVoice
          engine={engine}
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

function ConnectionPill({ connection, onRetry }: { connection: Connection; onRetry: () => void }) {
  const label = {
    connecting: "Connecting…",
    ok: "Engine connected",
    "no-token": "Add your engine token",
    "bad-token": "Token not accepted",
    offline: "Engine offline",
  }[connection.state];
  return (
    <button className={`pill pill-${connection.state}`} onClick={onRetry} title="Reconnect">
      <span className="dot" />
      {label}
    </button>
  );
}

function OfflineHelp({ url, onRetry }: { url: string; onRetry: () => void }) {
  return (
    <section className="notice">
      <strong>This page can't reach the voice engine at {url}.</strong>
      <ul>
        <li>The engine runs on the Mac mini, so it has to be switched on and running.</li>
        <li>
          For now, open this page <em>on the Mac mini</em> in Chrome. If Chrome asks to let the site access devices on your
          local network, choose Allow.
        </li>
        <li>Using it from other computers comes with the next update.</li>
      </ul>
      <button onClick={onRetry}>Try again</button>
    </section>
  );
}
