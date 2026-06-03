// ثوابت وأدوات مساعدة مشتركة — مفصولة من App.jsx (تقسيم v9)

export const ROLES = {
  ADMIN:"admin", CASHIER:"cashier", BAR:"bar",
  HOOKAH:"hookah", WORKER:"worker", CUSTOMER:"customer", OUTDOOR:"outdoor"
};

export const ROLE_LABELS = {
  admin:"مدير", cashier:"كاشير", bar:"بار",
  hookah:"أراكيل", worker:"عامل طلبات", customer:"زبون", outdoor:"عامل حديقة"
};

export const ROLE_COLORS = {
  admin:"#c62828", cashier:"#1565c0", bar:"#6a1b9a",
  hookah:"#2e7d32", worker:"#e65100", customer:"#00695c"
};

export const ORDER_STATUS = {
  PENDING:"pending", PREPARING:"preparing",
  READY:"ready", PAID:"paid", CANCELLED:"cancelled", DEBT:"debt", COMPLIMENTARY:"complimentary"
};

export const STATUS_LABELS = {
  pending:"قيد الانتظار", preparing:"قيد التحضير",
  ready:"جاهز", paid:"مدفوع", cancelled:"ملغي", debt:"دين", complimentary:"ضيافة"
};

export const STATUS_COLORS = {
  pending:"#ff9800", preparing:"#1976d2",
  ready:"#2e7d32", paid:"#546e7a", cancelled:"#c62828", debt:"#6a1b9a", complimentary:"#00897b"
};

// Category labels

export const CAT_LABELS = {
  hot_drinks:"☕ مشروبات ساخنة",
  cold_drinks:"🧊 مشروبات باردة",
  food:"🍔 طعام",
  hookah:"💨 نرجيلة"
};

export const CAT_ORDER = ["hot_drinks","cold_drinks","food","hookah"];

// ── محطات التحضير: حالة منفصلة لكل صنف عبر علم prepared ──────────
// تحلّ المشكلتين 3 و4: كل محطة تُحضّر أصنافها فقط، والطلب يصبح
// "جاهزاً" كلياً فقط عند اكتمال كل أصناف المحطات (البار + النرجيلة).

export const BAR_CATS = ["hot_drinks","cold_drinks"];

export const HOOKAH_CATS = ["hookah"];

export const STATION_CATS = [...BAR_CATS, ...HOOKAH_CATS];

export const catOf = (menu, itemId) => menu.find(m => m.id === itemId)?.category;

export const orderFullyPrepared = (order, menu) =>
  (order.items || [])
    .filter(i => STATION_CATS.includes(catOf(menu, i.itemId)))
    .every(i => i.prepared);

// ── Phase 1: عرض صورة الصنف مع fallback للإيموجي ──────────────

export const PERMISSIONS = {
  dashboard:    ["admin","cashier"],
  order:        ["admin","cashier","worker"],
  orders:       ["admin","cashier","worker","bar","hookah"],
  cashier:      ["admin","cashier"],
  bar:          ["admin","bar"],
  hookah:       ["admin","hookah"],
  kds:          ["admin","bar","hookah","cashier"],
  shift:        ["admin","cashier"],
  menu:         ["admin"],
  tables:       ["admin","cashier"],
  staff:        ["admin"],
  reports:      ["admin"],
  debts:        ["admin","cashier"],
  expenses:     ["admin","cashier"],
  settings:     ["admin"],
  outdoor_admin:["admin"],
  receipts:     ["admin","cashier"],
  complog:      ["admin","cashier"],
  customers:    ["admin","cashier"],
  customer_home:["customer"],
  myorders:     ["customer"],
};


export const canAccess = (role, section) => (PERMISSIONS[section]||[]).includes(role);

// ═══════════════════════════════════
// PRINT WRAPPER
// ═══════════════════════════════════

export const THEMES = {
  default: { primary:"#c62828", secondary:"#1565c0", accent:"#f9a825" },
  green:   { primary:"#2e7d32", secondary:"#1b5e20", accent:"#66bb6a" },
  purple:  { primary:"#6a1b9a", secondary:"#4a148c", accent:"#ce93d8" },
  blue:    { primary:"#1565c0", secondary:"#0d47a1", accent:"#42a5f5" },
  gold:    { primary:"#f57f17", secondary:"#e65100", accent:"#ffd54f" },
  teal:    { primary:"#00897b", secondary:"#00695c", accent:"#80cbc4" },
  dark:    { primary:"#c62828", secondary:"#1565c0", accent:"#f9a825" },
};

