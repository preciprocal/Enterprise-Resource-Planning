// components/ui/dialog-host.tsx
// The ERP's own confirm and alert dialogs, in place of the browser's
// window.confirm / alert ("localhost says..."), which look broken and can't
// say which button does what.
//
//   if (!(await confirmDialog({ title: "Delete card?", message: "...", confirmLabel: "Delete", tone: "danger" }))) return;
//   await alertDialog({ title: "Could not connect", message: e.message });
//
// One <DialogHost /> is mounted in app/layout.tsx; these functions can be
// called from anywhere on the client.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface DialogRequest {
  kind: "confirm" | "alert";
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  resolve: (ok: boolean) => void;
}

let push: ((d: DialogRequest) => void) | null = null;
const queue: DialogRequest[] = [];

function open(d: Omit<DialogRequest, "resolve">): Promise<boolean> {
  return new Promise(resolve => {
    const req = { ...d, resolve };
    if (push) push(req); else queue.push(req);
  });
}

export function confirmDialog(o: { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: "default" | "danger" }): Promise<boolean> {
  return open({ kind: "confirm", ...o });
}

export async function alertDialog(o: { title: string; message?: ReactNode; confirmLabel?: string; tone?: "default" | "danger" }): Promise<void> {
  await open({ kind: "alert", ...o });
}

export function DialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const pending = useRef<DialogRequest[]>([]);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    push = d => setCurrent(c => { if (c) { pending.current.push(d); return c; } return d; });
    if (queue.length) { const first = queue.shift()!; pending.current.push(...queue.splice(0)); void Promise.resolve().then(() => setCurrent(first)); }
    return () => { push = null; };
  }, []);

  const close = (ok: boolean) => {
    current?.resolve(ok);
    setCurrent(pending.current.shift() ?? null);
  };

  useEffect(() => {
    if (!current) return;
    confirmBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(current.kind === "alert"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;
  const danger = current.tone === "danger";

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={() => close(current.kind === "alert")} />
      <div role={current.kind === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="erp-dialog-title"
        className="relative w-full max-w-[420px] rounded-xl border border-[#222] bg-[#0a0a0a] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 w-8 h-8 shrink-0 rounded-lg flex items-center justify-center border ${danger ? "border-[rgba(255,68,68,0.3)] bg-[rgba(255,68,68,0.08)] text-[#f44]" : "border-[#2a2a2a] bg-[#111] text-[#bbb]"}`} aria-hidden="true">
              {danger
                ? <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
                : <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>}
            </span>
            <div className="min-w-0">
              <h2 id="erp-dialog-title" className="text-[15px] font-semibold text-[#ededed] leading-snug">{current.title}</h2>
              {current.message && <div className="text-[13px] text-[#999] leading-relaxed mt-1.5">{current.message}</div>}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[#161616] bg-[#070707] rounded-b-xl">
          {current.kind === "confirm" && (
            <button onClick={() => close(false)}
              className="px-3.5 h-9 rounded-lg text-[13px] font-medium border border-[#2a2a2a] bg-transparent text-[#bbb] hover:text-[#ededed] hover:border-[#3a3a3a] cursor-pointer transition-colors">
              {current.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button ref={confirmBtn} onClick={() => close(true)}
            className={`px-4 h-9 rounded-lg text-[13px] font-semibold border-none cursor-pointer transition-colors ${danger ? "bg-[#e5484d] text-white hover:bg-[#f05a5f]" : "bg-[#ededed] text-black hover:bg-white"}`}>
            {current.confirmLabel ?? (current.kind === "alert" ? "OK" : "Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}
