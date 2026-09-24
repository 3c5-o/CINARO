# إعداد Firebase لنسختي CINARO (المستخدم والإدارة)

المشروع مربوط بمعرّف Firebase: `cinaro`.

## 1. تفعيل Authentication

من Firebase Console افتح **Authentication → Sign-in method** ثم فعّل:

- Email/Password
- Anonymous

أضف `3c5-o.github.io` إلى **Authorized domains**.

أنشئ حساب الإدارة من **Authentication → Users → Add user** بالبريد الإداري المخصص للمشروع. أدخل كلمة المرور يدوياً داخل Firebase Console فقط؛ لا تضعها في GitHub أو ملفات JavaScript. لوحة الإدارة تسمح بالدخول لهذا البريد أو لأي حساب يحمل Custom Claim باسم `admin: true`.

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

كل مستند محتوى جديد يستخدم أيضاً `managementSectionId` لتحديد قسم الإدارة الأساسي. هذا الحقل هو الذي يحدد نطاق قراءة المشرف، بينما `sectionIds` تحدد جميع الأقسام التي يظهر فيها المحتوى. لوحة الإدارة 2.4.0 ترحّل المحتوى القديم تلقائياً عند دخول المدير.

يمكن ترتيب اختيارات الواجهة ووضع التنبيهات من لوحة الإدارة أو بوضع مصفوفة معرّفات داخل المستند `appConfig/public`:

```json
{
  "featured": ["movie-example", "series-example"],
  "announcement": "رسالة اختيارية للمستخدمين",
  "latestVersion": "2.4.0",
  "minimumVersion": "2.4.0",
  "updateNotes": "ملاحظات التحديث التي تظهر للمستخدم",
  "updateUrl": "https://github.com/3c5-o/CINARO/releases/latest",
  "maintenance": false,
  "forceUpdate": false
}
```

## 4. بيانات المستخدم

التطبيق ينشئ تلقائياً:

- `users/{uid}` للملف الشخصي.
- `users/{uid}/private/state` للمفضلة والسجل والإعدادات.
- `content/{contentId}/viewers/{uid}` عند احتساب أول مشاهدة فعلية للحساب.
- `reports/{reportId}` عند إرسال المستخدم بلاغًا عن مشكلة تشغيل.
- `contentRequests/{requestId}` لطلبات الأفلام والمسلسلات ومتابعة حالتها.

نسخة المستخدم لا تملك صلاحية إضافة أو تعديل المحتوى. لوحة الإدارة متاحة من:

```text
https://3c5-o.github.io/CINARO/admin/
```

من لوحة الإدارة يمكنك إدارة المحتوى الحقيقي، المستخدمين، الأقسام، تعيينات المشرفين، الإعدادات وسجل التدقيق. المدير يحدد لكل مشرف `sectionIds` وصلاحيات `createContent` و`editContent` و`deleteContent` و`publishContent`.

يدخل المشرف من صفحة الإدارة نفسها. يقبل النظام الحساب عندما يكون له مستند نشط في `supervisorAssignments/{uid}`، وتعرض له اللوحة المحتوى والأقسام المسموح بها فقط. إدارة المستخدمين والمشرفين والإعدادات والبلاغات وسجل التدقيق تبقى للمدير العام.

## ملاحظات مهمة

- إعدادات Firebase الموجودة في الويب تعرّف المشروع وليست بديلاً عن قواعد الحماية.
- لا تضع مفاتيح خوادم أو Service Account داخل المستودع.
- لا يحتوي الإصدار المنشور على كتالوج وهمي أو بيانات تجريبية؛ ستظهر رسالة واضحة إلى أن تضيف محتوى منشوراً من لوحة الإدارة.
- روابط MP4 يجب أن تكون HTTPS وأن تدعم Range Requests.
