# إعداد Firebase لنسخة مستخدم CINARO

المشروع مربوط بمعرّف Firebase: `cinaro`.

## 1. تفعيل Authentication

من Firebase Console افتح **Authentication → Sign-in method** ثم فعّل:

- Email/Password
- Anonymous

أضف `3c5-o.github.io` إلى **Authorized domains**.

## 2. إنشاء Cloud Firestore

أنشئ قاعدة Cloud Firestore، ثم انشر قواعد الحماية الموجودة في `firestore.rules`:

```bash
npx firebase-tools login
npx firebase-tools use cinaro
npx firebase-tools deploy --only firestore:rules
```

لا تستخدم وضع الاختبار المفتوح في النسخة المنشورة.

## 3. بنية المحتوى

أنشئ Collection باسم `content`. كل فيلم أو مسلسل يكون Document مستقلاً. مثال فيلم:

```json
{
  "id": "movie-example",
  "kind": "movie",
  "title": "اسم الفيلم",
  "englishTitle": "Movie Name",
  "year": 2026,
  "rating": 8.5,
  "ageRating": "+13",
  "genres": ["أكشن"],
  "duration": 110,
  "views": 0,
  "addedAt": "2026-09-14",
  "description": "وصف الفيلم",
  "poster": "https://example.com/poster.jpg",
  "backdrop": "https://example.com/backdrop.jpg",
  "sources": [
    {
      "label": "1080p",
      "url": "https://example.com/movie.mp4",
      "type": "video/mp4"
    }
  ],
  "subtitles": [],
  "featured": true,
  "published": true,
  "order": 100
}
```

المسلسل يستخدم الحقول نفسها، مع `seasons` بدل `sources`. كل موسم يحتوي `number` و`title` و`episodes`، وكل حلقة تحتوي رابطها داخل `sources`.

يمكن ترتيب اختيارات الواجهة بوضع مصفوفة معرّفات داخل المستند `appConfig/public`:

```json
{
  "featured": ["movie-example", "series-example"]
}
```

## 4. بيانات المستخدم

التطبيق ينشئ تلقائياً:

- `users/{uid}` للملف الشخصي.
- `users/{uid}/private/state` للمفضلة والسجل والإعدادات.

نسخة المستخدم لا تملك صلاحية إضافة أو تعديل المحتوى. هذه العمليات ستكون محصورة بنسخة الإدارة وحساب يحمل Custom Claim باسم `admin: true`.

## ملاحظات مهمة

- إعدادات Firebase الموجودة في الويب تعرّف المشروع وليست بديلاً عن قواعد الحماية.
- لا تضع مفاتيح خوادم أو Service Account داخل المستودع.
- إذا لم تكن الخدمات مفعّلة، يستمر التطبيق بالعمل كضيف ويعرض الكتالوج المضمّن بدلاً من ظهور شاشة بيضاء.
- روابط MP4 يجب أن تكون HTTPS وأن تدعم Range Requests.
