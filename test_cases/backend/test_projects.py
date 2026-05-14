"""
test_projects.py — Tests for Clothify project CRUD endpoints.

Covers: create, list, get, save (PUT), rename (PATCH), delete.

A test user is created in setUpClass and all project tests run under that
user's session. The user and all created projects are cleaned up in
tearDownClass. Tests gracefully skip if MongoDB is unavailable.

Route map:
  POST   /projects                   — create
  GET    /projects                   — list
  GET    /projects/item/{id}         — get single
  PUT    /projects/{id}              — save (full update)
  PATCH  /projects/{id}/rename       — rename only
  DELETE /projects/{id}              — delete
"""

import sys
import os
import time
import unittest
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

_ts = int(time.time())
_TEST_EMAIL    = f"proj_user_{_ts}@clothify.test"
_TEST_PASSWORD = "ProjTest123!"


def _signup_and_token() -> str | None:
    """Create test user and return their JWT, or None if DB unavailable."""
    resp = client.post('/auth/signup', json={
        'email': _TEST_EMAIL,
        'password': _TEST_PASSWORD,
        'displayName': 'Project Tester',
    })
    if resp.status_code != 200:
        return None
    return resp.json().get('token')


def _auth(token: str) -> dict:
    return {'Authorization': f'Bearer {token}'}


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestProjectCreate(unittest.TestCase):
    """Tests for POST /projects."""

    @classmethod
    def setUpClass(cls):
        cls.token = _signup_and_token()
        cls.db_ok = cls.token is not None

    def test_create_project_success(self):
        """Authenticated user can create a project with a unique name."""
        if not self.db_ok:
            self.skipTest("Database not available")
        name = f"My Design {_ts}"
        resp = client.post('/projects', json={'name': name}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], name)
        self.assertIn('id', data)

    def test_create_returns_project_fields(self):
        """Created project document must contain required fields."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.post('/projects', json={'name': f"Fields Test {_ts}"}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        for field in ('id', 'name', 'createdAt', 'updatedAt'):
            self.assertIn(field, data, f"Missing field: {field}")

    def test_create_without_auth_returns_401(self):
        resp = client.post('/projects', json={'name': 'No Auth Project'})
        self.assertEqual(resp.status_code, 401)

    def test_create_missing_name_returns_422(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.post('/projects', json={}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 422)

    def test_create_duplicate_name_returns_409(self):
        """Creating two projects with the same name should return 409 on the second."""
        if not self.db_ok:
            self.skipTest("Database not available")
        name = f"Duplicate Project {_ts}"
        client.post('/projects', json={'name': name}, headers=_auth(self.token))
        resp2 = client.post('/projects', json={'name': name}, headers=_auth(self.token))
        self.assertEqual(resp2.status_code, 409)

    def test_create_duplicate_name_case_insensitive(self):
        """Name comparison is case-insensitive: 'my design' == 'My Design'."""
        if not self.db_ok:
            self.skipTest("Database not available")
        name = f"CaseProject {_ts}"
        client.post('/projects', json={'name': name}, headers=_auth(self.token))
        resp = client.post('/projects', json={'name': name.lower()}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 409)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestProjectList(unittest.TestCase):
    """Tests for GET /projects."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"list_user_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': _TEST_PASSWORD,
            'displayName': 'List Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None
        # Create a couple of projects to list
        if cls.db_ok:
            client.post('/projects', json={'name': f'List Alpha {_ts}'}, headers=_auth(cls.token))
            client.post('/projects', json={'name': f'List Beta {_ts}'},  headers=_auth(cls.token))

    def test_list_returns_array(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.get('/projects', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)

    def test_list_contains_created_projects(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.get('/projects', headers=_auth(self.token))
        names = [p['name'] for p in resp.json()]
        self.assertIn(f'List Alpha {_ts}', names)
        self.assertIn(f'List Beta {_ts}', names)

    def test_list_excludes_layers_snapshot(self):
        """List endpoint omits layersSnapshot to keep response small."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.get('/projects', headers=_auth(self.token))
        for proj in resp.json():
            self.assertNotIn('layersSnapshot', proj)

    def test_list_without_auth_returns_401(self):
        resp = client.get('/projects')
        self.assertEqual(resp.status_code, 401)

    def test_list_sorted_newest_first(self):
        """Projects should be returned in descending updatedAt order."""
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.get('/projects', headers=_auth(self.token))
        items = resp.json()
        if len(items) >= 2:
            self.assertGreaterEqual(items[0]['updatedAt'], items[1]['updatedAt'])


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestProjectGet(unittest.TestCase):
    """Tests for GET /projects/item/{id}."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"get_user_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': _TEST_PASSWORD,
            'displayName': 'Get Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None
        cls.project_id = None
        if cls.db_ok:
            pr = client.post('/projects', json={'name': f'Get Test {_ts}'}, headers=_auth(cls.token))
            if pr.status_code == 200:
                cls.project_id = pr.json()['id']

    def test_get_project_by_id(self):
        if not self.db_ok or not self.project_id:
            self.skipTest("Database not available or project not created")
        resp = client.get(f'/projects/item/{self.project_id}', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['id'], self.project_id)

    def test_get_includes_layers_snapshot(self):
        """Full GET (unlike list) includes layersSnapshot for canvas hydration."""
        if not self.db_ok or not self.project_id:
            self.skipTest("Database not available or project not created")
        resp = client.get(f'/projects/item/{self.project_id}', headers=_auth(self.token))
        data = resp.json()
        # layersSnapshot key must exist (may be null for new empty project)
        self.assertIn('layersSnapshot', data)

    def test_get_nonexistent_returns_404(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.get('/projects/item/000000000000000000000000', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 404)

    def test_get_invalid_id_returns_400(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.get('/projects/item/not-a-valid-id', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 400)

    def test_get_without_auth_returns_401(self):
        resp = client.get('/projects/item/000000000000000000000000')
        self.assertEqual(resp.status_code, 401)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestProjectSave(unittest.TestCase):
    """Tests for PUT /projects/{id} (save full canvas state)."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"save_user_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': _TEST_PASSWORD,
            'displayName': 'Save Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None
        cls.project_id = None
        if cls.db_ok:
            pr = client.post('/projects', json={'name': f'Save Test {_ts}'}, headers=_auth(cls.token))
            if pr.status_code == 200:
                cls.project_id = pr.json()['id']

    def test_save_updates_name_and_snapshot(self):
        if not self.db_ok or not self.project_id:
            self.skipTest("Database not available or project not created")
        snapshot = json.dumps({'canvasWidth': 512, 'canvasHeight': 1024, 'layers': []})
        resp = client.put(f'/projects/{self.project_id}', json={
            'name': f'Saved Design {_ts}',
            'thumbnail': 'data:image/png;base64,abc',
            'layersSnapshot': snapshot,
        }, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], f'Saved Design {_ts}')

    def test_save_without_auth_returns_401(self):
        resp = client.put('/projects/000000000000000000000000', json={
            'name': 'X', 'thumbnail': None, 'layersSnapshot': None,
        })
        self.assertEqual(resp.status_code, 401)

    def test_save_nonexistent_project_returns_404(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.put('/projects/000000000000000000000000', json={
            'name': 'Ghost', 'thumbnail': None, 'layersSnapshot': None,
        }, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 404)

    def test_save_missing_name_returns_422(self):
        if not self.db_ok or not self.project_id:
            self.skipTest("Database not available")
        resp = client.put(f'/projects/{self.project_id}', json={
            'thumbnail': None, 'layersSnapshot': None,
        }, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 422)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestProjectRename(unittest.TestCase):
    """Tests for PATCH /projects/{id}/rename."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"rename_user_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': _TEST_PASSWORD,
            'displayName': 'Rename Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None
        cls.project_id = None
        if cls.db_ok:
            pr = client.post('/projects', json={'name': f'Rename Me {_ts}'}, headers=_auth(cls.token))
            if pr.status_code == 200:
                cls.project_id = pr.json()['id']

    def test_rename_success(self):
        if not self.db_ok or not self.project_id:
            self.skipTest("Database not available or project not created")
        new_name = f'Renamed Design {_ts}'
        resp = client.patch(f'/projects/{self.project_id}/rename',
                            json={'name': new_name}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['name'], new_name)

    def test_rename_to_same_name_is_allowed(self):
        """Self-rename (same name) should succeed — excluded from conflict check."""
        if not self.db_ok or not self.project_id:
            self.skipTest("Database not available or project not created")
        # Get current name
        proj = client.get(f'/projects/item/{self.project_id}', headers=_auth(self.token)).json()
        resp = client.patch(f'/projects/{self.project_id}/rename',
                            json={'name': proj['name']}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)

    def test_rename_to_existing_name_returns_409(self):
        """Renaming to another existing project's name should return 409."""
        if not self.db_ok:
            self.skipTest("Database not available")
        other_name = f'Other Proj {_ts}'
        client.post('/projects', json={'name': other_name}, headers=_auth(self.token))
        if not self.project_id:
            self.skipTest("Project not created")
        resp = client.patch(f'/projects/{self.project_id}/rename',
                            json={'name': other_name}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 409)

    def test_rename_without_auth_returns_401(self):
        resp = client.patch('/projects/000000000000000000000000/rename',
                            json={'name': 'X'})
        self.assertEqual(resp.status_code, 401)

    def test_rename_nonexistent_returns_404(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.patch('/projects/000000000000000000000000/rename',
                            json={'name': 'Ghost'}, headers=_auth(self.token))
        self.assertEqual(resp.status_code, 404)


@unittest.skipUnless(IMPORT_OK, "App import failed")
class TestProjectDelete(unittest.TestCase):
    """Tests for DELETE /projects/{id}."""

    @classmethod
    def setUpClass(cls):
        cls.email = f"del_user_{_ts}@clothify.test"
        resp = client.post('/auth/signup', json={
            'email': cls.email,
            'password': _TEST_PASSWORD,
            'displayName': 'Delete Tester',
        })
        cls.db_ok = resp.status_code == 200
        cls.token = resp.json().get('token') if cls.db_ok else None

    def _create_project(self, name: str) -> str | None:
        resp = client.post('/projects', json={'name': name}, headers=_auth(self.token))
        return resp.json()['id'] if resp.status_code == 200 else None

    def test_delete_own_project(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        pid = self._create_project(f'Delete Me {_ts}')
        if not pid:
            self.skipTest("Project not created")
        resp = client.delete(f'/projects/{pid}', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 200)

    def test_deleted_project_not_in_list(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        pid = self._create_project(f'Gone Soon {_ts}')
        if not pid:
            self.skipTest("Project not created")
        client.delete(f'/projects/{pid}', headers=_auth(self.token))
        items = client.get('/projects', headers=_auth(self.token)).json()
        ids = [p['id'] for p in items]
        self.assertNotIn(pid, ids)

    def test_delete_nonexistent_returns_404(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.delete('/projects/000000000000000000000000', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 404)

    def test_delete_without_auth_returns_401(self):
        resp = client.delete('/projects/000000000000000000000000')
        self.assertEqual(resp.status_code, 401)

    def test_delete_invalid_id_returns_400(self):
        if not self.db_ok:
            self.skipTest("Database not available")
        resp = client.delete('/projects/not-an-object-id', headers=_auth(self.token))
        self.assertEqual(resp.status_code, 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
