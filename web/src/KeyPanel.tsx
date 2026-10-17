import { FormEvent, useState } from "react";
import { DEFAULT_ENGINE_URL, DirectSettings, Status } from "./api";

type Props = {
  status: Status | null;
  direct: DirectSettings;
  onSignIn: (key: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onDirect: (settings: DirectSettings) => void;
  onClose: () => void;
};

export function KeyPanel({ status, direct, onSignIn, onSignOut, onDirect, onClose }: Props) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(direct.url);
  const [token, setToken] = useState(direct.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = status?.access.tier === "key" && !direct.token ? status.access.name : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSignIn(key.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <section className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Your key</h2>
        {signedIn ? (
          <>
            <p>
              You're using the key for <strong>{signedIn}</strong>: no daily limit, every voice, and voice cloning.
            </p>
            <div className="row-end">
              <button type="button" className="ghost" onClick={onClose}>
                Close
              </button>
              <button type="button" onClick={onSignOut}>
                Stop using this key
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <p className="hint">
              Anyone can make a few clips a day for free. A key from Alex removes the limit and unlocks every voice and
              voice cloning. This browser remembers it.
            </p>
            <label>
              Key
              <input value={key} onChange={(e) => setKey(e.target.value)} type="password" autoComplete="off" autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="row-end">
              <button type="button" className="ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy || !key.trim()}>
                {busy ? "Checking…" : "Use key"}
              </button>
            </div>
          </form>
        )}

        <details className="advanced" open={!!direct.token}>
          <summary>Connect straight to the engine</summary>
          <form
            className="stack advanced-body"
            onSubmit={(e) => {
              e.preventDefault();
              onDirect({ url: url.trim() || DEFAULT_ENGINE_URL, token: token.trim() });
            }}
          >
            <p className="hint">
              For the Mac mini itself: the page skips the website's relay and talks to the engine with its own token (
              <code>uv run narrator-engine token</code>). Leave the token empty to go back to the normal site.
            </p>
            <label>
              Engine address
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_ENGINE_URL} />
            </label>
            <label>
              Engine token
              <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
            </label>
            <div className="row-end">
              <button type="submit">{token.trim() ? "Connect directly" : "Use the normal site"}</button>
            </div>
          </form>
        </details>
      </section>
    </div>
  );
}
