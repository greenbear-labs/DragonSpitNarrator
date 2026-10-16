import { useState } from "react";
import { Clip, Engine, Voice } from "./api";

type Props = {
  engine: Engine;
  clips: Clip[];
  voiceById: Map<string, Voice>;
  onDeleted: (id: string) => void;
};

function when(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ClipList({ engine, clips, voiceById, onDeleted }: Props) {
  const [filter, setFilter] = useState("");
  const shown = filter
    ? clips.filter((c) => c.tags.includes(filter) || c.text.toLowerCase().includes(filter.toLowerCase()))
    : clips;
  const allTags = [...new Set(clips.flatMap((c) => c.tags))].sort();

  const remove = async (clip: Clip) => {
    if (!confirm("Delete this clip? This can't be undone.")) return;
    await engine.deleteClip(clip.id);
    onDeleted(clip.id);
  };

  return (
    <section className="card library">
      <div className="row library-head">
        <h2>Clips</h2>
        <input
          className="search"
          list="tag-list"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search text or tag"
        />
        <datalist id="tag-list">
          {allTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>

      {shown.length === 0 && <p className="empty">No clips yet. Write something on the left and press Generate.</p>}

      <ul className="clips">
        {shown.map((clip) => {
          const voice = voiceById.get(clip.voice_id);
          return (
            <li key={clip.id} className={`clip clip-${clip.status}`}>
              <div className="clip-meta">
                <strong>{voice?.name ?? clip.voice_id}</strong>
                <span>{clip.emotion}</span>
                {clip.duration_s != null && <span>{clip.duration_s.toFixed(1)} s</span>}
                <span>{when(clip.created_at)}</span>
                {clip.tags.map((t) => (
                  <button key={t} className="tag" onClick={() => setFilter(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <p className="clip-text">{clip.text}</p>

              {clip.status === "done" && (
                <div className="row clip-actions">
                  <audio controls preload="none" src={engine.audioUrl(clip)} />
                  <a className="button ghost" href={engine.audioUrl(clip)} download>
                    Download {clip.format.toUpperCase()}
                  </a>
                  {clip.format === "mp3" && (
                    <a className="button ghost" href={engine.audioUrl(clip, "wav")} download>
                      WAV
                    </a>
                  )}
                  <button className="ghost danger" onClick={() => remove(clip)}>
                    Delete
                  </button>
                </div>
              )}
              {(clip.status === "queued" || clip.status === "running") && (
                <p className="working">
                  <span className="spinner" />
                  {clip.status === "queued" ? "Waiting its turn…" : "Generating… the first clip from a voice can take a minute"}
                </p>
              )}
              {clip.status === "failed" && (
                <div className="row clip-actions">
                  <p className="error">Failed: {clip.error}</p>
                  <button className="ghost danger" onClick={() => remove(clip)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
