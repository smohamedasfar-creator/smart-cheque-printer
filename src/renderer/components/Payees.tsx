import { useEffect, useState } from 'react';

const cleanError = (e: unknown) => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '');

/** Saved payee names, used for autocomplete on Write Cheque. */
export function Payees() {
  const [payees, setPayees] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = async () => setPayees(await window.chequeApi.listPayees());
  useEffect(() => {
    load();
  }, []);

  const run = async (action: () => Promise<void>, ok: string) => {
    try {
      await action();
      await load();
      setMessage({ kind: 'ok', text: ok });
    } catch (e) {
      setMessage({ kind: 'error', text: cleanError(e) });
    }
  };

  const add = () => run(async () => { await window.chequeApi.addPayee(newName); setNewName(''); }, `Added "${newName.trim()}".`);
  const saveEdit = () => editing && run(async () => { await window.chequeApi.renamePayee(editing.from, editing.to); setEditing(null); }, 'Payee updated.');
  const remove = (name: string) => confirm(`Delete "${name}" from the payee list?`) && run(() => window.chequeApi.deletePayee(name), `Deleted "${name}".`);

  const shown = payees.filter(p => p.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <section className="payees">
      <h2>Payees</h2>
      <p className="hint">Names saved here appear as suggestions when you type a payee on Write Cheque. New payees are also saved automatically when you print. Renaming a payee does not change cheques already printed.</p>
      <form className="filters" onSubmit={e => { e.preventDefault(); add(); }}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New payee name" />
        <button type="submit" className="primary" disabled={!newName.trim()}>Add payee</button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" />
      </form>
      {message && <p className={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</p>}
      <table>
        <thead><tr><th>Payee name</th><th /></tr></thead>
        <tbody>
          {shown.length === 0 && <tr><td colSpan={2} className="empty-row">{payees.length ? 'No payee matches the search.' : 'No payees yet.'}</td></tr>}
          {shown.map(p => (
            <tr key={p}>
              <td>
                {editing?.from === p ? (
                  <input
                    className="inline-edit"
                    value={editing.to}
                    autoFocus
                    onChange={e => setEditing({ from: p, to: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }}
                  />
                ) : p}
              </td>
              <td className="row-actions">
                {editing?.from === p ? (
                  <>
                    <button className="primary" onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing({ from: p, to: p })}>Edit</button>
                    <button onClick={() => remove(p)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
