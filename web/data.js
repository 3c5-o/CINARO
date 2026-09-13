(function () {
  "use strict";

  const DEMO_DIRECT_VIDEO = "https://mute-breeze-eaf0.smyzx66.workers.dev/smyzx66-dot/housien/releases/download/v1/stream_1789206864_25.mp4";
  const SAFE_DEMO_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

  window.CINARO_DATA = {
    version: 1,
    brand: {
      name: "CINARO",
      arabicName: "سينارو",
      tagline: "كل قصة تبدأ هنا"
    },
    featured: ["movie-last-mission", "series-the-story", "movie-future-world"],
    items: [
      {
        id: "movie-last-mission",
        kind: "movie",
        title: "المهمة الأخيرة",
        englishTitle: "The Last Mission",
        year: 2026,
        rating: 8.8,
        ageRating: "+16",
        genres: ["أكشن", "إثارة"],
        duration: 130,
        views: 98200,
        addedAt: "2026-09-12",
        description: "مهمة أخيرة تقود بطلاً سابقًا إلى مواجهة منظمة غامضة، في رحلة تتصاعد فيها المطاردات والقرارات الصعبة.",
        poster: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=700&q=86",
        backdrop: "assets/images/cinaro-hero.webp",
        sources: [{ label: "تلقائي", url: DEMO_DIRECT_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "movie-dark-night",
        kind: "movie",
        title: "الليلة المظلمة",
        englishTitle: "Dark Night",
        year: 2025,
        rating: 8.4,
        ageRating: "+18",
        genres: ["رعب", "غموض"],
        duration: 112,
        views: 87300,
        addedAt: "2026-08-28",
        description: "تبدأ ليلة هادئة داخل منزل مهجور، ثم تتحول التفاصيل الصغيرة إلى سلسلة من الأحداث التي يصعب تفسيرها.",
        poster: "https://images.unsplash.com/photo-1509248961158-e54f6934749c?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1509248961158-e54f6934749c?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: [{ label: "العربية", srclang: "ar", src: "assets/subtitles/demo-ar.vtt" }]
      },
      {
        id: "movie-future-world",
        kind: "movie",
        title: "عالم المستقبل",
        englishTitle: "Future World",
        year: 2026,
        rating: 9.0,
        ageRating: "+13",
        genres: ["خيال علمي", "مغامرة"],
        duration: 140,
        views: 122400,
        addedAt: "2026-09-10",
        description: "في مستقبل بعيد، يصبح القرار الأخير بيد شخص واحد يكتشف أن إنقاذ العالم قد يتطلب تغيير الماضي.",
        poster: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "movie-lost-city",
        kind: "movie",
        title: "المدينة المفقودة",
        englishTitle: "Lost City",
        year: 2024,
        rating: 8.2,
        ageRating: "+13",
        genres: ["مغامرة", "أكشن"],
        duration: 125,
        views: 76100,
        addedAt: "2026-07-16",
        description: "مجموعة من المغامرين تبحث عن مدينة مفقودة تحمل سرًا قديمًا، لكن الوصول إليها ليس نهاية الرحلة.",
        poster: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "movie-last-road",
        kind: "movie",
        title: "الطريق الأخير",
        englishTitle: "The Last Road",
        year: 2025,
        rating: 8.1,
        ageRating: "+13",
        genres: ["دراما"],
        duration: 120,
        views: 65400,
        addedAt: "2026-06-04",
        description: "رحلة طويلة تغيّر حياة شاب يبحث عن فرصة ثانية، وتضعه أمام معنى مختلف للعودة والبداية.",
        poster: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "movie-mission-zero",
        kind: "movie",
        title: "المهمة صفر",
        englishTitle: "Mission Zero",
        year: 2026,
        rating: 7.9,
        ageRating: "+16",
        genres: ["أكشن", "جريمة"],
        duration: 108,
        views: 54100,
        addedAt: "2026-09-01",
        description: "عملية سرية تبدأ قبل منتصف الليل، وكل خطوة تكشف أن المهمة الحقيقية مختلفة تمامًا عما كُتب في الملف.",
        poster: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "movie-silent-line",
        kind: "movie",
        title: "الخط الصامت",
        englishTitle: "Silent Line",
        year: 2025,
        rating: 7.7,
        ageRating: "+16",
        genres: ["جريمة", "غموض"],
        duration: 103,
        views: 48800,
        addedAt: "2026-05-22",
        description: "مكالمة بلا صوت تقود محققًا إلى خيط قديم، ومع كل إجابة يظهر سؤال أخطر.",
        poster: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "movie-red-sky",
        kind: "movie",
        title: "السماء الحمراء",
        englishTitle: "Red Sky",
        year: 2026,
        rating: 8.6,
        ageRating: "+13",
        genres: ["إثارة", "خيال علمي"],
        duration: 118,
        views: 90500,
        addedAt: "2026-08-19",
        description: "عندما تتغير السماء خلال دقائق، تبدأ مدينة كاملة بالبحث عن تفسير قبل حلول الليل.",
        poster: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=88",
        sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }],
        subtitles: []
      },
      {
        id: "series-the-story",
        kind: "series",
        title: "الحكاية",
        englishTitle: "The Story",
        year: 2026,
        rating: 9.1,
        ageRating: "+16",
        genres: ["دراما", "غموض"],
        views: 145000,
        addedAt: "2026-09-11",
        description: "قصة مجموعة من الأشخاص وأسرارهم؛ تتقاطع اختياراتهم وتتضح الحقيقة تدريجيًا عبر موسمين.",
        poster: "https://images.unsplash.com/photo-1574267432553-4b4628081c31?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1574267432553-4b4628081c31?auto=format&fit=crop&w=1800&q=88",
        seasons: [
          {
            number: 1,
            title: "البداية",
            episodes: [
              { id: "s1e1", number: 1, title: "البداية", duration: 45, thumbnail: "https://images.unsplash.com/photo-1574267432553-4b4628081c31?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] },
              { id: "s1e2", number: 2, title: "السر", duration: 48, thumbnail: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] },
              { id: "s1e3", number: 3, title: "المواجهة", duration: 51, thumbnail: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] }
            ]
          },
          {
            number: 2,
            title: "العودة",
            episodes: [
              { id: "s2e1", number: 1, title: "العودة", duration: 50, thumbnail: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] },
              { id: "s2e2", number: 2, title: "الحقيقة", duration: 47, thumbnail: "https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] }
            ]
          }
        ]
      },
      {
        id: "series-city-files",
        kind: "series",
        title: "ملفات المدينة",
        englishTitle: "City Files",
        year: 2025,
        rating: 8.6,
        ageRating: "+16",
        genres: ["جريمة", "تشويق"],
        views: 99000,
        addedAt: "2026-08-07",
        description: "ملفات غامضة تعود إلى الواجهة بعد سنوات، ويكتشف الفريق أن القضايا المنفصلة تخفي رابطًا واحدًا.",
        poster: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1800&q=88",
        seasons: [
          {
            number: 1,
            title: "الملف الأول",
            episodes: [
              { id: "s1e1", number: 1, title: "الملف الأول", duration: 43, thumbnail: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] },
              { id: "s1e2", number: 2, title: "الشاهد", duration: 46, thumbnail: "https://images.unsplash.com/photo-1509248961158-e54f6934749c?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] }
            ]
          }
        ]
      },
      {
        id: "series-zero-hour",
        kind: "series",
        title: "ساعة الصفر",
        englishTitle: "Zero Hour",
        year: 2026,
        rating: 8.9,
        ageRating: "+13",
        genres: ["أكشن", "إثارة"],
        views: 111300,
        addedAt: "2026-09-05",
        description: "كل حلقة تقترب من لحظة واحدة ستغيّر مصير الفريق، بينما تتسابق الأسرار مع الوقت.",
        poster: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=700&q=86",
        backdrop: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1800&q=88",
        seasons: [
          {
            number: 1,
            title: "العد التنازلي",
            episodes: [
              { id: "s1e1", number: 1, title: "60 دقيقة", duration: 42, thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] },
              { id: "s1e2", number: 2, title: "الرسالة", duration: 44, thumbnail: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] },
              { id: "s1e3", number: 3, title: "الصفر", duration: 49, thumbnail: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=82", sources: [{ label: "تجريبي", url: SAFE_DEMO_VIDEO, type: "video/mp4" }], subtitles: [] }
            ]
          }
        ]
      }
    ]
  };
})();
