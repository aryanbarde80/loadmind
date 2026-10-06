import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, Sparkles, X, Bot, User, Loader2 } from 'lucide-react';
import { clsx } from '@/lib/clsx';
import { useApp } from '@/state/store';
import { CHAT_SUGGESTIONS } from '@/analytics/chat';
import { vitalsLine } from '@/analytics/chat';
import { engine } from '@/state/store';

/**
 * LoadMind AI — floating, state-aware assistant.
 *
 * Every answer is computed from the live engine, the last battle or the saved
 * run history (see analytics/chat.ts). It is intentionally not a general
 * chatbot: if it cannot answer from application state, it says so.
 */
export function ChatPanel() {
  const chat = useApp((s) => s.chat);
  const setChatOpen = useApp((s) => s.setChatOpen);
  const askQuestion = useApp((s) => s.askQuestion);
  const clearChat = useApp((s) => s.clearChat);
  const setWhyOpen = useApp((s) => s.setWhyOpen);
  const runs = useApp((s) => s.runs);
  const snapshot = useApp((s) => s.snapshot);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages.length, chat.thinking]);

  if (!chat.open) {
    return (
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-neon-violet/40 bg-void-900/90 px-4 py-3 text-[13px] font-semibold text-[#c3b9ff] shadow-[0_18px_50px_-18px_rgba(139,124,246,0.8)] backdrop-blur-xl transition hover:border-neon-violet/70 hover:text-white"
      >
        <Sparkles className="h-4 w-4" />
        LoadMind AI
        <span className="ml-1 rounded-full bg-neon-violet/20 px-1.5 py-0.5 font-mono text-[9.5px]">
          {runs.length} runs
        </span>
      </button>
    );
  }

  const vitals = vitalsLine({
    running: snapshot.running,
    simTime: snapshot.simTime,
    servers: snapshot.servers,
    metrics: snapshot.metrics,
    distribution: snapshot.distribution,
    algorithmId: snapshot.activeAlgorithm,
    algorithmName: snapshot.activeAlgorithmName,
    autopilotEnabled: snapshot.autopilot.enabled,
    lastDecision: snapshot.autopilot.lastDecision,
    features: snapshot.autopilot.lastFeatures ?? null,
    chaos: snapshot.chaos,
    chaosSummary: '',
    runs,
    lastBattle: null,
    pattern: snapshot.config.pattern,
    baseRps: snapshot.config.baseRps,
  });

  const submit = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setInput('');
    askQuestion(trimmed);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex h-[560px] max-h-[calc(100vh-40px)] w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-white/[0.09] bg-void-900/95 shadow-[0_40px_100px_-40px_rgba(0,0,0,1)] backdrop-blur-2xl">
      {/* header */}
      <header className="flex items-center gap-3 border-b border-white/[0.07] bg-gradient-to-r from-neon-violet/[0.14] to-transparent px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg border border-neon-violet/40 bg-neon-violet/15">
          <Sparkles className="h-4 w-4 text-[#c3b9ff]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[13px] font-semibold text-white">LoadMind AI</div>
          <div className="truncate font-mono text-[10px] text-slate-500">{vitals}</div>
        </div>
        <button type="button" className="btn btn-ghost px-1.5 py-1" onClick={clearChat} title="Clear conversation">
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost px-1.5 py-1" onClick={() => setChatOpen(false)} title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        {chat.messages.map((message) => (
          <Message key={message.id} message={message} onWhy={() => setWhyOpen(true)} />
        ))}
        {chat.thinking && (
          <div className="flex items-center gap-2 text-[12px] text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-neon-violet" />
            Reading live telemetry…
          </div>
        )}
      </div>

      {/* suggestions */}
      <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] px-4 py-2.5">
        {CHAT_SUGGESTIONS.slice(0, 3).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => submit(suggestion)}
            className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-400 transition hover:border-neon-violet/40 hover:text-[#c3b9ff]"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {/* input */}
      <form
        className="flex items-center gap-2 border-t border-white/[0.07] bg-black/30 px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about traffic, algorithms, autopilot…"
          className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-slate-100 outline-none placeholder:text-slate-600"
        />
        <button type="submit" className="btn btn-violet px-2.5 py-1.5" disabled={!input.trim()}>
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

function Message({
  message,
  onWhy,
}: {
  message: { role: 'user' | 'assistant'; text: string; bullets?: string[]; chips?: { label: string; value: string; tone?: string }[]; suggestions?: string[] };
  onWhy: () => void;
}) {
  const ask = useApp((s) => s.askQuestion);

  if (message.role === 'user') {
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[85%] rounded-xl rounded-tr-sm border border-neon-cyan/25 bg-neon-cyan/[0.08] px-3 py-2 text-[12.5px] leading-relaxed text-slate-100">
          {message.text}
        </div>
        <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
          <User className="h-3 w-3 text-slate-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-neon-violet/30 bg-neon-violet/15">
        <Bot className="h-3 w-3 text-[#c3b9ff]" />
      </div>
      <div className="min-w-0 max-w-[88%] space-y-2">
        <div className="rounded-xl rounded-tl-sm border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-slate-200">
          {renderRich(message.text, onWhy)}
        </div>

        {message.chips && message.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.chips.map((chip) => (
              <span
                key={chip.label}
                className={clsx(
                  'rounded-md border px-2 py-0.5 font-mono text-[10px]',
                  chip.tone === 'good'
                    ? 'border-neon-mint/30 bg-neon-mint/10 text-neon-mint'
                    : chip.tone === 'warn'
                      ? 'border-neon-amber/30 bg-neon-amber/10 text-neon-amber'
                      : chip.tone === 'bad'
                        ? 'border-neon-rose/30 bg-neon-rose/10 text-neon-rose'
                        : 'border-white/10 bg-white/[0.04] text-slate-300',
                )}
              >
                {chip.label}: {chip.value}
              </span>
            ))}
          </div>
        )}

        {message.bullets && message.bullets.length > 0 && (
          <ul className="space-y-1">
            {message.bullets.map((bullet, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-slate-400">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-neon-violet/70" />
                <span>{renderRich(bullet, onWhy)}</span>
              </li>
            ))}
          </ul>
        )}

        {message.suggestions && message.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {message.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10.5px] text-slate-400 transition hover:border-neon-violet/40 hover:text-[#c3b9ff]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Minimal inline renderer: **bold** plus a clickable [Why?] affordance. */
function renderRich(text: string, onWhy: () => void): React.ReactNode {
  void onWhy;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export { engine };
