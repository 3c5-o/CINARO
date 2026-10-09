import unittest
from fastapi import HTTPException
from xtream_monitor import require_owner


class Result:
    def __init__(self, code, body):
        self.status_code = code
        self.body = body

    def json(self):
        return self.body


class Client:
    def __init__(self, auth_code=200, membership_role="owner", membership_active=True):
        self.auth_code = auth_code
        self.membership_role = membership_role
        self.membership_active = membership_active

    async def get(self, url, **kwargs):
        if url.endswith("/auth/v1/user"):
            return Result(self.auth_code, {
                "id": "9fa19315-732f-474b-a62f-c886ccb20d2a",
                "email": "ffkyyr@gmail.com",
                "email_confirmed_at": "2026-10-09"
            })
        if url.endswith("/rest/v1/admin_memberships"):
            return Result(200, [{"role": self.membership_role, "active": self.membership_active}])
        raise AssertionError("Unexpected backend request")


class VerifiedOwnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_verified_owner_is_accepted(self):
        user = await require_owner("session", Client(), "https://example.supabase.co", "test-key", "irrelevant@example.com")
        self.assertEqual(user["email"], "ffkyyr@gmail.com")

    async def test_secondary_admin_is_not_owner(self):
        with self.assertRaises(HTTPException) as captured:
            await require_owner("session", Client(membership_role="admin"), "https://example.supabase.co", "test-key", "irrelevant@example.com")
        self.assertEqual(captured.exception.status_code, 403)

    async def test_disabled_owner_is_denied(self):
        with self.assertRaises(HTTPException) as captured:
            await require_owner("session", Client(membership_active=False), "https://example.supabase.co", "test-key", "irrelevant@example.com")
        self.assertEqual(captured.exception.status_code, 403)

    async def test_old_project_is_reported_as_session_or_project_mismatch(self):
        with self.assertRaises(HTTPException) as captured:
            await require_owner("session", Client(auth_code=403), "https://old.supabase.co", "test-key", "irrelevant@example.com")
        self.assertEqual(captured.exception.status_code, 401)
        self.assertEqual(captured.exception.detail, "auth_project_or_session_invalid")
