"use client";

import { useState, useEffect } from "react";
import { Card, Toggle } from "@/shared/components";

/**
 * Provider-level settings: auto-clean, auto-fix
 */
export default function ProviderSettings({ providerId }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [providerId]);

  async function loadSettings() {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }

  async function updateSetting(key, value) {
    setSaving(true);
    try {
      const payload = {
        [key]: {
          ...(settings?.[key] || {}),
          [providerId]: value
        }
      };

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Failed to update settings");

      const updated = await res.json();
      setSettings(updated);
    } catch (err) {
      console.error("Failed to update setting:", err);
      alert(`Failed to update setting: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function updateGlobalSetting(key, value) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value })
      });
      if (!res.ok) throw new Error("Failed to update settings");
      const updated = await res.json();
      setSettings(updated);
    } catch (err) {
      console.error("Failed to update setting:", err);
      alert(`Failed to update setting: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  const autoCleanEnabled = settings?.providerAutoClean?.[providerId] || false;
  const autoCleanAction = settings?.providerAutoCleanAction?.[providerId] || "delete";
  const autoFixEnabled = settings?.providerAutoFix?.[providerId] || false;
  const removeTokenLimitsEnabled = settings?.providerRemoveTokenLimits?.[providerId] || false;
  const maxAutoContinue = settings?.maxAutoContinue ?? 20;

  return (
    <Card className="mb-6">
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4">Provider Settings</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto-clean Zero Credit</div>
              <div className="text-sm text-text-muted">
                Automatically handle connections when balance reaches $0 or quota is exhausted
              </div>
            </div>
            <Toggle
              checked={autoCleanEnabled}
              onChange={(checked) => updateSetting("providerAutoClean", checked)}
              disabled={saving}
            />
          </div>

          {autoCleanEnabled && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-sky-500/30">
              <div>
                <div className="font-medium">Clean Action</div>
                <div className="text-sm text-text-muted">
                  What to do with empty credit connections
                </div>
              </div>
              <select
                value={autoCleanAction}
                onChange={(e) => updateSetting("providerAutoCleanAction", e.target.value)}
                disabled={saving}
                className="bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
              >
                <option value="disable">Disable</option>
                <option value="delete">Delete</option>
              </select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto-fix Errors</div>
              <div className="text-sm text-text-muted">
                Immediately disable broken keys (auth/quota errors) and retry transient errors (rate limits, timeouts)
              </div>
            </div>
            <Toggle
              checked={autoFixEnabled}
              onChange={(checked) => updateSetting("providerAutoFix", checked)}
              disabled={saving}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Remove Token Limits</div>
              <div className="text-sm text-text-muted">
                Bypass output token caps so models can finish long tasks without cutting off early
              </div>
            </div>
            <Toggle
              checked={removeTokenLimitsEnabled}
              onChange={(checked) => updateSetting("providerRemoveTokenLimits", checked)}
              disabled={saving}
            />
          </div>

          {removeTokenLimitsEnabled && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-sky-500/30">
              <div>
                <div className="font-medium">Max Auto-Continue</div>
                <div className="text-sm text-text-muted">
                  How many times to auto-continue when output is truncated
                </div>
              </div>
              <select
                value={maxAutoContinue}
                onChange={(e) => updateGlobalSetting("maxAutoContinue", Number(e.target.value))}
                disabled={saving}
                className="bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
              >
                {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((n) => (
                  <option key={n} value={n}>{n}x</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {saving && (
          <div className="mt-3 text-sm text-text-muted">Saving...</div>
        )}
      </div>
    </Card>
  );
}
