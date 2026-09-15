# CINARO — سينارو

تطبيق عربي للأفلام والمسلسلات بواجهة سينمائية مخصصة للهاتف، مع نسخة مستخدم ونسخة إدارة متجاوبة. يعملان كتطبيقَي ويب تقدّميين قابلين للتثبيت (PWA)، ويأتي مع نسخة Android للمستخدم تبني ملف APK تلقائيًا عبر GitHub Actions.

> كل قصة تبدأ هنا

## أهم المزايا

- واجهة RTL متجاوبة للهاتف والتابلت والكمبيوتر.
- شاشة بداية وهوية وأيقونة CINARO أصلية.
- رئيسية ديناميكية: تابع المشاهدة، الأكثر مشاهدة، الجديد، الأعلى تقييمًا والمسلسلات.
- صفحات مستقلة للأفلام والمسلسلات مع التصنيف والترتيب.
- بحث مباشر بالعربية والإنجليزية والتصنيف.
- تسجيل وإنشاء حساب واستعادة كلمة المرور عبر Firebase Authentication.
- دخول اختياري كضيف من دون تعطيل المشاهدة.
- مزامنة المفضلة وسجل المشاهدة والإعدادات بين أجهزة الحساب عبر Cloud Firestore.
- كتالوج مباشر من Firestore مع رجوع تلقائي إلى المحتوى المضمّن إذا لم تُفعّل الخدمة أو انقطع الاتصال.
- حفظ تقدم مستقل لكل فيلم ولكل حلقة، مع استئناف من آخر ثانية.
- روابط عميقة حقيقية للتفاصيل والتشغيل باستخدام Hash Routing.
- مشغل مخصص: تقديم/تأخير، سرعة، مصادر جودة، ترجمة VTT، ملء الشاشة، صورة داخل صورة والحلقة التالية.
- معالجة أخطاء الفيديو والصور وحالات الاتصال، والانتقال تلقائيًا إلى مصدر فيديو بديل عند فشل المصدر الحالي.
- Service Worker لتخزين واجهة التطبيق والعمل دون اتصال.
- مشروع Android WebView آمن يفتح النسخة الحية لتحديث المحتوى فورًا، ويرجع تلقائيًا إلى نسخة محلية مضمّنة عند تعذر الشبكة.
- لوحة إدارة Mobile-first لإدارة المحتوى والمستخدمين والأقسام والمشرفين وإعدادات النشر وسجل التدقيق.
- تعيين نطاق المشرف حسب الأقسام مع صلاحيات مستقلة للإضافة والتعديل والحذف والنشر.
- لا توجد بيانات كتالوج وهمية في الإنتاج؛ المحتوى الحقيقي يقرأ مباشرة من Firestore.

## تفعيل Firebase

إعداد المشروع موجود في `web/firebase.js`، وقواعد الحماية في `firestore.rules`. قبل اختبار الحسابات والمزامنة:

1. فعّل **Email/Password** و **Anonymous** من Firebase Authentication.
2. أضف `3c5-o.github.io` إلى Authorized domains.
3. أنشئ Cloud Firestore وانشر القواعد باستخدام `firebase deploy --only firestore:rules`.
4. أنشئ حساب الإدارة من Firebase Authentication بالبريد المخصص للمشروع، وأدخل كلمة المرور يدوياً داخل Firebase فقط.
5. أضف المحتوى المنشور داخل Collection باسم `content` أو استخدم لوحة الإدارة.

التعليمات وبنية مستندات الأفلام والمسلسلات موضحة بالكامل في [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).

## تشغيل نسخة الويب محليًا

يلزم Node.js 20 أو أحدث:

```bash
npm test
npm run dev
```

ثم افتح:

```text
http://127.0.0.1:4173
```

## إضافة فيلم

للمحتوى الحي أضف المستند إلى Collection باسم `content` في Firestore أو استخدم لوحة الإدارة. لا تتضمن `web/data.js` بيانات تجريبية:

```js
{
  id: "movie-unique-id",
  kind: "movie",
  title: "اسم الفيلم",
  englishTitle: "Movie Name",
  year: 2026,
  rating: 8.5,
  ageRating: "+13",
  genres: ["أكشن"],
  duration: 110,
  views: 0,
  addedAt: "2026-09-13",
  description: "وصف الفيلم",
  poster: "https://example.com/poster.jpg",
  backdrop: "https://example.com/backdrop.jpg",
  sources: [
    { label: "1080p", url: "https://example.com/movie-1080.mp4", type: "video/mp4" },
    { label: "720p", url: "https://example.com/movie-720.mp4", type: "video/mp4" }
  ],
  subtitles: [
    { label: "العربية", srclang: "ar", src: "assets/subtitles/movie-ar.vtt" }
  ]
}
```

يجب أن يكون رابط الفيديو مباشرًا عبر HTTPS، وأن يسمح الخادم بطلبات النطاق `Range Requests` حتى يعمل التقديم والاستئناف بصورة سليمة.

## بناء APK

عند رفع أي تعديل إلى فرع `main` يعمل مسار **Build Android APK** تلقائيًا:

1. افتح تبويب **Actions** في المستودع.
2. افتح آخر تشغيل باسم **Build Android APK**.
3. من **Artifacts** نزّل `CINARO-User-Android-APK`.
4. فك الضغط وثبّت ملف `CINARO-User-*.apk` على الهاتف.

إذا لم تُضف أسرار التوقيع، ينتج المسار نسخة Beta/Debug موقعة وقابلة للتثبيت والاختبار. لبناء Release ثابت أضف الأسرار التالية إلى GitHub Actions من دون رفع ملف المفتاح إلى المستودع:

- `CINARO_KEYSTORE_BASE64`
- `CINARO_KEYSTORE_PASSWORD`
- `CINARO_KEY_ALIAS`
- `CINARO_KEY_PASSWORD`

## GitHub Pages

المسار **Deploy CINARO PWA** ينشر التطبيق تلقائيًا. رابط التشغيل المباشر:

```text
https://3c5-o.github.io/CINARO/web/
```

لوحة الإدارة:

```text
https://3c5-o.github.io/CINARO/admin/
```

الرابط `https://3c5-o.github.io/CINARO/` يحوّل إلى التطبيق تلقائيًا.

## هيكل المشروع

```text
CINARO/
├── web/                    # تطبيق PWA
├── admin/                  # لوحة إدارة PWA متجاوبة وقابلة للتثبيت
├── android-app/            # مشروع Android الأصلي
├── firestore.rules         # صلاحيات Firestore
├── firebase.json           # إعداد نشر قواعد Firebase
├── assets/                 # دليل الهوية وبرومبتات الأصول
├── scripts/                # فحص وتشغيل محلي
└── .github/workflows/      # النشر وبناء APK والاختبارات
```

## تنبيه المحتوى

استخدم فقط فيديوهات وصورًا تملك حقوق نشرها أو لديك ترخيص لاستخدامها. يجب أن تكون الروابط مباشرة عبر HTTPS وأن يدعم خادم الفيديو Range Requests.
