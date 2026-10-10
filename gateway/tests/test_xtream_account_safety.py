"""Regression tests: removing a provider must not orphan published CINARO media."""
import os
import unittest
from unittest.mock import patch

from xtream_store import delete_account, linked_content_exists


class Response:
    def __init__(self, code, rows):
        self.status_code = code
        self.rows = rows

    def json(self):
        return self.rows


class StoreClient:
    def __init__(self, linked=False, manual=False, error=False):
        self.linked = linked
        self.manual = manual
        self.error = error
        self.deleted = False
        self.content_checks = 0

    async def get(self, url, params=None, **kwargs):
        if url.endswith("/xtream_accounts"):
            return Response(200, [{"id": "x-abc", "name": "Demo", "enabled": True}])
        if url.endswith("/content"):
            self.content_checks += 1
            if self.error:
                return Response(500, [])
            if params.get("id") and self.linked:
                return Response(200, [{"id": "xt-x-abc-movie-1"}])
            if params.get("payload->>providerId") and self.manual:
                return Response(200, [{"id": "manually-created-title"}])
            return Response(200, [])
        raise AssertionError("unexpected DB route")

    async def delete(self, *_args, **_kwargs):
        self.deleted = True
        return Response(204, [])


class XtreamDeletionSafetyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "x" * 48,
        })
        self.environment.start()

    def tearDown(self):
        self.environment.stop()

    async def test_existing_titles_prohibit_account_deletion(self):
        client = StoreClient(linked=True)
        with self.assertRaisesRegex(ValueError, "account_has_linked_content"):
            await delete_account(client, "x-abc")
        self.assertFalse(client.deleted)
        self.assertEqual(client.content_checks, 1)

    async def test_manual_provider_references_also_prohibit_deletion(self):
        client = StoreClient(manual=True)
        with self.assertRaisesRegex(ValueError, "account_has_linked_content"):
            await delete_account(client, "x-abc")
        self.assertFalse(client.deleted)
        self.assertEqual(client.content_checks, 2)

    async def test_unlinked_account_can_be_deleted(self):
        client = StoreClient()
        self.assertTrue(await delete_account(client, "x-abc"))
        self.assertTrue(client.deleted)

    async def test_db_outage_must_not_allow_unverified_deletion(self):
        client = StoreClient(error=True)
        with self.assertRaisesRegex(RuntimeError, "content_dependency_check_failed"):
            await delete_account(client, "x-abc")
        self.assertFalse(client.deleted)

    async def test_injected_account_identifier_is_rejected(self):
        with self.assertRaises(ValueError):
            await linked_content_exists(StoreClient(), "x-invalid);drop")
