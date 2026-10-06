import { useMemo, useRef } from 'react';
import { clsx } from '@/lib/clsx';

/**
 * Lightweight code editor.
 *
 * A transparent textarea layered over a syntax-highlighted <pre> — no heavy
 * editor dependency, but with line numbers, tab handling and real highlighting
 * so the playground feels like a tool rather than a form field.
 */

const KEYWORDS = /\b(function|return|const|let|var|if|else|for|while|of|in|new|null|true|false|typeof|reduce|filter|map|Math)\b/g;
const NUMBERS = /\b(\d+\.?\d*)\b/g;
const STRINGS = /('[^']*'|"[^"]*"|`[^`]*`)/g;
const COMMENTS = /(\/\/[^\n]*)/g;
const PROPS = /\b(servers|request|state|server|best)\b/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlight(code: string): string {
  let html = escapeHtml(code);
  html = html.replace(COMMENTS, '<span class="text-slate-600 italic">$1</span>');
  html = html.replace(STRINGS, '<span class="text-neon-mint/80">$1</span>');
  html = html.replace(KEYWORDS, '<span class="text-neon-violet">$1</span>');
  html = html.replace(PROPS, '<span class="text-neon-cyan/90">$1</span>');
  html = html.replace(NUMBERS, '<span class="text-neon-amber/90">$1</span>');
  return html;
}

export function CodeEditor({
  value,
  onChange,
  error,
  readOnly,
}: {
  value: string;
  onChange?: (next: string) => void;
  error?: string | null;
  readOnly?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const html = useMemo(() => highlight(value), [value]);
  const lines = value.split('\n').length;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange?.(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl border bg-black/45 font-mono text-[12.5px] leading-[1.65]',
        error ? 'border-neon-rose/50' : 'border-white/[0.08] focus-within:border-neon-cyan/40',
      )}
    >
      <div className="flex">
        <div
          aria-hidden
          className="select-none border-r border-white/[0.06] bg-white/[0.02] px-2.5 py-3 text-right text-slate-700"
          style={{ minWidth: 42 }}
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <pre
            aria-hidden
            className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-3 text-slate-300"
            dangerouslySetInnerHTML={{ __html: `${html}\n` }}
          />
          <textarea
            ref={textareaRef}
            value={value}
            readOnly={readOnly}
            spellCheck={false}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            className="editor relative min-h-[300px] w-full resize-y bg-transparent px-3 py-3 text-transparent caret-neon-cyan outline-none"
            style={{ minHeight: 300 }}
          />
        </div>
      </div>
      {error && (
        <div className="border-t border-neon-rose/30 bg-neon-rose/[0.08] px-3 py-2 text-[11.5px] text-neon-rose">
          {error}
        </div>
      )}
    </div>
  );
}
