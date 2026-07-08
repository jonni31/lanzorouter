"use client";

import { cn } from "@/shared/utils/cn";
import { formatResetTime } from "./utils";

// Calculate color based on remaining percentage
const getColorClasses = (remainingPercentage) => {
  if (remainingPercentage > 70) {
    return {
      text: "text-green-500",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
      emoji: "🟢"
    };
  }
  
  if (remainingPercentage >= 30) {
    return {
      text: "text-yellow-500",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      emoji: "🟡"
    };
  }
  
  // 0-29% including 0% (out of quota) - show red
  return {
    text: "text-red-500",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
    emoji: "🔴"
  };
};

// Format reset time display
const formatResetTimeDisplay = (resetTime) => {
  if (!resetTime) return null;
  
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    
    const timeStr = resetDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    
    return resetDate.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
};

// Format a number as currency or with appropriate unit
const formatBalance = (value, currency, unit) => {
  if (currency) {
    const sym = { USD: "$", EUR: "€", GBP: "£", CNY: "¥", JPY: "¥" }[currency.toUpperCase()] || `${currency} `;
    return `${sym}${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (unit) {
    return `${Number(value).toLocaleString()} ${unit}`;
  }
  return Number(value).toLocaleString();
};

export default function QuotaProgressBar({
  percentage = 0,
  label = "",
  used = 0,
  total = 0,
  unlimited = false,
  resetTime = null,
  remaining: remainingBalance,
  currency,
  unit,
}) {
  const colors = getColorClasses(percentage);
  const countdown = formatResetTime(resetTime);
  const resetDisplay = formatResetTimeDisplay(resetTime);
  
  // percentage is already remaining percentage (from ProviderLimitCard)
  const remaining = percentage;

  // Determine if this is a balance-type quota (has currency or remaining balance with unlimited/zero total)
  const isBalanceType = currency || (unlimited && remainingBalance !== undefined && remainingBalance !== null);
  
  return (
    <div className="space-y-2">
      {/* Label and percentage */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-text-primary">
          {label}
        </span>
        {!isBalanceType && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{colors.emoji}</span>
            <span className={cn("font-medium", colors.text)}>
              {remaining}%
            </span>
          </div>
        )}
      </div>

      {/* Balance display for credit/balance type quotas */}
      {isBalanceType && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5">
            <span className="material-symbols-outlined text-[18px] text-sky-500">
              account_balance_wallet
            </span>
            <span className="text-lg font-semibold text-text-primary">
              {formatBalance(remainingBalance ?? (total - used), currency, unit)}
            </span>
            <span className="text-xs text-text-muted">remaining</span>
          </div>
          {used > 0 && (
            <span className="text-xs text-text-muted">
              ({formatBalance(used, currency, unit)} used)
            </span>
          )}
        </div>
      )}

      {/* Progress bar (only for non-balance, non-unlimited quotas) */}
      {!unlimited && !isBalanceType && (
        <div className={cn("h-2 rounded-full overflow-hidden", colors.bgLight)}>
          <div
            className={cn("h-full transition-all duration-300", colors.bg)}
            style={{ width: `${Math.min(remaining, 100)}%` }}
          />
        </div>
      )}

      {/* Usage details and countdown (only for request-based quotas) */}
      {!isBalanceType && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            {used.toLocaleString()} / {total.toLocaleString()} requests
          </span>
          {countdown !== "-" && (
            <div className="flex items-center gap-1">
              <span>•</span>
              <span className="font-medium">Reset in {countdown}</span>
            </div>
          )}
        </div>
      )}

      {/* Reset countdown for balance type */}
      {isBalanceType && countdown !== "-" && (
        <div className="text-xs text-text-muted">
          Reset in {countdown}
        </div>
      )}

      {/* Reset time display */}
      {resetDisplay && (
        <div className="text-xs text-text-muted/70">
          Reset at {resetDisplay}
        </div>
      )}
    </div>
  );
}
