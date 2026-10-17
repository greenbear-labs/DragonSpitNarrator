import { FormEvent, useState } from "react";
import { Backend, Voice } from "./api";

type Props = {
  backend: Backend;
  onClose: () => void;
  onAdded: (voice: Voice) => void;
};

// Uploads through the website are capped at about 4.5 MB, so recordings are shrunk to 24 kHz mono WAV
// (about 1.4 MB for 30 seconds) in the browser first. Chatterbox works at that rate anyway.
const RATE = 24_000;
const MAX_SECONDS = 40;

async function compactWav(file: File): Promise<Blob> {
  const decoded = await new AudioContext().decodeAudioData(await file.arrayBuffer());
  const seconds = Math.min(decoded.duration, MAX_SECONDS);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * RATE), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, s: string) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}

export function CloneVoice({ backend, onClose, onAdded }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [transcript, setTranscript] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set("name", name);
    form.set("description", description);
    form.set("transcript", transcript);
    form.set("consent", String(consent));
    setBusy(true);
    setError(null);
    try {
      if (backend.mode === "relay") {
        const wav = await compactWav(file).catch(() => {
          throw new Error("Couldn't read that recording. Try a WAV or MP3 file.");
        });
        form.set("reference", wav, "reference.wav");
      } else {
        form.set("reference", file);
      }
      onAdded(await backend.addVoice(form));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card dialog" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2>Clone a voice</h2>
        <p className="hint">
          Upload 10 to 30 seconds of one person speaking clearly, with no music or background noise. Chatterbox then speaks
          in that voice, and the emotion controls still work.
        </p>
        <label>
          Voice name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Alex narrator" />
        </label>
        <label>
          Recording
          <input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </label>
        <label>
          What the recording says <span className="hint">(optional, helps quality)</span>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} maxLength={2000} />
        </label>
        <label>
          Description <span className="hint">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          This is my voice, or the speaker has agreed to have their voice cloned.
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row-end">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !consent || !file || !name.trim()}>
            {busy ? "Saving…" : "Save voice"}
          </button>
        </div>
      </form>
    </div>
  );
}
