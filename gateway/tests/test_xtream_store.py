import asyncio
import json
import os
import unittest
from unittest.mock import patch
from xtream_store import encrypt, decrypt, safe_record, save_account, accounts_for_probe


class MockResponse:
    def __init__(self,code,value):
        self.status_code,self.value=code,value
    def json(self):
        return self.value


class Database:
    def __init__(self):
        self.rows=[]
    async def get(self, url, **kwargs):
        return MockResponse(200,self.rows[:])
    async def post(self,url,json,**kwargs):
        self.rows.append(json)
        return MockResponse(201,[json])
    async def patch(self,url,json,params,**kwargs):
        row=next(r for r in self.rows if r["id"]==params["id"][3:])
        row.update(json)
        return MockResponse(200,[row])


class StoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{
            "XTREAM_ENCRYPTION_KEY":"super-secret-test-key-"+("x"*45),
            "SUPABASE_URL":"https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY":"test-service-role-not-public-"+("x"*40)
        })
        self.env.start()
    def tearDown(self):
        self.env.stop()

    def test_encryption_is_authenticated_and_nondeterministic(self):
        value="my-very-private-password"
        a,b=encrypt(value),encrypt(value)
        self.assertNotEqual(a,b)
        self.assertEqual(decrypt(a),value)
        self.assertNotIn(value,a)
        with self.assertRaises(Exception):
            decrypt(a[:-5]+"AAAAA")

    async def test_crud_does_not_return_credentials(self):
        db=Database()
        async def approved(*_):
            return True
        payload={"name":"Main","url":"https://stream.provider.example",
                 "username":"private-user","password":"private-password","enabled":True}
        with patch("xtream_monitor.public_dns",approved):
            created=await save_account(db,payload)
            self.assertTrue(created["hasCredentials"])
            self.assertNotIn("password",json.dumps(created))
            self.assertNotIn("username",json.dumps(created))
            self.assertTrue(db.rows[0]["password_ciphertext"])
            self.assertNotIn("private-password",json.dumps(db.rows))
            result=await accounts_for_probe(db)
            self.assertEqual(result[0]["password"],"private-password")
            changed=await save_account(db,{
                "name":"Main Updated","url":"https://stream.provider.example","enabled":False
            },created["id"])
            self.assertEqual(changed["enabled"],False)
            self.assertEqual((await accounts_for_probe(db))[0]["username"],"private-user")

    async def test_no_insecure_url_or_missing_password(self):
        db=Database()
        with self.assertRaises(ValueError):
            await save_account(db,{"name":"X","url":"http://private.example",
                                   "username":"abc","password":"def"})
        with patch("xtream_monitor.public_dns",new=lambda *args: asyncio.sleep(0,result=True)):
            with self.assertRaises(ValueError):
                await save_account(db,{"name":"X","url":"https://provider.example",
                                       "username":"abc"})


if __name__=="__main__":
    unittest.main()
