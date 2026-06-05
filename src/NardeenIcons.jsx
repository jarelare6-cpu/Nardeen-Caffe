// ═══════════════════════════════════════════════
//  NARDEEN ICONS — أيقونات ناردين كافيه
//  الهوية البصرية: أحمر #8B0E1A · ذهبي #D4A017
// ═══════════════════════════════════════════════
import React from "react";

// مكوّن أيقونة SVG عام
export function NIcon({ d, size = 24, color = "currentColor", ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {d}
    </svg>
  );
}

// ── شعار ناردين (نرجيلة + قهوة) ──────────────────────────────
export function NardeenLogoIcon({ size = 80, gold = "#D4A017", glow = false }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      {glow && (
        <defs>
          <filter id="glow-logo">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <g filter={glow ? "url(#glow-logo)" : undefined}>
        {/* كوب القهوة */}
        <ellipse cx="38" cy="64" rx="18" ry="11" fill="none" stroke={gold} strokeWidth="2.5" />
        <path d="M22 64 Q28 55 38 55 Q48 55 54 64" fill="none" stroke={gold} strokeWidth="2" />
        <path d="M54 62 Q60 62 60 57 Q60 52 54 52" fill="none" stroke={gold} strokeWidth="2" />
        {/* بخار */}
        <path d="M32 50 Q30 44 33 38" fill="none" stroke={gold} strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
        <path d="M38 48 Q36 42 39 36" fill="none" stroke={gold} strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
        <path d="M44 50 Q42 44 45 38" fill="none" stroke={gold} strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
        {/* نرجيلة صغيرة */}
        <ellipse cx="72" cy="72" rx="8" ry="5" fill="none" stroke={gold} strokeWidth="2" />
        <line x1="72" y1="67" x2="72" y2="55" stroke={gold} strokeWidth="2" />
        <ellipse cx="72" cy="52" rx="5" ry="4" fill="none" stroke={gold} strokeWidth="2" />
        <path d="M72 48 Q74 42 78 38 Q74 37 72 40 Q70 42 72 48" fill="none" stroke={gold} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M64 72 Q60 72 59 75 Q58 78 60 80" fill="none" stroke={gold} strokeWidth="2" />
        <circle cx="60" cy="80" r="2" fill={gold} />
      </g>
    </svg>
  );
}

// ── أيقونة الزبون ─────────────────────────────────────────────
export function CustomerIcon({ size = 52 }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cust-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#D4A017" />
          <stop offset="100%" stopColor="#b8860b" />
        </linearGradient>
      </defs>
      <circle cx="22" cy="16" r="8" fill="url(#cust-grad)" />
      <path d="M6 42 Q6 28 22 28 Q38 28 38 42" fill="url(#cust-grad)" />
      {/* كوب قهوة صغير */}
      <rect x="40" y="28" width="14" height="10" rx="3" fill="#8B0E1A" />
      <path d="M54 32 Q57 32 57 30 Q57 28 54 28" fill="none" stroke="#D4A017" strokeWidth="1.5" />
      <line x1="43" y1="31" x2="51" y2="31" stroke="#D4A017" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="43" y1="34" x2="51" y2="34" stroke="#D4A017" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="44" y1="38" x2="50" y2="38" stroke="rgba(212,160,23,0.5)" strokeWidth="1" />
    </svg>
  );
}

// ── أيقونة الموظف ─────────────────────────────────────────────
export function StaffIcon({ size = 52 }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="staff-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c62828" />
          <stop offset="100%" stopColor="#8B0E1A" />
        </linearGradient>
      </defs>
      <circle cx="30" cy="14" r="9" fill="#D4A017" />
      <path d="M12 48 Q12 32 30 32 Q48 32 48 48" fill="url(#staff-grad)" />
      {/* مريلة */}
      <path d="M22 36 L24 48 L36 48 L38 36 Q34 40 30 40 Q26 40 22 36Z" fill="rgba(255,255,255,0.15)" />
      <rect x="26" y="30" width="8" height="5" rx="1.5" fill="rgba(255,255,255,0.2)" />
    </svg>
  );
}

