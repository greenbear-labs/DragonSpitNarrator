import { FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError, Backend, Clip, ENGINE_LABELS, Emotion, Status, Voice } from "./api";
import { SampleManifest } from "./samples";
import { VoicePicker } from "./VoicePicker";

type Props = {
  backend: Backend;
  status: Status | null;
  voices: Voice[];
  emotions: Emotion[];
  samples: SampleManifest;
  onCreated: (clip: Clip) => void;
  onCloneVoice: () => void;
  onNeedKey: () => void;
};

const DRAFT_KEY = "narrator.draft";
const PLACEHOLDER = "The dragon woke before dawn, and the whole mountain seemed to hold its breath.";

function voiceLabel(v: Voice) {
  const bits = [v.gender, v.accent].filter(Boolean).join(", ");
  const engine = v.name === ENGINE_LABELS[v.engine] ? "" : ` · ${ENGINE_LABELS[v.engine]}`;
  return `${v.name}${bits ? ` (${bits})` : ""}${engine}`;
}

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

export function Composer({ backend, status, voices, emotions, samples, onCreated, onCloneVoice, onNeedKey }: Props) {
  const [text, setText] = useState(readDraft);
  const [voiceId, setVoiceId] = useState("kokoro:af_heart");
  const [emotion, setEmotion] = useState("neutral");
  const [intensity, setIntensity] = useState(0.6);
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyed = status?.access.tier === "key";
  const quota = status?.quota ?? null;
  const online = status?.engine === "online";
  const voice = voices.find((v) => v.id === voiceId);
  const picks = useMemo(() => voices.filter((v) => v.featured || v.recommended), [voices]);

  useEffect(() => {
    if (voices.length && !voice) setVoiceId(voices[0].id);
  }, [voices, voice]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      // ignore
    }
  }, [text]);

  const tooLong = quota != null && text.length > quota.remaining;
  const blocked = !online || (quota != null && (quota.demo_full || quota.remaining === 0));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const clip = await backend.createClip({
        text,
        voice_id: voiceId,
        emotion,
        intensity,
        speed,
        format: keyed ? format : "mp3",
        tags: keyed ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      });
      onCreated(clip);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError && err.code === "needs-key") onNeedKey();
    } finally {
      setBusy(false);
    }
  };

  let counter = `${text.length.toLocaleString()} characters`;
  if (quota) counter = `${text.length.toLocaleString()} of ${quota.remaining.toLocaleString()} free characters left today`;

  return (
    <form className="card composer" onSubmit={submit}>
      <label className="script">
        <span className="sr-only">What should the narrator say?</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={keyed ? 20000 : Math.max(quota?.limit ?? 1000, 1)}
          placeholder={PLACEHOLDER}
        />
        <span className={`hint ${tooLong ? "warn" : ""}`}>{counter}</span>
      </label>

      <VoicePicker voices={picks} samples={samples} value={voiceId} onChange={setVoiceId} />

      <details className="advanced">
        <summary>Advanced</summary>
        <div className="advanced-body">
          {keyed && (
            <label>
              Every voice
              <div className="row">
                <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={!voices.length}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {voiceLabel(v)}
                    </option>
                  ))}
                </select>
                <button type="button" className="ghost" onClick={onCloneVoice} disabled={!online}>
                  Clone a voice
                </button>
              </div>
            </label>
          )}

          <fieldset>
            <legend>Emotion</legend>
            <div className="chips">
              {emotions.map((e) => (
                <button
                  type="button"
                  key={e.name}
                  className={`chip ${emotion === e.name ? "chip-on" : ""}`}
                  onClick={() => setEmotion(e.name)}
                  title={e.description}
                >
                  {e.name}
                </button>
              ))}
            </div>
            {voice && !voice.supports_emotion && (
              <span className="hint">{voice.name} can't act out emotions; it only changes the pace a little. Try Chatterbox or Ryan.</span>
            )}
          </fieldset>

          <div className="sliders">
            <label>
              Intensity <output>{Math.round(intensity * 100)}%</output>
              <input type="range" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(+e.target.value)} />
            </label>
            <label>
              Speed <output>{speed.toFixed(2)}×</output>
              <input type="range" min={0.6} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(+e.target.value)} />
            </label>
          </div>

          {keyed ? (
            <div className="row">
              <label className="grow">
                Tags
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Optional, e.g. homepage, intro" />
              </label>
              <label>
                Format
                <select value={format} onChange={(e) => setFormat(e.target.value as "mp3" | "wav")}>
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV</option>
                </select>
              </label>
            </div>
          ) : (
            <p className="hint">
              Voice cloning, the full voice library, WAV files and unlimited length need a key.{" "}
              <button type="button" className="link" onClick={onNeedKey}>
                I have a key
              </button>
            </p>
          )}
        </div>
      </details>

      {error && <p className="error">{error}</p>}
      {quota?.demo_full && <p className="hint warn">The free demo has used up today's narration. It resets at midnight UTC.</p>}
      {quota && !quota.demo_full && quota.remaining === 0 && (
        <p className="hint warn">You've used today's free characters. They reset at midnight UTC.</p>
      )}

      <button type="submit" className="primary big" disabled={blocked || busy || !text.trim() || tooLong}>
        {busy ? "Sending…" : online ? "Generate" : "Resting"}
      </button>
    </form>
  );
}
