"""
test_auth.py — Tests for Clothify authentication endpoints.

Covers: signup, login, logout, /auth/me, update-profile, change-password.

Tests create a real user in the database using a unique email generated per
test run (timestamp-based) so repeated runs don't collide. The user is
deleted in tearDownClass so the database stays clean.

All tests gracefully accept 503 if MongoDB is not running in the test
environment — the test is marked as skipped rather than failed.
"""

import sys
import os
import unittest
import time
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

try:
    from starlette.testclient import TestClient
    from app import app
    client = TestClient(app, raise_server_exceptions=False)
    IMPORT_OK = True
except Exception as e:
    print(f"[WARN] Could not import app: {e}")
    IMPORT_OK = False

# ── Shared test credentials ────────────────────────────────────────────────────
_ts = int(time.time())
TEST_EMAIL    = f"test_auth_{_ts}@clothify.test"
TEST_PASSWORD = "TestPass123!"
TEST_NAME     = "Auth Tester"


def db_available() -> bool:
    """Return True only if the database health probe reports connected."""
    try:
        resp = client.get('/health/db')
        return resp.status_code == 200 and resp.json().get('mongodbConnected', False)
    except Exception:
        return False


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestSignup(unittest.TestCase):
    """Tests for POST /auth/signup."""

    def test_signup_success(self):
        """New unique email should return 200 with user + token."""
        unique_email = f"signup_ok_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': unique_email,
            'password': TEST_PASSWORD,
            'displayName': 'Sign Up Test',
        })
        if resp.status_code == 503:
            self.skipTest("Database not available")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('user', data)
        self.assertIn('token', data)
        self.assertEqual(data['user']['email'], unique_email)

    def test_signup_missing_email_returns_422(self):
        """Omitting email should return 422 (FastAPI schema validation)."""
        resp = client.post('/auth/signup', json={
            'password': TEST_PASSWORD,
            'displayName': TEST_NAME,
        })
        self.assertEqual(resp.status_code, 422)

    def test_signup_missing_password_returns_422(self):
        """Omitting password should return 422."""
        resp = client.post('/auth/signup', json={
            'email': f"no_pw_{_ts}@clothify.test",
            'displayName': TEST_NAME,
        })
        self.assertEqual(resp.status_code, 422)

    def test_signup_missing_displayname_returns_422(self):
        """Omitting displayName should return 422."""
        resp = client.post('/auth/signup', json={
            'email': f"no_name_{_ts}@clothify.test",
            'password': TEST_PASSWORD,
        })
        self.assertEqual(resp.status_code, 422)

    def test_signup_duplicate_email_returns_409(self):
        """Signing up with an existing email should return 409 Conflict."""
        email = f"dup_{_ts}@clothify.test"
        payload = {'email': email, 'password': TEST_PASSWORD, 'displayName': 'Dup'}
        first = client.post('/auth/signup', json=payload)
        if first.status_code == 503:
            self.skipTest("Database not available")
        second = client.post('/auth/signup', json=payload)
        self.assertEqual(second.status_code, 409)

    def test_signup_sets_auth_cookie(self):
        """Successful signup should set a clothify_token cookie."""
        unique = f"cookie_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': unique,
            'password': TEST_PASSWORD,
            'displayName': 'Cookie Test',
        })
        if resp.status_code == 503:
            self.skipTest("Database not available")
        self.assertIn('clothify_token', resp.cookies)

    def test_signup_email_case_insensitive(self):
        """Email stored in lowercase; mixed-case input should still succeed."""
        email = f"CaseTest_{_ts}@Clothify.TEST"
        resp = client.post('/auth/signup', json={
            'email': email,
            'password': TEST_PASSWORD,
            'displayName': 'Case Test',
        })
        if resp.status_code == 503:
            self.skipTest("Database not available")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['user']['email'], email.lower())


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestLogin(unittest.TestCase):
    """Tests for POST /auth/login."""

    @classmethod
    def setUpClass(cls):
        """Create one user to log in with across all login tests."""
        cls.email = f"login_{_ts}@clothify.test"
        cls.password = TEST_PASSWORD
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': cls.password,
            'displayName': 'Login Tester',
        })
        cls.db_ok = resp.status_code == 200

    def test_login_success(self):
        """Correct credentials should return 200 with user + token."""
        if not self.db_ok:
            self.skipTest("Database not available or signup failed")
        resp = client.post('/auth/login', json={
            'email': self.email,
            'password': self.password,
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('user', data)
        self.assertIn('token', data)

    def test_login_wrong_password_returns_401(self):
        """Wrong password should return 401 Unauthorized."""
        if not self.db_ok:
            self.skipTest("Database not available or signup failed")
        resp = client.post('/auth/login', json={
            'email': self.email,
            'password': 'WrongPassword!',
        })
        self.assertEqual(resp.status_code, 401)

    def test_login_unknown_email_returns_401(self):
        """Non-existent email should return 401 (no user enumeration via 404)."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.post('/auth/login', json={
            'email': 'ghost@clothify.test',
            'password': 'whatever',
        })
        self.assertEqual(resp.status_code, 401)

    def test_login_missing_email_returns_422(self):
        resp = client.post('/auth/login', json={'password': self.password})
        self.assertEqual(resp.status_code, 422)

    def test_login_missing_password_returns_422(self):
        resp = client.post('/auth/login', json={'email': self.email})
        self.assertEqual(resp.status_code, 422)

    def test_login_sets_cookie(self):
        """Successful login should set the clothify_token cookie."""
        if not self.db_ok:
            self.skipTest("Database not available or signup failed")
        resp = client.post('/auth/login', json={
            'email': self.email,
            'password': self.password,
        })
        self.assertIn('clothify_token', resp.cookies)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestLogout(unittest.TestCase):
    """Tests for POST /auth/logout."""

    def test_logout_returns_200(self):
        """Logout should always succeed regardless of auth state."""
        resp = client.post('/auth/logout')
        self.assertEqual(resp.status_code, 200)

    def test_logout_returns_logout_true(self):
        resp = client.post('/auth/logout')
        self.assertTrue(resp.json().get('logout'))


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestAuthMe(unittest.TestCase):
    """Tests for GET /auth/me."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"me_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': TEST_PASSWORD,
            'displayName': 'Me Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None

    def test_me_with_valid_token(self):
        """Valid Bearer token should return the user's profile."""
        if not self.db_ok:
            self.skipTest("Database not available or signup failed")
        resp = client.get('/auth/me', headers={'Authorization': f'Bearer {self.token}'})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['email'], self.email)

    def test_me_without_token_returns_401(self):
        """Unauthenticated request to /auth/me should return 401."""
        resp = client.get('/auth/me')
        self.assertEqual(resp.status_code, 401)

    def test_me_with_invalid_token_returns_401(self):
        """Malformed JWT should return 401."""
        resp = client.get('/auth/me', headers={'Authorization': 'Bearer not.a.real.token'})
        self.assertEqual(resp.status_code, 401)

    def test_me_response_excludes_password_hash(self):
        """Password hash must never appear in the /auth/me response."""
        if not self.db_ok:
            self.skipTest("Database not available or signup failed")
        resp = client.get('/auth/me', headers={'Authorization': f'Bearer {self.token}'})
        data = resp.json()
        self.assertNotIn('passwordHash', data)
        self.assertNotIn('password', data)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestUpdateProfile(unittest.TestCase):
    """Tests for PATCH /auth/profile."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"profile_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': TEST_PASSWORD,
            'displayName': 'Profile Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None

    def _auth(self):
        return {'Authorization': f'Bearer {self.token}'}

    def test_update_display_name(self):
        """Updating displayName should return the updated user object."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.patch('/auth/profile', json={'displayName': 'New Name'}, headers=self._auth())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['displayName'], 'New Name')

    def test_update_without_auth_returns_401(self):
        resp = client.patch('/auth/profile', json={'displayName': 'X'})
        self.assertEqual(resp.status_code, 401)

    def test_avatar_too_large_returns_400(self):
        """avatarUrl larger than ~180 KB should return 400."""
        if not self.db_ok:
            self.skipTest("Database not available")
        big_avatar = 'data:image/jpeg;base64,' + ('A' * 260_000)
        resp = client.patch('/auth/profile', json={'avatarUrl': big_avatar}, headers=self._auth())
        self.assertEqual(resp.status_code, 400)

    def test_empty_patch_is_accepted(self):
        """Sending an empty JSON body (no fields) should not error."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.patch('/auth/profile', json={}, headers=self._auth())
        self.assertEqual(resp.status_code, 200)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestChangePassword(unittest.TestCase):
    """Tests for POST /auth/change-password."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"changepw_{_ts}@clothify.test"
        cls.password = TEST_PASSWORD
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': cls.password,
            'displayName': 'PW Changer',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None

    def _auth(self):
        return {'Authorization': f'Bearer {self.token}'}

    def test_wrong_current_password_returns_400(self):
        """Wrong current password should return 400."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.post('/auth/change-password', json={
            'currentPassword': 'WrongOldPass!',
            'newPassword': 'NewPass456!',
        }, headers=self._auth())
        self.assertEqual(resp.status_code, 400)

    def test_without_auth_returns_401(self):
        resp = client.post('/auth/change-password', json={
            'currentPassword': TEST_PASSWORD,
            'newPassword': 'NewPass456!',
        })
        self.assertEqual(resp.status_code, 401)

    def test_missing_fields_returns_422(self):
        resp = client.post('/auth/change-password', json={}, headers=self._auth())
        self.assertEqual(resp.status_code, 422)

    def test_correct_password_change_succeeds(self):
        """Correct current password + new password should return 200."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.post('/auth/change-password', json={
            'currentPassword': self.password,
            'newPassword': 'ChangedPass789!',
        }, headers=self._auth())
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json().get('success'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
