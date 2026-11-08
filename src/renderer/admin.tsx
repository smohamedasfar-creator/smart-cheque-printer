// The admin password on screen: a box that asks for it when an operation needs it, then tries again.
// The check itself is made by the app's core (main process); this only asks and retries.
import { useEffect, useRef, useState, type FormEvent } from 'react';

type Ask = (reason: string) => Promise<boolean>;
let ask: Ask | null = null;

/** The text the core sends when an operation needs the admin password. */
const ADMIN_REQUIRED = 'ADMIN_REQUIRED';

export const needsAdmin = (e: unknown) => String(e instanceof Error ? e.message : e).includes(ADMIN_REQUIRED);

/**
 * Runs a protected operation. When it needs the admin password, asks for it once and runs it again.
 * Returns undefined when the user cancels.
 */
export async function withAdmin<T>(fn: () => Promise<T>, reason = 'This needs the admin password.'): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    if (!needsAdmin(e) || !ask) throw e;
    if (!(await ask(reason))) return undefined;
    return await fn();
  }
}

/** Asks for the admin password now (e.g. before changing the password settings). */
export const askAdmin = (reason: string) => (ask ? ask(reason) : Promise.resolve(false));

/** Rendered once in the app: the password box, shown only while an operation waits for it. */
export function AdminPrompt() {
  const [pending, setPending] = useState<{ reason: string; done: (ok: boolean) => void } | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ask = reason =>
      new Promise<boolean>(resolve => {
        setPassword('');
        setError('');
        setPending({ reason, done: resolve });
      });
    return () => {
      ask = null;
    };
  }, []);
  useEffect(() => {
    if (pending) input.current?.focus();
  }, [pending]);

  if (!pending) return null;
  const close = (ok: boolean) => {
    pending.done(ok);
    setPending(null);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await window.chequeApi.unlockAdmin(password)) close(true);
    else {
      setError('Wrong password. Try again.');
      setPassword('');
      input.current?.focus();
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <form className="modal form" onSubmit={submit}>
        <h2 id="admin-title">Admin password</h2>
        <p>{pending.reason}</p>
        <label>
          Password
          <input ref={input} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <p className="hint">Accepted for 10 minutes, then asked again.</p>
        <div className="actions">
          <button type="submit" className="primary" disabled={!password}>Unlock</button>
          <button type="button" onClick={() => close(false)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/** Shown instead of the app while it is locked at start. */
export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await window.chequeApi.login(password)) onUnlocked();
    else {
      setError('Wrong password.');
      setPassword('');
    }
  };
  return (
    <div className="lock-screen">
      <form className="modal form" onSubmit={submit}>
        <h1>Smart Cheque Printer</h1>
        <p>Enter the admin password to open the app.</p>
        <label>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={!password}>Open</button>
      </form>
    </div>
  );
}
