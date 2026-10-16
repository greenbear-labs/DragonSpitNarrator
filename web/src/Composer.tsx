import { FormEvent, useEffect, useMemo, useState } from "react";
import { Clip, Emotion, Engine, Voice } from "./api";

type Props = {
  engine: Engine;
  voices: Voice[];
  emotions: Emotion[];
  disabled: boolean;
  onCreated: (clip: Clip) => void;
  onCloneVoice: () => void;
};

const ENGINE_LABELS: Record<Voice["engine"], string> = {
  kokoro: "Kokoro",
  chatterbox: "Chatterbox",
  qwen3: "Qwen3-TTS",
};

const DRAFT_KEY = "narrator.draft";

function groupVoices(voices: Voice[]) {
  const groups: [string, Voice[]][] = [
    ["Your picks", voices.filter((v) => v.recommended)],
    ["Your cloned voices", voices.filter((v) => v.source === "custom" && !v.recommended)],
  ];
  for (const engine of ["kokoro", "chatterbox", "qwen3"] as const) {
    groups.push([ENGINE_LABELS[engine], voices.filter((v) => v.engine === engine && v.source === "preset" && !v.recommended)]);
  }
  return groups.filter(([, list]) => list.length > 0);
}

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

export function Composer({ engine, voices, emotions, disabled, onCreated, onCloneVoice }: Props) {
  const [text, setText] = useState(readDraft);
  const [voiceId, setVoiceId] = useState("kokoro:af_heart");
  const [emotion, setEmotion] = useState("neutral");
  const [intensity, setIntensity] = useState(0.6);
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupVoices(voices), [voices]);
  const voice = voices.find((v) => v.id === voiceId);

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const clip = await engine.createClip({
        text,
        voice_id: voiceId,
        emotion,
        intensity,
        speed,
        format,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      onCreated(clip);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const emotionWorks = voice?.supports_emotion ?? false;

  return (
    <form className="card composer" onSubmit={submit}>
      <h2>New narration</h2>

      <label>
        Script
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          maxLength={20000}
          placeholder="Type or paste what you want narrated. Blank lines start a new paragraph."
        />
        <span className="hint">{text.length.toLocaleString()} characters</span>
      </label>

      <label>
        Voice
        <div className="row">
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={!voices.length}>
            {groups.map(([name, list]) => (
              <optgroup key={name} label={name}>
                {list.map((v) => (
                  <option key={v.id} value={v.id}>
                    {voiceLabel(v)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" className="ghost" onClick={onCloneVoice} disabled={disabled}>
            Clone a voice
          </button>
        </div>
        {voice && <span className="hint">{voice.description}</span>}
      </label>

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
        {!emotionWorks && voice && (
          <span className="hint">Kokoro voices can't act out emotions. Here the emotion only changes the pace a little.</span>
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

      {error && <p className="error">{error}</p>}

      <button type="submit" className="primary" disabled={disabled || busy || !text.trim()}>
        {busy ? "Sending…" : "Generate narration"}
      </button>
    </form>
  );
}
