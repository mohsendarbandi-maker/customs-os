# Customs OS — Phase 13: Offline Queue Hardening

## هدف
ایمن‌سازی صف آفلاین پیش از استفاده عملیاتی با جلوگیری از replay شدن عملیات یک کاربر زیر session کاربر دیگر و جلوگیری از replay خودکار عملیات غیر idempotent.

## تغییرات
- هر آیتم صف با `userId` کاربر authenticated ذخیره می‌شود.
- صف فقط برای session همان کاربر خوانده و replay می‌شود.
- توکن، رمز عبور یا session token در IndexedDB ذخیره نمی‌شود.
- `set_shipment_tracking_status` از replay خودکار حذف شد، چون هر اجرا یک `shipment_tracking_events` جدید INSERT می‌کند و retry می‌تواند رویداد تکراری بسازد.
- RPCهای صف‌شونده فعلی فقط:
  - `attach_registration_order`
  - `update_case_operational_data`
  - `update_shipment_maritime_data`
- تست ایستا برای این invariants اضافه شد.

## وضعیت
پیاده‌سازی در `main` انجام شده و باید با GitHub Actions (`npm test` و `npm run build`) مجدداً تأیید شود.
