import { FormEvent, useState } from "react";
import { DEFAULT_ENGINE_URL, Settings } from "./api";

type Props = {
  settings: Settings;
  connection: string;
  onSave: (settings: Settings) => void;
  onClose: () => void;
};

export function SettingsPanel({ settings, connection, onSave, onClose }: Props) {
  const [url, setUrl] = useState(settings.url);
  const [token, setToken] = useState(settings.token);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ url: url.trim() || DEFAULT_ENGINE_URL, token: token.trim() });
  };

  return (
    <section className="card settings">
      <form onSubmit={submit}>
        <h2>Engine settings</h2>
        {connection === "bad-token" && <p className="error">The engine didn't accept that token. Paste it again.</p>}
        <label>
          Engine address
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_ENGINE_URL} />
        </label>
        <label>
          Engine token
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder="Paste the token from the Mac mini"
          />
        </label>
        <p className="hint">
          To get the token, run <code>uv run narrator-engine token</code> in the <code>engine</code> folder on the Mac mini.
          This browser remembers it.
        </p>
        <div className="row-end">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save and connect</button>
        </div>
      </form>
    </section>
  );
}
