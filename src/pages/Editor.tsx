import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Save, Undo2, Redo2, LogOut, Hammer, Eraser, Loader2 } from "lucide-react";
import { ModelLibrary } from "@/game/ModelLibrary";
import { MapEditor, type EditorTool, type EditorStatus } from "@/game/editor/MapEditor";
import { ENV_PROPS, validateMapDef, type EnvProp, type DecorEntry } from "@/game/map/MapDefinition";
import { PropPalette } from "@/components/editor/PropPalette";
import { GamePanel, HUD, INK } from "@/components/hud/primitives";

/**
 * Secret, password-gated map editor (`/editor`, unlinked — like `/hudlab`).
 *
 * Gate: a centered card collects the password and POSTs `/api/editor/auth`. The
 * Three.js canvas only mounts after a 200 (the password is kept in React state,
 * in memory, and sent as `x-editor-password` on Save). The server re-checks the
 * password on every write, so the client gate is purely cosmetic.
 *
 * Layout: full-screen canvas (z-0) with a `pointer-events-none` overlay; only the
 * interactive controls re-enable pointer events. Left sidebar = tool toggle +
 * prop palette; top-right = Save / Undo / Redo / Lock; bottom-center = status bar.
 */

type Toast = { kind: "ok" | "err"; text: string } | null;

export default function Editor() {
  const [password, setPassword] = useState<string | null>(null);
  if (password === null) {
    return <PasswordGate onUnlock={setPassword} />;
  }
  return <EditorCanvas password={password} onLock={() => setPassword(null)} />;
}

/* ─────────────────────────── Password gate ─────────────────────────── */

function PasswordGate({ onUnlock }: { onUnlock: (pw: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy || value.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/editor/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: value }),
        });
        if (res.ok) {
          onUnlock(value);
        } else {
          setError("Senha incorreta.");
        }
      } catch {
        setError("Falha de conexão.");
      } finally {
        setBusy(false);
      }
    },
    [busy, value, onUnlock],
  );

  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: INK }}
    >
      <GamePanel accent={HUD.honey} radius={12}>
        <form onSubmit={submit} className="flex w-72 flex-col gap-4 p-7">
          <div className="flex items-center gap-2 text-white">
            <Lock className="h-5 w-5" strokeWidth={2.5} />
            <span className="hud-text text-[15px] font-bold">Editor de mapa</span>
          </div>
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Senha"
            className="rounded-md px-3 py-2 text-[14px] font-semibold text-white outline-none"
            style={{ background: "rgba(255,255,255,0.10)", border: `2px solid ${INK}` }}
          />
          {error && (
            <span className="text-[12px] font-bold" style={{ color: HUD.danger }}>
              {error}
            </span>
          )}
          <button
            type="submit"
            disabled={busy}
            className="hud-text flex items-center justify-center gap-2 rounded-md py-2 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ background: HUD.honey, border: `2px solid ${INK}` }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Desbloquear
          </button>
        </form>
      </GamePanel>
    </div>
  );
}

/* ─────────────────────────── Editor canvas ─────────────────────────── */

