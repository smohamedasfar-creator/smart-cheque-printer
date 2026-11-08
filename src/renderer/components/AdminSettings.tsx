import { useEffect, useState } from 'react';
import { askAdmin } from '../admin';

type Status = Awaited<ReturnType<typeof window.chequeApi.securityStatus>>;
const MIN = 4;
const clean = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * Settings → Admin password: set one, choose what it protects (deleting, settings, opening the app), change or remove it.
 * The checks are made by the app's core; this screen only sets them up.
 */
export function AdminSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = () => window.chequeApi.securityStatus().then(setStatus);
  useEffect(() => {
    refresh();
  }, []);
  if (!status) return null;

  const reset = () => {
    setCurrent('');
    setNext('');
    setRepeat('');
    setChanging(false);
  };

  const savePassword = async () => {
    if (next.length < MIN) return setMessage({ kind: 'error', text: `Use at least ${MIN} characters.` });
    if (next !== repeat) return setMessage({ kind: 'error', text: 'The two new passwords are not the same.' });
    try {
      await window.chequeApi.setAdminPassword(status.passwordSet ? current : null, next);
      setMessage({ kind: 'ok', text: status.passwordSet ? 'Password changed.' : 'Admin password set. Deleting now needs it.' });
      reset();
      refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: clean(e) });
    }
  };

  const removePassword = async () => {
    if (!confirm('Remove the admin password? Everything will work without it.')) return;
    try {
      await window.chequeApi.setAdminPassword(current, null);
      setMessage({ kind: 'ok', text: 'Admin password removed.' });
      reset();
      refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: clean(e) });
    }
  };

  const setOption = async (key: 'protectDelete' | 'protectSettings' | 'lockOnStart', value: boolean) => {
    const options = { protectDelete: status.protectDelete, protectSettings: status.protectSettings, lockOnStart: status.lockOnStart, [key]: value };
    if (!status.unlocked && !(await askAdmin('Changing what the password protects needs the admin password.'))) return;
    try {
      await window.chequeApi.setSecurityOptions(options);
      setMessage({ kind: 'ok', text: 'Saved.' });
      refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: clean(e) });
    }
  };

  const passwordFields = (
    <>
      {status.passwordSet && (
        <label>Current password<input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></label>
      )}
      <div className="row">
        <label>{status.passwordSet ? 'New password' : 'Password'}<input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" /></label>
        <label>Type it again<input type="password" value={repeat} onChange={e => setRepeat(e.target.value)} autoComplete="new-password" /></label>
      </div>
    </>
  );

  return (
    <div className="admin-settings">
      <h2>Admin password {status.passwordSet ? <span className="tag ok">✓ On</span> : <span className="tag">Off</span>}</h2>
      {!status.passwordSet ? (
        <>
          <p className="hint">Set a password so only the admin can delete cheques, cheque books and payees, change settings, or open the app. Keep it safe: it cannot be recovered.</p>
          {passwordFields}
          <div className="actions"><button className="primary" onClick={savePassword}>Set password</button></div>
        </>
      ) : (
        <>
          <p className="hint">Ask for the admin password to:</p>
          <label className="check"><input type="checkbox" checked={status.protectDelete} onChange={e => setOption('protectDelete', e.target.checked)} /> Delete cheques, cheque books and payees, and restore a backup</label>
          <label className="check"><input type="checkbox" checked={status.protectSettings} onChange={e => setOption('protectSettings', e.target.checked)} /> Change settings (printer setup and the rest of this page)</label>
          <label className="check"><input type="checkbox" checked={status.lockOnStart} onChange={e => setOption('lockOnStart', e.target.checked)} /> Open the app (login when it starts)</label>
          <p className="hint">Once typed, the password is accepted for 10 minutes. {status.unlocked && <button type="button" className="link" onClick={async () => { await window.chequeApi.lockAdmin(); refresh(); }}>Lock now</button>}</p>
          {changing ? (
            <>
              {passwordFields}
              <div className="actions">
                <button className="primary" onClick={savePassword}>Change password</button>
                <button className="danger" onClick={removePassword} disabled={!current}>Remove password</button>
                <button onClick={reset}>Cancel</button>
              </div>
            </>
          ) : (
            <div className="actions"><button onClick={() => setChanging(true)}>Change or remove password</button></div>
          )}
        </>
      )}
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
    </div>
  );
}
