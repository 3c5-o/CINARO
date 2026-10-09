import unittest
from unittest.mock import patch
from xtream_import import _normalize_catalog, _episodes, _source_path, _signature
from xtream_monitor import public_provider_url


class XtreamBulkImportTests(unittest.TestCase):
    def setUp(self):
        self.secret = patch.dict("os.environ", {
            "XTREAM_ENCRYPTION_KEY": "xtream-import-test-" + "x" * 60,
        })
        self.secret.start()

    def tearDown(self):
        self.secret.stop()

    def test_catalog_classifies_and_does_not_include_credentials_or_live(self):
        movies = [{"stream_id": 15, "name": "Movie 2024", "container_extension": "mkv",
                   "stream_icon": "", "category_id": "10"}]
        series = [{"series_id": 25, "name": "Anime One", "category_id": "20"},
                  {"series_id": 26, "name": "Drama", "category_id": "30"}]
        cat = _normalize_catalog("x-test", movies, series, [],
                                 [{"category_id": "20", "category_name": "Anime"},
                                  {"category_id": "30", "category_name": "Drama"}])
        self.assertEqual(len(cat), 3)
        self.assertEqual(sum(item["contentType"] == "anime" for item in cat), 1)
        self.assertEqual(next(item for item in cat if item["kind"] == "movie")["extension"], "mkv")
        self.assertNotIn("password", str(cat))
        self.assertNotIn("username", str(cat))

    def test_complete_multiseason_episode_mapping(self):
        payload = {
            "episodes": {
                "2": [{"id": "201", "episode_num": 1, "title": "First",
                       "container_extension": "mkv"},
                      {"id": "202", "episode_num": 2, "title": "Second"}],
                "1": [{"id": "101", "episode_num": 1, "title": "Pilot"}]
            }
        }
        seasons, count = _episodes("x-test", payload)
        self.assertEqual(count, 3)
        self.assertEqual([s["number"] for s in seasons], [1, 2])
        self.assertEqual([len(s["episodes"]) for s in seasons], [1, 2])
        self.assertIn("/xtream/play/x-test/series/201.mkv?", seasons[1]["episodes"][0]["sources"][0]["path"])
        self.assertNotIn("username", str(seasons))
        self.assertNotIn("password", str(seasons))

    def test_missing_episodes_are_rejected_without_partial_save(self):
        for payload in [{"episodes": {}}, {"episodes": {"1": []}},
                        {"episodes": {"1": [{"episode_num": 1}]}},
                        {"episodes": {"1": [
                            {"id": "100", "episode_num": 1},
                            {"id": "101", "episode_num": 1}]}}]:
            with self.assertRaises(ValueError):
                _episodes("x-test", payload)

    def test_signed_paths_cannot_be_recreated_for_different_media(self):
        path = _source_path("x-test", "movie", "12", "mp4")
        self.assertIn("?sig=", path)
        self.assertNotEqual(_signature("x-test", "movie", "12", "mp4"),
                            _signature("x-test", "movie", "13", "mp4"))
        with self.assertRaises(ValueError):
            _source_path("x-test", "movie", "../../private", "mp4")
        self.assertFalse(public_provider_url("http://127.0.0.1"))
