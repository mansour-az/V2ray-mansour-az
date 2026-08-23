# Venzo VPN

<div align="center">

**کلاینت هوشمند و فارسی VPN برای Android**

[دانلود آخرین نسخه](https://github.com/mansour-az/V2ray-mansour-az/releases/latest) ·
[کانال تلگرام](https://t.me/venzo_vpn) ·
[پشتیبانی](https://t.me/Venzzo_vpn)

</div>

---

## معرفی

Venzo VPN یک کلاینت Android با رابط فارسی و طراحی قرمز، مشکی و نقره‌ای است که اتصال به کانفیگ‌های رایگان و اشتراک‌های اختصاصی را ساده می‌کند. هدف اصلی برنامه این است که کاربر بدون درگیری با تنظیمات فنی، دکمه اتصال را بزند و برنامه از میان کانفیگ‌های موجود یک گزینه سالم و مناسب را پیدا کند.

این شاخه شامل سفارشی‌سازی Venzo، فروشگاه اشتراک، کاتالوگ منابع رایگان، اتصال امن به API، فایل‌های انتشار Google Play و گردش‌کارهای ساخت خودکار است.

> شاخه اصلی توسعه Venzo: [venzo-2.0](https://github.com/mansour-az/V2ray-mansour-az/tree/venzo-2.0)

## وضعیت نسخه

| مورد | وضعیت |
|---|---|
| آخرین نسخه عمومی | [Venzo VPN 2.4.0](https://github.com/mansour-az/V2ray-mansour-az/releases/tag/v2.4.0) |
| نسخه در حال ساخت | Venzo VPN 2.4.1 |
| پلتفرم | Android |
| خروجی نصب مستقیم | APK برای arm64-v8a |
| خروجی Google Play | AAB |
| شناسه برنامه | `com.venzo.vpn` |
| کانال به‌روزرسانی | GitHub Releases همین مخزن |

## امکانات

### اتصال و سرورها

- اتصال و قطع اتصال با یک دکمه
- انتخاب هوشمند کانفیگ سالم
- تلاش خودکار با سرور بعدی در صورت شکست اتصال
- نمایش لوکیشن، نوع پروتکل و پینگ سرور
- فهرست سرورهای در دسترس با امکان انتخاب دستی
- مرتب‌سازی و ارزیابی کانفیگ‌های سالم
- نمایش زمان اتصال و میزان ترافیک
- پشتیبانی از حالت VPN و Proxy در معماری پایه
- نگهداری آخرین منابع سالم برای استفاده در اختلال موقت منبع

### کانفیگ‌ها و اشتراک‌ها

- دریافت منابع رایگان از مانیفست تحت کنترل Venzo
- پشتیبانی از Subscription URL و فهرست‌های Base64/URI
- حذف کانفیگ‌های تکراری و نامعتبر
- به‌روزرسانی سابسکرایب
- نمایش کانفیگ‌های موجود در هر اشتراک
- انتخاب دستی یا خودکار کانفیگ
- زیرساخت تمدید اشتراک اختصاصی
- User-Agent سازگار با پنل‌های متداول بدون نمایش برند upstream

### فروشگاه و حساب کاربر

- دریافت پلن‌ها و قیمت‌ها از API بدون نیاز به انتشار APK جدید
- اتصال فروشگاه به Cloudflare Worker
- زیرساخت ساخت یا تمدید سرویس در PasarGuard از طریق backend
- سفارش‌های TRX و USDT روی شبکه TRC20
- پرداخت کارت‌به‌کارت و ارسال رسید
- زیرساخت درگاه ریالی
- کیف پول مجازی و تاریخچه تراکنش‌ها
- پیگیری وضعیت سفارش و ساخت سرویس
- مدیریت رسیدها در پنل مدیر

> برخی مسیرهای پرداخت و کیف پول در حال تکمیل و آزمون عملی هستند. تأیید پرداخت و ساخت سرویس باید همیشه در backend انجام شود و نتیجه سمت برنامه به‌تنهایی معتبر نیست.

### برند و رابط

- نام و هویت بصری Venzo VPN
- رابط فارسی و RTL
- تم اصلی قرمز
- لوگوی رسمی Venzo در برنامه و Launcher
- کانال رسمی: [t.me/venzo_vpn](https://t.me/venzo_vpn)
- پشتیبانی: [@Venzzo_vpn](https://t.me/Venzzo_vpn)
- بررسی نسخه جدید فقط از Releaseهای رسمی Venzo
- حذف لینک‌ها، اعلان‌ها و نام‌های قابل‌نمایش پروژه پایه از نسخه نصب‌شده

## معماری پروژه

نسخه Android با استفاده از سورس پایه سازگار با sing-box ساخته می‌شود. سفارشی‌سازی‌های Venzo به‌صورت patchهای جداگانه نگهداری شده‌اند تا دریافت اصلاحات upstream قابل‌کنترل باشد.

```text
LxBox upstream (source only)
          │
          ▼
venzo-lxbox.patch
          │
venzo-free-catalog.patch
          │
venzo-white-label.patch
          ▼
Flutter UI + Android/Kotlin VPN service + sing-box-lx core
          │
          ├── APK (direct install)
          └── AAB (Google Play)

Venzo Android app
          │ HTTPS
          ▼
Cloudflare Worker (venzo-store-api)
          │
          ├── PasarGuard API
          ├── plans and pricing
          ├── payment verification
          ├── receipts
          └── wallet and orders
```

اصل مهم معماری:

- مخزن upstream فقط در CI و فرایند توسعه استفاده می‌شود.
- برنامه نصب‌شده برای بررسی آپدیت فقط به GitHub رسمی Venzo متصل می‌شود.
- رمزها و API Keyها هرگز نباید داخل APK یا فایل‌های عمومی مخزن قرار بگیرند.

## ساختار فایل‌های Venzo

```text
venzo2/
├── icon.jpg.b64
├── lxbox-upstream.txt
├── venzo-lxbox.patch
├── venzo-free-catalog.patch
├── venzo-white-label.patch
├── latest.json
├── public-servers-manifest.json
├── support.json
├── donate.json
├── GOOGLE_PLAY_RELEASE.md
├── PLAY_STORE_RELEASE.md
└── store-api/
    ├── src/
    ├── package.json
    ├── wrangler.jsonc
    └── README.md
```

گردش‌کارهای مهم:

| Workflow | کاربرد |
|---|---|
| `venzo-vpn-build.yml` | ساخت، تست، امضای APK/AAB و انتشار اختیاری Release |
| `venzo-store-deploy.yml` | استقرار API فروشگاه روی Cloudflare Workers |
| `venzo-upstream-sync.yml` | بررسی روزانه نسخه جدید upstream و آزمون سازگاری patchها |

## ساخت APK و AAB با GitHub Actions

روش پیشنهادی، استفاده از GitHub Actions است:

1. وارد تب [Actions](https://github.com/mansour-az/V2ray-mansour-az/actions) شوید.
2. Workflow با نام **Build Venzo VPN 2.4.1** را انتخاب کنید.
3. گزینه **Run workflow** را بزنید.
4. برای ساخت آزمایشی، `publish_release` را خاموش نگه دارید.
5. پس از موفقیت Build، Artifact شامل APK و AAB را دانلود کنید.
6. فقط پس از بررسی نصب، اتصال و امضای فایل، انتشار عمومی را فعال کنید.

خروجی‌ها:

```text
Venzo-VPN-2.4.1-arm64.apk
Venzo-VPN-2.4.1.aab
SHA256SUMS.txt
```

APK برای نصب مستقیم روی دستگاه‌های arm64 است. فایل AAB برای Google Play Console استفاده می‌شود.

## ساخت محلی

### پیش‌نیازها

- Git
- Java 17
- Flutter با نسخه ثبت‌شده در سورس پایه
- Android SDK و Build Tools
- ابزارهای استاندارد Android
- Secrets امضای نسخه Release

### آماده‌سازی سورس

```bash
git clone --branch venzo-2.0 https://github.com/mansour-az/V2ray-mansour-az.git venzo-vpn
cd venzo-vpn

UPSTREAM_REF="$(tr -d '[:space:]' < venzo2/lxbox-upstream.txt)"
git clone --branch "$UPSTREAM_REF" --depth 1 https://github.com/Leadaxe/LxBox.git venzo-src

cd venzo-src
git apply ../venzo2/venzo-lxbox.patch
git apply ../venzo2/venzo-free-catalog.patch
git apply ../venzo2/venzo-white-label.patch
base64 --decode ../venzo2/icon.jpg.b64 > app/assets/icons/app_icon.png
```

### دریافت وابستگی‌ها و ساخت

```bash
cd app
flutter pub get
dart run flutter_launcher_icons

cd ..
./scripts/fetch-libbox.sh

cd app
flutter analyze
flutter test

flutter build apk --release \
  --target-platform android-arm64 \
  --dart-define=VENZO_API_BASE=https://venzo-store-api.mascot-gt.workers.dev

flutter build appbundle --release \
  --dart-define=VENZO_API_BASE=https://venzo-store-api.mascot-gt.workers.dev
```

## Secrets موردنیاز

Secrets باید در GitHub Actions یا Cloudflare Worker ثبت شوند. هیچ‌کدام را داخل README، فایل Dart/Kotlin، commit، Issue یا APK قرار ندهید.

### GitHub Actions

| Secret | کاربرد |
|---|---|
| `VENZO_KEYSTORE_BASE64` | فایل Keystore به‌صورت Base64 |
| `VENZO_STORE_PASSWORD` | رمز Keystore |
| `VENZO_KEY_PASSWORD` | رمز کلید |
| `VENZO_KEY_ALIAS` | Alias امضای برنامه |
| `CLOUDFLARE_API_TOKEN` | استقرار Worker |
| `CLOUDFLARE_ACCOUNT_ID` | شناسه حساب Cloudflare |

### Cloudflare Worker

نام دقیق متغیرها باید با پیاده‌سازی `venzo2/store-api` هماهنگ باشد. متغیرهای متداول پروژه شامل موارد زیر است:

- `PASARGUARD_API_URL`
- `PASARGUARD_API_KEY`
- `ADMIN_SECRET`
- `TRON_API_KEY`
- `TRX_WALLET_ADDRESS`
- `USDT_TRC20_WALLET_ADDRESS`
- `CARD_NUMBER`
- `CARD_HOLDER`
- کلیدها و callbackهای درگاه ریالی

اطلاعات PasarGuard و پرداخت فقط باید در backend نگهداری شوند. برنامه Android نباید مستقیماً رمز پنل یا کلید خصوصی کیف پول را دریافت کند.

## استقرار API فروشگاه

سورس Worker در مسیر زیر قرار دارد:

[venzo2/store-api](https://github.com/mansour-az/V2ray-mansour-az/tree/venzo-2.0/venzo2/store-api)

آدرس فعلی API:

```text
https://venzo-store-api.mascot-gt.workers.dev
```

استقرار خودکار از طریق Workflow زیر انجام می‌شود:

```text
.github/workflows/venzo-store-deploy.yml
```

راهنمای کامل متغیرها و endpointها در [README فروشگاه](venzo2/store-api/README.md) قرار دارد.

## مدیریت منابع رایگان

فایل [public-servers-manifest.json](venzo2/public-servers-manifest.json) منبع یا منابع رایگان مورداعتماد را مشخص می‌کند. برنامه به‌جای وابستگی مستقیم به نام یک پروژه خارجی، این مانیفست را از مخزن Venzo دریافت می‌کند.

هنگام اضافه‌کردن منبع جدید:

- منبع باید عمومی و قابل‌اعتماد باشد.
- قالب کانفیگ‌ها باید قابل‌پردازش باشد.
- کانفیگ‌های تکراری و خراب باید حذف شوند.
- قبل از اتصال، سلامت سرور باید بررسی شود.
- GitHub Token نباید در برنامه قرار بگیرد.
- شرایط استفاده و مجوز منبع باید رعایت شود.

## سیستم به‌روزرسانی برنامه

منبع اصلی:

```text
https://api.github.com/repos/mansour-az/V2ray-mansour-az/releases/latest
```

منبع جایگزین:

```text
https://raw.githubusercontent.com/mansour-az/V2ray-mansour-az/venzo-2.0/venzo2/latest.json
```

به‌روزرسانی برنامه کاربر فقط از Releaseهای Venzo پیشنهاد می‌شود. همگام‌سازی سورس پایه یک فرایند جداگانه در CI است و لینک upstream را به کاربر نمایش نمی‌دهد.

## همگام‌سازی امن upstream

Workflow زمان‌بندی‌شده آخرین Release سورس پایه را بررسی می‌کند. مرجع فعلی در فایل زیر نگهداری می‌شود:

```text
venzo2/lxbox-upstream.txt
```

مرجع upstream فقط زمانی جلو می‌رود که هر سه patch بدون خطا قابل‌اعمال باشند. اگر upstream با سفارشی‌سازی Venzo ناسازگار شود، Workflow متوقف می‌شود و نسخه خراب جایگزین پایه فعلی نخواهد شد.

## انتشار در Google Play

اسناد انتشار:

- [GOOGLE_PLAY_RELEASE.md](venzo2/GOOGLE_PLAY_RELEASE.md)
- [PLAY_STORE_RELEASE.md](venzo2/PLAY_STORE_RELEASE.md)

پیش از انتشار:

- `versionCode` باید افزایش پیدا کند.
- AAB باید با کلید دائمی Venzo امضا شده باشد.
- VPN، خرید، تمدید و بازیابی اتصال روی دستگاه واقعی تست شود.
- Data Safety و Privacy Policy تکمیل شود.
- مجوزهای برنامه با عملکرد واقعی مطابقت داشته باشند.
- اطلاعات حساس در APK/AAB بررسی شوند.
- نسخه ابتدا در Internal testing منتشر شود.

## امنیت

- همه درخواست‌های فروشگاه باید از HTTPS استفاده کنند.
- تأیید پرداخت باید سمت سرور انجام شود.
- callback درگاه به‌تنهایی اثبات پرداخت نیست.
- عملیات ساخت یا تمدید سرویس باید idempotent باشد.
- موجودی کیف پول باید فقط در backend معتبر باشد.
- کلید خصوصی رمزارز نباید در برنامه یا Worker عمومی ذخیره شود.
- رسید کارت‌به‌کارت باید فقط از مسیر احراز‌شده مدیر تأیید شود.
- Logها نباید Token، رمز، شماره کامل کارت یا اطلاعات حساس کاربر را ثبت کنند.
- برای Build عمومی فقط از Keystore دائمی Venzo استفاده شود.

## مشارکت و گزارش مشکل

برای مشکلات عمومی فنی می‌توانید از بخش [Issues](https://github.com/mansour-az/V2ray-mansour-az/issues) استفاده کنید.

برای پشتیبانی کاربران:

- پشتیبانی تلگرام: [@Venzzo_vpn](https://t.me/Venzzo_vpn)
- کانال رسمی: [t.me/venzo_vpn](https://t.me/venzo_vpn)

هنگام گزارش خطا، نسخه برنامه، مدل گوشی، نسخه Android و شرح مراحل بازتولید مشکل را ارسال کنید. رمزها، Subscription URL خصوصی، UUID، رسید پرداخت یا Token را در Issue عمومی قرار ندهید.

## سلب مسئولیت

Venzo VPN یک ابزار مدیریت اتصال است. مسئولیت رعایت قوانین محل زندگی، قوانین سرویس‌دهندگان، مجوز منابع کانفیگ و شرایط استفاده شبکه بر عهده کاربر و بهره‌بردار سرویس است.

## مجوزها و اعتبار سورس

این پروژه بر پایه نرم‌افزارهای متن‌باز ساخته می‌شود. مجوزها، Copyright noticeها و تعهدات پروژه‌های پایه و وابستگی‌ها باید در سورس و توزیع نهایی حفظ شوند. White-label کردن رابط کاربری به معنی حذف تعهدات مجوزهای متن‌باز نیست.

---

<div align="center">

**Venzo VPN — اتصال ساده، هوشمند و قابل‌کنترل**

[دانلود](https://github.com/mansour-az/V2ray-mansour-az/releases/latest) ·
[پشتیبانی](https://t.me/Venzzo_vpn) ·
[کانال](https://t.me/venzo_vpn)

</div>
