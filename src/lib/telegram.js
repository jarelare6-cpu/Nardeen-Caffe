// ══════════════════════════════════════════════════════════════
// v27: تكامل تليجرام — إرسال صامت تلقائي لأحداث الإدارة
// ──────────────────────────────────────────────────────────────
// • الوجهات تُحفظ ضمن settings.telegramTargets (يُحفظ في Supabase)
// • كل وجهة: { id, name, token, chatId, events: {shift, daily, cancel, comp, debt, reset} }
// • الإرسال صامت تماماً: لا يرى الكاشير شيئاً، ولا إشعار فشل.
// • شبكة أمان: تقرير الوردية يُحفظ في جدول shifts قبل الإرسال (لا يضيع أبداً).
// ══════════════════════════════════════════════════════════════

// أنواع الأحداث القابلة للتوجيه
export const TELEGRAM_EVENTS = {
  shift:  "💰 تقرير الوردية",
  daily:  "📊 ملخص أرباح اليوم",
  cancel: "🔴 حذف / إلغاء طلب",
  comp:   "🎁 ضيافة كاملة",
  debt:   "💳 سداد دين",
  reset:  "🗑 تصفير بيانات",
};

// إرسال رسالة لوجهة واحدة عبر Telegram Bot API. صامت: لا يرمي استثناءً للأعلى.
const sendToTarget = async (token, chatId, text) => {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false; // فشل صامت — لا يؤثر على تجربة الكاشير
  }
};

// يرسل حدثاً لكل الوجهات المفعّلة لذلك الحدث. صامت بالكامل.
// targets: settings.telegramTargets — يُمرَّر من المُستدعي.
export const notifyTelegram = (targets, eventKey, text) => {
  if (!Array.isArray(targets) || !targets.length) return;
  // لا ننتظر النتيجة — إرسال خلفي صامت
  targets.forEach(tg => {
    if (tg && tg.token && tg.chatId && tg.events && tg.events[eventKey]) {
      sendToTarget(tg.token, tg.chatId, text).catch(() => {});
    }
  });
};

// اختبار وجهة (يُستخدم بزر "اختبار" في الإعدادات فقط — للأدمن)
export const testTelegramTarget = async (token, chatId) => {
  return sendToTarget(token, chatId, "✅ <b>اختبار ناجح</b>\nتم ربط ناردين كافيه بهذه الوجهة بنجاح.");
};

// ── تنسيق الرسائل ──────────────────────────────────────────────
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const now = () => new Date().toLocaleString("ar-SY", { dateStyle: "short", timeStyle: "short" });

export const buildShiftReport = (shift, cafeName, cur) => {
  const diff = shift.difference || 0;
  const diffLine = Math.abs(diff) < 1
    ? "✅ الصندوق مطابق تماماً"
    : diff > 0
    ? `⚠️ زيادة: ${fmt(diff)} ${cur}`
    : `🔴 عجز: ${fmt(Math.abs(diff))} ${cur}`;
  return [
    `💰 <b>تقرير إغلاق وردية — ${cafeName}</b>`,
    `الفرع: ${shift.branch === "outdoor" ? "🌳 الحديقة" : "☕ الكافيه"}`,
    `الكاشير: <b>${shift.userName || shift.openedByName || "—"}</b>`,
    `الإغلاق: ${now()}`,
    `━━━━━━━━━━━━━━`,
    `💵 نقدي: ${fmt(shift.cashSales)} ${cur}`,
    `💳 بطاقة: ${fmt(shift.cardSales)} ${cur}`,
    shift.tronSales ? `💠 ترون: ${fmt(shift.tronSales)} ${cur}` : null,
    `📊 إجمالي المبيعات: <b>${fmt(shift.totalSales)} ${cur}</b>`,
    `📤 المصاريف: ${fmt(shift.expensesTotal)} ${cur}`,
    shift.debtTotal ? `💳 ديون جديدة: ${fmt(shift.debtTotal)} ${cur}` : null,
    shift.compTotal ? `🎁 ضيافة: ${fmt(shift.compTotal)} ${cur}` : null,
    `🧾 عدد الطلبات: ${shift.ordersCount || 0}`,
    `━━━━━━━━━━━━━━`,
    `📦 المتوقع بالصندوق: ${fmt(shift.expectedCash)} ${cur}`,
    `✋ المعدود فعلياً: ${fmt(shift.countedCash)} ${cur}`,
    `<b>${diffLine}</b>`,
    shift.notes ? `📝 ملاحظات: ${shift.notes}` : null,
  ].filter(Boolean).join("\n");
};

export const buildDailySummary = (data, cafeName, cur) => {
  return [
    `📊 <b>ملخص اليوم — ${cafeName}</b>`,
    `التاريخ: ${new Date().toLocaleDateString("ar-SY")}`,
    `━━━━━━━━━━━━━━`,
    `📈 إجمالي المبيعات: <b>${fmt(data.revenue)} ${cur}</b>`,
    `💵 نقدي: ${fmt(data.cash)} ${cur}`,
    `💳 بطاقة: ${fmt(data.card)} ${cur}`,
    data.tron ? `💠 ترون: ${fmt(data.tron)} ${cur}` : null,
    `📤 المصاريف: ${fmt(data.expenses)} ${cur}`,
    data.debts ? `💳 ديون جديدة: ${fmt(data.debts)} ${cur}` : null,
    data.comp ? `🎁 ضيافة: ${fmt(data.comp)} ${cur}` : null,
    `💰 <b>صافي الربح: ${fmt(data.profit)} ${cur}</b>`,
    `🧾 عدد الطلبات: ${data.orders}`,
  ].filter(Boolean).join("\n");
};

export const buildEventMsg = (kind, info, cafeName, cur) => {
  const head = {
    cancel: "🔴 <b>إلغاء طلب</b>",
    comp:   "🎁 <b>ضيافة كاملة</b>",
    debt:   "💳 <b>سداد دين</b>",
    reset:  "🗑 <b>تصفير بيانات</b>",
  }[kind] || "🔔 <b>تنبيه</b>";
  return [
    `${head} — ${cafeName}`,
    info.orderNum ? `الطلب: #${info.orderNum}` : null,
    info.customerName ? `الزبون: ${info.customerName}` : null,
    info.amount != null ? `المبلغ: <b>${fmt(info.amount)} ${cur}</b>` : null,
    info.reason ? `السبب: ${info.reason}` : null,
    info.details ? `${info.details}` : null,
    `بواسطة: ${info.by || "—"}`,
    `⏰ ${now()}`,
  ].filter(Boolean).join("\n");
};
