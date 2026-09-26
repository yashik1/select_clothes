"use client";

import { useState } from "react";
import { Card, SectionTitle, Button } from "@/components/ui";

type Message = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "What should I wear tomorrow?",
  "Build me a smart-casual outfit.",
  "What can I wear with my least-used clothes?",
  "Do I really need another jacket?",
  "What should I pack for a 5-day trip?",
];

export function Stylist() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(prompt = input) {
    const text = prompt.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/stylist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      const body = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: body.answer || body.error || "I couldn't produce a recommendation." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "The stylist is temporarily unavailable." }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <SectionTitle hint="Ask naturally. FitCheck supplies the wardrobe, measurements, weather and wear history; the AI explains the evidence rather than inventing fit.">Ask FitCheck</SectionTitle>
      {messages.length === 0 && <div className="grid gap-2 sm:grid-cols-2">{STARTERS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-2xl border border-[var(--color-line)] p-4 text-left text-sm hover:border-[var(--color-accent)]">{s}</button>)}</div>}
      <Card className="min-h-[28rem] p-5"><div className="space-y-5">{messages.map((m, i) => <div key={i} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-2xl bg-[var(--color-ink)] p-4 text-sm text-white" : "max-w-[90%] rounded-2xl bg-[var(--color-raised)] p-4 text-sm leading-6"}>{m.content}</div>)}{busy && <p className="text-sm text-[var(--color-faint)]">Thinking from your wardrobe…</p>}</div></Card>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2"><input className="min-h-12 flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your wardrobe…" /><Button disabled={busy || !input.trim()}>Ask</Button></form>
    </div>
  );
}