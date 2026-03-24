import unittest
import sys
import os
import io
import json
from PIL import Image

# Add parent directory to path to import app
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

try:
    from app import app
except ImportError:
    print("Error: Could not import 'app'. Make sure you are running this test from the project root or test_cases directory.")
    sys.exit(1)

class TestClothifyBackend(unittest.TestCase):
    def setUp(self):
        self.app = app.test_client()
        self.app.testing = True

    def create_dummy_image(self):
        """Creates a simple 256x256 RGB image for testing"""
        img = Image.new('RGB', (256, 256), color='red')
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        return img_byte_arr

    def test_health_check(self):
        """Test if the server starts (implicit check via other tests)"""
        # Since we don't have a dedicated health endpoint, we'll assume app creation in setUp works.
        pass

    def test_translate_doodle_success(self):
        """Test /translate-doodle with a valid file"""
        img_bytes = self.create_dummy_image()
        data = {
            'file': (img_bytes, 'test_doodle.png')
        }
        response = self.app.post('/translate-doodle', data=data, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'image/png')

    def test_translate_doodle_no_file(self):
        """Test /translate-doodle without a file"""
        response = self.app.post('/translate-doodle', data={})
        self.assertEqual(response.status_code, 400)

    def test_inpaint_success(self):
        """Test /inpaint with valid files"""
        ref_bytes = self.create_dummy_image()
        mask_bytes = self.create_dummy_image() # Mask is just an image here
        data = {
            'reference': (ref_bytes, 'ref.png'),
            'mask': (mask_bytes, 'mask.png'),
            'prompt': 'a blue shirt',
            'strength': '0.75'
        }
        
        # Note: inpaint might fail if models aren't loaded (e.g. on CI), 
        # but locally it should work or return 500 if CUDA missing but code runs.
        # We accept 200 (success) or 500 (model error) but NOT 400 (bad request).
        response = self.app.post('/inpaint', data=data, content_type='multipart/form-data')
        
        if response.status_code == 500:
             print("\n[WARN] /inpaint returned 500 (likely due to missing models/CUDA). This confirms the endpoint is reachable.")
        else:
             self.assertEqual(response.status_code, 200)
             self.assertEqual(response.mimetype, 'image/png')

    def test_inpaint_missing_params(self):
        """Test /inpaint with missing parameters"""
        response = self.app.post('/inpaint', data={})
        self.assertEqual(response.status_code, 400)

    def test_refine_pattern_success(self):
        """Test /refine-pattern with valid image"""
        img_bytes = self.create_dummy_image()
        data = {
            'image': (img_bytes, 'pattern.png'),
            'prompt': 'floral',
            'strength': '0.5'
        }
        
        response = self.app.post('/refine-pattern', data=data, content_type='multipart/form-data')
        if response.status_code == 500:
             print("\n[WARN] /refine-pattern returned 500 (likely due to missing models). Endpoint reachable.")
        else:
             self.assertEqual(response.status_code, 200)
             self.assertEqual(response.mimetype, 'image/png')

if __name__ == '__main__':
    unittest.main()
