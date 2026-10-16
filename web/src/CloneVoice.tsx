import { FormEvent, useState } from "react";
import { Engine, Voice } from "./api";

type Props = {
  engine: Engine;
  onClose: () => void;
  onAdded: (voice: Voice) => void;
};

export function CloneVoice({ engine, onClose, onAdded }: Props) {
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
    form.set("reference", file);
    setBusy(true);
    setError(null);
    try {
      onAdded(await engine.addVoice(form));
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
