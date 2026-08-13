// src/lib/aggregates.js — v43
// ══════════════════════════════════════════════════════════════════════
// نهاية «البتر الصامت».
//
// المشكلة: التطبيق يجلب آخر 500 طلب فقط، ثم تحسب اللوحة عليها وتكتب
// «كل الوقت». كافيه يبيع 60 طلباً يومياً يستنفدها في ثمانية أيام — فالرقم
// المعروض كإجمالي المشروع هو إجمالي أسبوع ونصف. والأرشفة (90 يوماً)
// تزيد النقص. لا خطأ ولا تحذير — الرقم يبدو سليماً وهو ناقص.
//
// المبدأ الحاكم هنا: **رقم صحيح، أو رقم موسوم بأنه جزئي. لا رقم كاذب.**
// كل نتيجة تحمل `exact: true|false`. حين تتعذّر التجميعات (قبل هجرة v43
// أو دون اتصال) نرتدّ للحساب المحلي و`exact:false`، وتعرض الواجهة عندها
// «≈» وتوضيحاً بأن الرقم يشمل الطلبات المحمّلة فقط.
// ══════════════════════════════════════════════════════════════════════

import { supabase, SUPABASE_READY } from "./supabase.js";
import { orderSale, orderTron, orderCogs } from "./utils.js";

const rpc = async (fn, args) => {
  if (!SUPABASE_READY || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return null;          // دالة غير منشأة أو خطأ ⇒ ارتداد صامت للحساب المحلي
    return data;
  } catch { return null; }
};

const iso = (d) => (d ? new Date(d).toISOString() : null);

// ── الحساب المحلي (ارتداد) — دقيق ضمن المحمَّل فقط ─────────────────────
export const localSalesTotals = (orders, { from, to, branch } = {}) => {
  const f = from ? new Date(from).getTime() : -Infinity;
  const t = to ? new Date(to).getTime() : Infinity;
  const list = (orders || []).filter(o => {
    if (branch && (o.branch || "main") !== branch) return false;
    const ts = new Date(o.paidAt || o.createdAt).getTime();
    return ts >= f && ts < t;
  });
  const paid = list.filter(o => o.status === "paid" && !o.isComplimentary);
  const sum = (a, fn) => a.reduce((s, o) => s + fn(o), 0);
  return {
    exact: false,
    ordersCount: paid.length,
    revenue:    sum(paid, orderSale),
    cashSales:  sum(paid.filter(o => o.paymentType === "cash"), orderSale),
    cardSales:  sum(paid.filter(o => o.paymentType === "card"), orderSale),
    tronTotal:  sum(paid, orderTron),
    compTotal:  list.reduce((s, o) => s + (o.compAmount || 0), 0),
    debtTotal:  sum(list.filter(o => o.status === "debt"), o => o.total || 0),
  };
};

// ── الإجماليات من الخادم (تشمل الأرشيف) ────────────────────────────────
export const fetchSalesTotals = async (orders, { from, to, branch } = {}) => {
  const data = await rpc("sales_totals", { p_from: iso(from), p_to: iso(to), p_branch: branch || null });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return localSalesTotals(orders, { from, to, branch });
  return {
    exact: true,
    ordersCount: +row.orders_count || 0,
    revenue:     +row.revenue     || 0,
    cashSales:   +row.cash_sales  || 0,
    cardSales:   +row.card_sales  || 0,
    tronTotal:   +row.tron_total  || 0,
    compTotal:   +row.comp_total  || 0,
    debtTotal:   +row.debt_total  || 0,
    firstOrderAt: row.first_order_at || null,
    lastOrderAt:  row.last_order_at  || null,
  };
};

export const fetchCogs = async (orders, menu, { from, to } = {}) => {
  const data = await rpc("cogs_total", { p_from: iso(from), p_to: iso(to) });
  if (data == null) {
    const f = from ? new Date(from).getTime() : -Infinity;
    const t = to ? new Date(to).getTime() : Infinity;
    const paid = (orders || []).filter(o => {
      if (o.status !== "paid") return false;
      const ts = new Date(o.paidAt || o.createdAt).getTime();
      return ts >= f && ts < t;
    });
    return { exact: false, cogs: paid.reduce((s, o) => s + orderCogs(o, menu), 0) };
  }
  return { exact: true, cogs: +data || 0 };
};

