import { useState } from "react";
import { Backend, Clip, Voice } from "./api";

type Props = {
  backend: Backend;
  title: string;
  canDelete: boolean;
  clips: Clip[];
  voiceById: Map<string, Voice>;
  onDeleted: (id: string) => void;
};

function when(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ClipList({ backend, title, canDelete, clips, voiceById, onDeleted }: Props) {
  const [filter, setFilter] = useState("");
  const shown = filter
    ? clips.filter((c) => c.tags.includes(filter) || c.text.toLowerCase().includes(filter.toLowerCase()))
    : clips;
  const allTags = [...new Set(clips.flatMap((c) => c.tags))].filter((t) => !t.startsWith("visitor-")).sort();

  const remove = async (clip: Clip) => {
    if (!canDelete) return onDeleted(clip.id);
    if (!confirm("Delete this clip? This can't be undone.")) return;
    await backend.deleteClip(clip.id);
    onDeleted(clip.id);
  };

  if (clips.length === 0) return null;

  return (
    <section className="card library">
      <div className="row library-head">
        <h2>{title}</h2>
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

      {shown.length === 0 && <p className="empty">No clips match that search.</p>}

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
                {clip.tags.filter((t) => !t.startsWith("visitor-")).map((t) => (
                  <button key={t} className="tag" onClick={() => setFilter(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <p className="clip-text">{clip.text}</p>

              {clip.status === "done" && (
                <div className="row clip-actions">
                  <audio controls preload="none" src={backend.audioUrl(clip)} />
                  <a className="button ghost" href={backend.audioUrl(clip)} download>
                    Download {clip.format.toUpperCase()}
                  </a>
                  {clip.format === "mp3" && canDelete && (
                    <a className="button ghost" href={backend.audioUrl(clip, "wav")} download>
                      WAV
                    </a>
                  )}
                  {canDelete && (
                    <button className="ghost danger" onClick={() => remove(clip)}>
                      Delete
                    </button>
                  )}
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
