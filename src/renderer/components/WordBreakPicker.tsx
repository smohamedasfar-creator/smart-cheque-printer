interface Props {
  label: string;
  words: string[];
  /** Index of the first word on line 2 chosen by the user, or null for automatic. */
  breakAt: number | null;
  /** Where the automatic wrap currently puts line 2. */
  autoBreakAt: number;
  onChange: (breakAt: number | null) => void;
}

/** Shows the words of a two-line field; clicking a word makes it the first word of line 2. */
export function WordBreakPicker({ label, words, breakAt, autoBreakAt, onChange }: Props) {
  const current = breakAt ?? autoBreakAt;
  return (
    <div className="word-break">
      <div className="word-break-head">
        <span>{label}</span>
        <button type="button" className={breakAt === null ? 'active' : ''} onClick={() => onChange(null)}>Auto</button>
      </div>
      <div className="word-break-words">
        {words.map((w, i) => (
          <span key={i} className="word-slot">
            {i === current && i > 0 && <span className={`break-mark${breakAt === null ? ' auto' : ''}`} title="Line 2 starts here">↵</span>}
            <button
              type="button"
              className={`word${i >= current && current > 0 ? ' line2' : ''}`}
              title={i === 0 ? 'The first word stays on line 1' : 'Start line 2 from this word'}
              disabled={i === 0}
              onClick={() => onChange(i)}
            >
              {w}
            </button>
          </span>
        ))}
      </div>
      <p className="hint">Click the word that should start line 2. Auto wraps at the end of line 1.</p>
    </div>
  );
}
