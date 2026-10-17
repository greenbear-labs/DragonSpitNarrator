import { useEffect, useRef, useState } from "react";
import { ENGINE_LABELS, Voice } from "./api";
import { SampleManifest } from "./samples";

type Props = {
  voices: Voice[];
  samples: SampleManifest;
  value: string;
  onChange: (id: string) => void;
};

export function VoicePicker({ voices, samples, value, onChange }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const sampleFor = (id: string) => samples.voices.find((s) => s.voice_id === id);

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = (id: string, file: string) => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
    }
    if (playing === id) {
      audio.current.pause();
      setPlaying(null);
      return;
    }
    audio.current.src = file;
    audio.current.play().catch(() => setPlaying(null));
    setPlaying(id);
  };

  return (
    <div className="voices" role="radiogroup" aria-label="Voice">
      {voices.map((v) => {
        const sample = sampleFor(v.id);
        const meta = [v.gender, v.accent].filter(Boolean).join(", ");
        return (
          <div key={v.id} className={`voice ${value === v.id ? "voice-on" : ""}`}>
            <button type="button" role="radio" aria-checked={value === v.id} className="voice-pick" onClick={() => onChange(v.id)}>
              <strong>{v.name}</strong>
              <span>{[meta, v.source === "custom" ? "cloned" : ENGINE_LABELS[v.engine]].filter(Boolean).join(" · ")}</span>
            </button>
            {sample && (
              <button
                type="button"
                className="voice-play"
                onClick={() => toggle(v.id, sample.file)}
                aria-label={playing === v.id ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                title={sample.text}
              >
                {playing === v.id ? "■" : "▶"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