export const fetchExpenseTotals = async (expenses, { from, to } = {}) => {
  const data = await rpc("expenses_totals", { p_from: iso(from), p_to: iso(to) });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    const f = from ? new Date(from).getTime() : -Infinity;
    const t = to ? new Date(to).getTime() : Infinity;
    const list = (expenses || []).filter(e => {
      const ts = new Date(e.date).getTime();
      return ts >= f && ts < t;
    });
    return {
      exact: false,
      primary:   list.filter(e => !e.isSecondary && !e.isComplimentary).reduce((s, e) => s + (e.amount || 0), 0),
      secondary: list.filter(e => e.isSecondary).reduce((s, e) => s + (e.amount || 0), 0),
    };
  }
  return { exact: true, primary: +row.primary_total || 0, secondary: +row.secondary_total || 0 };
};

// ── أداء الموظفين — من الورديات المُقفلة (السجل المحاسبي الثابت) ────────
export const fetchStaffPerformance = async (shifts, { from, to } = {}) => {
  const data = await rpc("staff_performance", { p_from: iso(from), p_to: iso(to) });
  if (Array.isArray(data) && data.length) {
    return {
      exact: true,
      rows: data.map(r => ({
        userName:      r.user_name || "غير محدد",
        shiftsCount:   +r.shifts_count   || 0,
        ordersCount:   +r.orders_count   || 0,
        totalSales:    +r.total_sales    || 0,
        cashSales:     +r.cash_sales     || 0,
        tronSales:     +r.tron_sales     || 0,
        compTotal:     +r.comp_total     || 0,
        debtTotal:     +r.debt_total     || 0,
        expensesTotal: +r.expenses_total || 0,
        varianceSum:   +r.variance_sum   || 0,
        varianceAbs:   +r.variance_abs   || 0,
        worstVariance: +r.worst_variance || 0,
      })),
    };
  }
  return { exact: false, rows: localStaffPerformance(shifts, { from, to }) };
};

export const localStaffPerformance = (shifts, { from, to } = {}) => {
  const f = from ? new Date(from).getTime() : -Infinity;
  const t = to ? new Date(to).getTime() : Infinity;
  const map = new Map();
  (shifts || []).forEach(s => {
    if (s.status !== "closed" || !s.closedAt) return;
    const ts = new Date(s.closedAt).getTime();
    if (!(ts >= f && ts < t)) return;
    const k = s.userName || "غير محدد";
    const a = map.get(k) || {
      userName: k, shiftsCount: 0, ordersCount: 0, totalSales: 0, cashSales: 0,
      tronSales: 0, compTotal: 0, debtTotal: 0, expensesTotal: 0,
      varianceSum: 0, varianceAbs: 0, worstVariance: 0,
    };
    const n = (v) => +v || 0;
    a.shiftsCount++;
    a.ordersCount   += n(s.ordersCount);
    a.totalSales    += n(s.totalSales);
    a.cashSales     += n(s.cashSales);
    a.tronSales     += n(s.tronSales);
    a.compTotal     += n(s.compTotal);
    a.debtTotal     += n(s.debtTotal);
    a.expensesTotal += n(s.expensesTotal);
    a.varianceSum   += n(s.difference);
    a.varianceAbs   += Math.abs(n(s.difference));
    a.worstVariance  = Math.min(a.worstVariance, n(s.difference));
    map.set(k, a);
  });
  return Array.from(map.values()).sort((a, b) => b.totalSales - a.totalSales);
};

// وسم يوضَع بجانب أي رقم غير مؤكَّد — لا نعرض رقماً جزئياً كأنه كامل
export const approxMark = (exact) => (exact ? "" : "≈ ");
export const approxNote  = (exact) =>
  exact ? "" : "رقم تقريبي — يشمل الطلبات المحمَّلة فقط (نفّذ هجرة v43 للحصول على الإجمالي الكامل)";