function EditorCanvas({ password, onLock }: { password: string; onLock: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MapEditor | null>(null);

  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<EditorTool>("place");
  const [selected, setSelected] = useState<EnvProp>(ENV_PROPS[0]);
  const [status, setStatus] = useState<EditorStatus>({ cell: null, valid: false });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // Refresh the undo/redo button enable-state from the engine.
  const syncHistory = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    setCanUndo(ed.canUndo());
    setCanRedo(ed.canRedo());
  }, []);

  // Boot the engine once: preload assets → GET the active map → mount MapEditor.
  useEffect(() => {
    let cancelled = false;
    let editor: MapEditor | null = null;

    (async () => {
      await ModelLibrary.preload();
      if (cancelled || !containerRef.current) return;

      // Load the saved map (empty on 404/invalid → start from a blank canvas).
      let initialDecor: DecorEntry[] = [];
      try {
        const res = await fetch("/api/map");
        if (res.ok) {
          const data = (await res.json()) as { def?: unknown };
          const valid = validateMapDef(data.def);
          if (valid) initialDecor = valid.decor;
        }
      } catch {
        /* offline / no server → blank canvas */
      }
      if (cancelled || !containerRef.current) return;

      editor = new MapEditor(containerRef.current, ENV_PROPS[0], initialDecor);
      editor.setStatusListener((s) => setStatus(s));
      editorRef.current = editor;
      setReady(true);
    })().catch((err) => {
      console.error("Failed to boot map editor", err);
    });

    return () => {
      cancelled = true;
      editor?.dispose();
      editorRef.current = null;
    };
  }, []);

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const ed = editorRef.current;
        if (!ed) return;
        if (e.shiftKey) ed.redo();
        else ed.undo();
        syncHistory();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [syncHistory]);

  // Auto-dismiss toasts.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const handleTool = useCallback((t: EditorTool) => {
    setTool(t);
    editorRef.current?.setTool(t);
  }, []);

  const handleSelect = useCallback((asset: EnvProp) => {
    setSelected(asset);
    editorRef.current?.setSelected(asset);
    // Selecting a prop implies Place mode.
    setTool("place");
    editorRef.current?.setTool("place");
  }, []);

  const handleUndo = useCallback(() => {
    editorRef.current?.undo();
    syncHistory();
  }, [syncHistory]);

  const handleRedo = useCallback(() => {
    editorRef.current?.redo();
    syncHistory();
  }, [syncHistory]);

  const handleSave = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || saving) return;
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/map", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-editor-password": password },
        body: JSON.stringify({ def: { version: 1, decor: ed.serialize() } }),
      });
      if (res.ok) setToast({ kind: "ok", text: "Mapa salvo!" });
      else if (res.status === 401) setToast({ kind: "err", text: "Senha rejeitada." });
      else setToast({ kind: "err", text: "Erro ao salvar (mapa inválido)." });
    } catch {
      setToast({ kind: "err", text: "Falha de conexão." });
    } finally {
      setSaving(false);
    }
  }, [password, saving]);

  // Re-sync undo/redo after every status change (covers click-driven mutations).
  useEffect(() => {
    syncHistory();
  }, [status, syncHistory]);

  const cellText = status.cell ? `[${status.cell.ix}, ${status.cell.iz}]` : "—";
  const hint =
    tool === "place"
      ? "Clique-esq: colocar · Clique-dir: arrastar · Roda: zoom"
      : "Clique-esq: remover · Clique-dir: arrastar · Roda: zoom";

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ background: "#bfe3ff" }}>
      {/* Full-screen Three.js canvas (z-0). */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Overlay — non-interactive except where re-enabled. */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* Left sidebar: tool toggle + prop palette. */}
        <div className="absolute left-4 top-4 w-[240px]">
          <GamePanel radius={10} className="pointer-events-auto p-3">
            <div className="mb-2 flex gap-1.5">
              <ToolButton
                active={tool === "place"}
                icon={<Hammer className="h-4 w-4" strokeWidth={2.5} />}
                label="Colocar"
                accent={HUD.success}
                onClick={() => handleTool("place")}
              />
              <ToolButton
                active={tool === "delete"}
                icon={<Eraser className="h-4 w-4" strokeWidth={2.5} />}
                label="Remover"
                accent={HUD.danger}
                onClick={() => handleTool("delete")}
              />
            </div>
            <PropPalette
              selected={selected}
              onSelect={handleSelect}
              disabled={tool === "delete"}
            />
          </GamePanel>
        </div>

        {/* Top-right: Save / Undo / Redo / Lock. */}
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <GamePanel radius={10} className="pointer-events-auto flex items-center gap-1 p-1">
            <IconBtn
              onClick={handleUndo}
              disabled={!canUndo}
              title="Desfazer (Ctrl+Z)"
              icon={<Undo2 className="h-4 w-4" strokeWidth={2.5} />}
            />
            <IconBtn
              onClick={handleRedo}
              disabled={!canRedo}
              title="Refazer (Ctrl+Shift+Z)"
              icon={<Redo2 className="h-4 w-4" strokeWidth={2.5} />}
            />
          </GamePanel>
          <GamePanel accent={HUD.honey} radius={10} className="pointer-events-auto">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="hud-text flex h-9 items-center gap-2 px-4 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              ) : (
                <Save className="h-4 w-4" strokeWidth={2.5} />
              )}
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </GamePanel>
          <GamePanel radius={10} className="pointer-events-auto">
            <button
              type="button"
              onClick={onLock}
              title="Bloquear"
              className="flex h-9 w-9 items-center justify-center text-white transition-opacity hover:opacity-80"
            >
              <LogOut className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </GamePanel>
        </div>

        {/* Toast (top-center). */}
        {toast && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2">
            <GamePanel accent={toast.kind === "ok" ? HUD.success : HUD.danger} radius={8}>
              <span className="hud-text block px-4 py-2 text-[13px] font-bold text-white">
                {toast.text}
              </span>
            </GamePanel>
          </div>
        )}

        {/* Bottom-center status bar. */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <GamePanel radius={999} className="flex items-center gap-3 px-4 py-1.5">
            <span className="hud-text text-[12px] font-bold" style={{ color: HUD.honey }}>
              {tool === "place" ? "Colocar" : "Remover"}
            </span>
            <span className="hud-text text-[12px] font-bold text-white">
              Célula {cellText}
            </span>
            <span className="hud-text text-[11px] font-semibold text-white/70">{hint}</span>
          </GamePanel>
        </div>
      </div>

      {/* Loading overlay until the engine is up. */}
      {!ready && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: INK }}
        >
          <div className="hud-text flex items-center gap-2.5 text-white">
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.25} />
            <span className="text-lg font-bold">Carregando editor…</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Small controls ─────────────────────────── */

function ToolButton({
  active,
  icon,
  label,
  accent,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hud-text flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-[12px] font-bold text-white transition-transform active:scale-95"
      style={{
        background: active ? accent : "rgba(255,255,255,0.12)",
        border: `2px solid ${INK}`,
        boxShadow: active ? `0 0 0 2px ${accent}` : "none",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function IconBtn({
  onClick,
  disabled,
  title,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-md text-white transition-opacity hover:bg-white/10 disabled:opacity-30"
    >
      {icon}
    </button>
  );
}
