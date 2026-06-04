-- ════════════════════════════════════════════════════════════
-- جدول نبض الأجهزة (heartbeat) للمراقبة عن بُعد
-- شغّل هذا مرة واحدة في Supabase ← SQL Editor
-- ════════════════════════════════════════════════════════════

create table if not exists device_status (
  id        text primary key,
  label     text,
  role      text,
  last_seen timestamptz default now(),
  online    boolean default true
);

alter table device_status enable row level security;

drop policy if exists device_status_open on device_status;
create policy device_status_open on device_status
  for all using (true) with check (true);

-- اختياري: تفعيل التحديث اللحظي (التطبيق يحدّث كل 30 ثانية بدونه أيضًا)
-- alter publication supabase_realtime add table device_status;
