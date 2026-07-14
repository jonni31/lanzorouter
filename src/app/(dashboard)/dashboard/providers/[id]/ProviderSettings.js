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
  const maxFallbackAttempts = settings?.providerHealthMaxFallbackAttempts?.[providerId] ?? 5;
  const quotaCooldownMinutes = settings?.providerHealthQuotaCooldownMinutes?.[providerId] ?? 30;
  const quotaCooldownEnabled = settings?.providerHealthQuotaCooldownEnabled?.[providerId] || false;
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
              <div className="font-medium">Max Fallback Attempts</div>
              <div className="text-sm text-text-muted">
                Maximum accounts to try per request before returning the last error
              </div>
            </div>
            <select
              value={maxFallbackAttempts}
              onChange={(e) => updateSetting("providerHealthMaxFallbackAttempts", Number(e.target.value))}
              disabled={saving}
              className="bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
            >
              {[3, 5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>{n} accounts</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Quota Cooldown</div>
              <div className="text-sm text-text-muted">
                Rest a rate-limited / quota-exhausted account for a fixed time, then auto-retry. When off, uses exponential backoff (max 5 min).
              </div>
            </div>
            <Toggle
              checked={quotaCooldownEnabled}
              onChange={(checked) => updateSetting("providerHealthQuotaCooldownEnabled", checked)}
              disabled={saving}
            />
          </div>

          {quotaCooldownEnabled && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-sky-500/30">
              <div>
                <div className="font-medium">Cooldown Duration</div>
                <div className="text-sm text-text-muted">
                  How long to rest the account before trying it again
                </div>
              </div>
              <select
                value={quotaCooldownMinutes}
                onChange={(e) => updateSetting("providerHealthQuotaCooldownMinutes", Number(e.target.value))}
                disabled={saving}
                className="bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm"
              >
                {[
                  { m: 3, label: "3 minutes" },
                  { m: 5, label: "5 minutes" },
                  { m: 15, label: "15 minutes" },
                  { m: 60, label: "1 hour" },
                  { m: 300, label: "5 hours" },
                  { m: 1440, label: "24 hours" },
                  { m: 4320, label: "3 days" },
                  { m: 7200, label: "5 days" },
                  { m: 10080, label: "7 days" },
                  { m: 20160, label: "14 days" },
                  { m: 43200, label: "30 days" },
                ].map(({ m, label }) => (
                  <option key={m} value={m}>{label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto-fix Errors</div>
              <div className="text-sm text-text-muted">
                Automatically fix and retry transient errors (rate limits, timeouts, server errors). Does not handle exhausted credits — enable Auto-clean for that.
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
