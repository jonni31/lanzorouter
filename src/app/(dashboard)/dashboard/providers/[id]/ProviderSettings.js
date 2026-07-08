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

  if (loading) return null;

  const autoCleanEnabled = settings?.providerAutoClean?.[providerId] || false;
  const autoFixEnabled = settings?.providerAutoFix?.[providerId] || false;

  return (
    <Card className="mb-6">
      <div className="p-4">
        <h3 className="text-lg font-semibold mb-4">Provider Settings</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto-clean Zero Credit</div>
              <div className="text-sm text-text-muted">
                Automatically delete connections when balance reaches $0 or quota is exhausted
              </div>
            </div>
            <Toggle
              checked={autoCleanEnabled}
              onChange={(checked) => updateSetting("providerAutoClean", checked)}
              disabled={saving}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto-fix Errors</div>
              <div className="text-sm text-text-muted">
                Automatically retry with fixes for known error patterns (rate limits, token refresh, etc.)
              </div>
            </div>
            <Toggle
              checked={autoFixEnabled}
              onChange={(checked) => updateSetting("providerAutoFix", checked)}
              disabled={saving}
            />
          </div>
        </div>

        {saving && (
          <div className="mt-3 text-sm text-text-muted">Saving...</div>
        )}
      </div>
    </Card>
  );
}