// ── أيقونات التنقل (شريط سفلي) ─────────────────────────────────
export function IconDashboard({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function IconOrderNew({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

export function IconOrders({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

export function IconCashier({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="13" rx="2" />
      <path d="M2 11h20" />
      <rect x="6" y="15" width="2" height="2" rx="0.5" />
      <rect x="11" y="15" width="2" height="2" rx="0.5" />
      <rect x="16" y="15" width="2" height="2" rx="0.5" />
      <path d="M8 7V5a2 2 0 1 1 4 0v2" />
    </svg>
  );
}

export function IconCustomers({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconGift({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12" />
      <rect x="2" y="7" width="20" height="5" rx="1" />
      <line x1="12" y1="22" x2="12" y2="7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
    </svg>
  );
}

export function IconDebts({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <circle cx="12" cy="16" r="2" />
    </svg>
  );
}

export function IconExpenses({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

export function IconBar({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2h8l1.5 4H6.5L8 2z" />
      <path d="M7 6 Q6 13 8 17 Q10 21 12 21 Q14 21 16 17 Q18 13 17 6" />
      <line x1="9" y1="11" x2="15" y2="11" />
      <path d="M16 9 Q19 9 19 7" strokeLinecap="round" />
    </svg>
  );
}

export function IconHookah({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="17" rx="5" ry="3" />
      <line x1="12" y1="14" x2="12" y2="9" />
      <ellipse cx="12" cy="8" rx="3.5" ry="2.5" />
      <path d="M12 5.5 Q13 3 15 2 Q12.5 1.5 11 3 Q11.5 4 12 5.5" strokeLinecap="round" />
      <path d="M7 17 Q4 17 3.5 20" strokeLinecap="round" />
      <circle cx="3.5" cy="21" r="1" fill={color} />
    </svg>
  );
}

export function IconKDS({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="16" x2="12" y2="21" />
      <path d="M7 9 L9 11 L13 7" />
      <line x1="15" y1="9" x2="18" y2="9" />
      <line x1="15" y1="12" x2="17" y2="12" />
    </svg>
  );
}

export function IconMenu({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2 Q3 8 5 9 Q7 10 9 9 Q11 8 11 2" />
      <line x1="7" y1="9" x2="7" y2="22" />
      <path d="M13 2 Q13 6 15 8 L15 22" />
      <path d="M13 7 Q14.5 7.5 15 7" />
      <path d="M19 4 Q21 6 21 9 Q21 13 18 15 Q20 18 20 22" />
    </svg>
  );
}

export function IconTables({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <line x1="7" y1="12" x2="7" y2="19" />
      <line x1="17" y1="12" x2="17" y2="19" />
      <path d="M5 6 Q12 4 19 6" />
      <line x1="5" y1="19" x2="9" y2="19" />
      <line x1="15" y1="19" x2="19" y2="19" />
    </svg>
  );
}

export function IconShift({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1.5" fill={color} />
    </svg>
  );
}

export function IconStaff({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function IconReports({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

export function IconReceipts({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2 L20 2 L20 22 L16 19 L12 22 L8 19 L4 22 Z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  );
}

export function IconSettings({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconOutdoor({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 C12 2 7 9 7 14 C7 17.3 9.2 20 12 20 C14.8 20 17 17.3 17 14 C17 9 12 2 12 2Z" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

export function IconQR({ size = 22, color = "currentColor" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="5" y="5" width="3" height="3" fill={color} stroke="none" />
      <rect x="16" y="5" width="3" height="3" fill={color} stroke="none" />
      <rect x="5" y="16" width="3" height="3" fill={color} stroke="none" />
      <line x1="14" y1="14" x2="14" y2="17" />
      <line x1="14" y1="20" x2="14" y2="21" />
      <line x1="17" y1="14" x2="21" y2="14" />
      <line x1="21" y1="17" x2="21" y2="21" />
      <line x1="17" y1="21" x2="21" y2="21" />
      <line x1="17" y1="17" x2="17" y2="17" strokeLinecap="round" />
    </svg>
  );
}

// ── خريطة الأيقونات للتنقل ─────────────────────────────────────
export const NAV_ICONS = {
  dashboard:     (s,c) => <IconDashboard size={s} color={c} />,
  order:         (s,c) => <IconOrderNew size={s} color={c} />,
  orders:        (s,c) => <IconOrders size={s} color={c} />,
  cashier:       (s,c) => <IconCashier size={s} color={c} />,
  customers:     (s,c) => <IconCustomers size={s} color={c} />,
  complog:       (s,c) => <IconGift size={s} color={c} />,
  debts:         (s,c) => <IconDebts size={s} color={c} />,
  expenses:      (s,c) => <IconExpenses size={s} color={c} />,
  bar:           (s,c) => <IconBar size={s} color={c} />,
  hookah:        (s,c) => <IconHookah size={s} color={c} />,
  kds:           (s,c) => <IconKDS size={s} color={c} />,
  menu:          (s,c) => <IconMenu size={s} color={c} />,
  tables:        (s,c) => <IconTables size={s} color={c} />,
  shift:         (s,c) => <IconShift size={s} color={c} />,
  staff:         (s,c) => <IconStaff size={s} color={c} />,
  reports:       (s,c) => <IconReports size={s} color={c} />,
  receipts:      (s,c) => <IconReceipts size={s} color={c} />,
  settings:      (s,c) => <IconSettings size={s} color={c} />,
  outdoor_admin: (s,c) => <IconOutdoor size={s} color={c} />,
};

