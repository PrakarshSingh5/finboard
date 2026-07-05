// src/components/QueryInput.tsx
//
// Styled as a terminal command line: a "$" prompt glyph, monospace text,
// and a signal-colored focus ring. This is the first thing a user sees,
// so it needs to immediately establish the "research terminal" identity.

"use client";

import { useState } from "react";

interface QueryInputProps {
  onSubmit: (query: string) => void;
  disabled?: boolean;
}

export function QueryInput({ onSubmit, disabled }: QueryInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-3.5 transition-colors focus-within:border-signal/60">
        <span className="font-mono text-signal text-sm select-none">$</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="compare nvidia and amd margins"
          disabled={disabled}
          className="flex-1 bg-transparent font-mono text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded-md bg-signal px-4 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-base disabled:opacity-30 disabled:cursor-not-allowed hover:bg-signal/90 transition-colors"
        >
          {disabled ? "Running" : "Run"}
        </button>
      </div>
    </form>
  );
}