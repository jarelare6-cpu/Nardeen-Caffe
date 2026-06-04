-- 023: حفظ صورة الأيقونة وسعر التكلفة سحابيًا للأصناف
-- آمن للتشغيل أكثر من مرة (IF NOT EXISTS)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_icon text DEFAULT '';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0;
