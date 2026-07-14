"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, Button, Input, Toggle, Badge, ConfirmModal } from "@/shared/components";

function bytesLabel(str) {
  const n = new TextEncoder().encode(str || "").length;
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export default function ContextPage() {
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // {id?, name, content, enabled}
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, fRes] = await Promise.all([
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/context", { cache: "no-store" }),
      ]);
      const s = await sRes.json();
      const f = await fRes.json();
      setGlobalEnabled(!!s.contextInjectionEnabled);
      setFiles(Array.isArray(f.files) ? f.files : []);
    } catch (err) {
      setStatus({ type: "error", message: "Failed to load context files." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleGlobal = async (val) => {
    setGlobalEnabled(val);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextInjectionEnabled: val }),
      });
    } catch {
      setGlobalEnabled(!val);
      setStatus({ type: "error", message: "Failed to update global toggle." });
    }
  };

  const saveEditing = async () => {
    if (!editing?.name?.trim()) {
      setStatus({ type: "error", message: "Name is required." });
      return;
    }
    setSaving(true);
    try {
      if (editing.id) {
        await fetch(`/api/context/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editing.name, content: editing.content }),
        });
      } else {
        await fetch("/api/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editing.name, content: editing.content, priority: files.length }),
        });
      }
      setEditing(null);
      await load();
      setStatus({ type: "success", message: "Saved." });
    } catch {
      setStatus({ type: "error", message: "Failed to save." });
    } finally {
      setSaving(false);
    }
  };

  const toggleFile = async (file, val) => {
    setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, enabled: val } : f)));
    try {
      await fetch(`/api/context/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: val }),
      });
    } catch {
      await load();
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/context/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } catch {
      setStatus({ type: "error", message: "Failed to delete." });
    }
  };

  const handleUpload = async (e) => {
    const fileList = Array.from(e.target.files || []);
    if (fileList.length === 0) return;
    setUploading(true);
    setStatus({ type: "", message: "" });
    try {
      const files = await Promise.all(
        fileList.map(async (f) => ({ name: f.name, content: await f.text() }))
      );
      const res = await fetch("/api/context/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      await load();
      setStatus({ type: "success", message: `Uploaded ${data.created} file(s) — all disabled by default. Enable the ones you want below.` });
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Upload failed." });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const enabledCount = files.filter((f) => f.enabled).length;
  const totalBytes = files.filter((f) => f.enabled).reduce((n, f) => n + new TextEncoder().encode(f.content || "").length, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card padding="md">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-main">Context Injection</h1>
            <p className="text-xs text-text-muted mt-1 max-w-xl">
              Prepend your own context files (soul.md, agent.md, rules…) to the system prompt of every chat request routed through ZevaiRouter. Enabled files are injected in order, across all providers.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm text-text-muted">{globalEnabled ? "On" : "Off"}</span>
            <Toggle checked={globalEnabled} onChange={toggleGlobal} />
          </div>
        </div>
        {globalEnabled && (
          <p className="text-[11px] text-text-muted mt-3">
            {enabledCount} file(s) active · ~{(totalBytes / 1024).toFixed(1)} KB added to every request
          </p>
        )}
      </Card>

      {status.message && (
        <div className={`text-xs px-3 py-2 rounded ${status.type === "error" ? "text-red-500 bg-red-500/10" : "text-green-600 bg-green-500/10"}`}>
          {status.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-main">Files</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <span className="material-symbols-outlined text-[16px] mr-1">upload_file</span>
            {uploading ? "Uploading…" : "Upload .md"}
          </Button>
          <Button size="sm" onClick={() => setEditing({ name: "", content: "", enabled: true })}>
            <span className="material-symbols-outlined text-[16px] mr-1">add</span>
            Add File
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-text-muted">Loading…</div>
      ) : files.length === 0 ? (
        <Card padding="md">
          <p className="text-sm text-text-muted">No context files yet. Click <b>Add File</b> to create one (e.g. <code>soul.md</code>).</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div key={file.id} className="flex items-start gap-3 p-4 rounded-[14px] border border-border-subtle bg-surface">
              <div className="size-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[18px]">description</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-sm text-text-main">{file.name}</h3>
                  <Badge variant="default" size="sm">{bytesLabel(file.content)}</Badge>
                  {!file.enabled && <Badge variant="default" size="sm">disabled</Badge>}
                </div>
                <p className="text-xs text-text-muted mt-0.5 line-clamp-2 whitespace-pre-wrap">
                  {file.content?.slice(0, 160) || "(empty)"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Toggle checked={file.enabled} onChange={(v) => toggleFile(file, v)} size="sm" />
                <button onClick={() => setEditing({ ...file })} className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5" title="Edit">
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
                <button onClick={() => setDeleteTarget(file)} className="p-1.5 rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-500" title="Delete">
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative w-full max-w-2xl bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
              <h2 className="text-base font-semibold text-text-main">{editing.id ? "Edit File" : "New Context File"}</h2>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="soul.md"
                  value={editing.name}
                  onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Content (markdown / plain text)</label>
                <textarea
                  className="w-full mt-1 rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-text-main min-h-[280px] resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="You are a helpful assistant with the following persona…"
                  value={editing.content}
                  onChange={(e) => setEditing((p) => ({ ...p, content: e.target.value }))}
                />
                <p className="text-[11px] text-text-muted mt-1">{bytesLabel(editing.content)} · injected into the system prompt</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-3 border-t border-black/5 dark:border-white/5">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
              <Button size="sm" onClick={saveEditing} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete context file?"
        message={`"${deleteTarget?.name}" will be permanently removed.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={doDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
