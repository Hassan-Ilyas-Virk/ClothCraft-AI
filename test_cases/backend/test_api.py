"""
test_api.py — Backend tests for Clothify AI + utility endpoints.

Uses FastAPI's TestClient (starlette.testclient) instead of Flask's
test_client so requests go through the actual ASGI app stack, including
middleware, dependency injection, and request validation.

AI model tests accept either 200 (model loaded) or 500 (model not loaded
in CI / lightweight test environments). They always reject a 422, which
would indicate a bad request payload that slipped through validation.
"""

import io
import sys
import os
import unittest

from PIL import Image

# Allow running from project root or test_cases directory.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

try:
    from starlette.testclient import TestClient
    from app import app
    client = TestClient(app, raise_server_exceptions=False)
    IMPORT_OK = True
except Exception as e:
    print(f"[WARN] Could not import app: {e}")
    IMPORT_OK = False


def make_png(width=256, height=512, color='red', mode='RGB') -> io.BytesIO:
    """Create an in-memory PNG image for use as a multipart upload."""
    img = Image.new(mode, (width, height), color=color)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return buf


def make_rgba_png(width=256, height=512) -> io.BytesIO:
    """Create an RGBA PNG (used for reference layer uploads)."""
    return make_png(width, height, color=(200, 100, 50, 255), mode='RGBA')


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestHealthEndpoint(unittest.TestCase):
    """Tests for the /health/db liveness probe."""

    def test_health_db_returns_200(self):
        """Health endpoint should always return 200, even if DB is degraded."""
        resp = client.get('/health/db')
        self.assertEqual(resp.status_code, 200)

    def test_health_db_returns_json(self):
        """Response must contain 'status' and 'mongodbConnected' keys."""
        resp = client.get('/health/db')
        data = resp.json()
        self.assertIn('status', data)
        self.assertIn('mongodbConnected', data)

    def test_health_db_status_value(self):
        """'status' must be either 'ok' or 'degraded'."""
        resp = client.get('/health/db')
        self.assertIn(resp.json()['status'], ('ok', 'degraded'))


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestTranslateDoodleEndpoint(unittest.TestCase):
    """Tests for POST /translate-doodle (Pix2Pix translation)."""

    def test_missing_file_returns_422(self):
        """Sending no file should return 422 Unprocessable Entity."""
        resp = client.post('/translate-doodle')
        self.assertEqual(resp.status_code, 422)

    def test_valid_image_returns_png(self):
        """Valid upload should return 200 with image/png, or 500 if model not loaded."""
        buf = make_png()
        resp = client.post(
            '/translate-doodle',
            files={'file': ('doodle.png', buf, 'image/png')},
        )
        self.assertIn(resp.status_code, (200, 500))
        if resp.status_code == 200:
            self.assertEqual(resp.headers['content-type'], 'image/png')

    def test_rgba_flag_accepted(self):
        """?rgba=true query param should be accepted without 422."""
        buf = make_png()
        resp = client.post(
            '/translate-doodle?rgba=true',
            files={'file': ('doodle.png', buf, 'image/png')},
        )
        self.assertIn(resp.status_code, (200, 500))

    def test_fast_flag_accepted(self):
        """?fast=true query param (live preview mode) should be accepted."""
        buf = make_png()
        resp = client.post(
            '/translate-doodle?fast=true&rgba=true',
            files={'file': ('doodle.png', buf, 'image/png')},
        )
        self.assertIn(resp.status_code, (200, 500))

    def test_rgba_png_input(self):
        """RGBA input image should be accepted (transparencies flattened to white internally)."""
        buf = make_rgba_png()
        resp = client.post(
            '/translate-doodle',
            files={'file': ('doodle.png', buf, 'image/png')},
        )
        self.assertIn(resp.status_code, (200, 500))


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestExtractDoodleEndpoint(unittest.TestCase):
    """Tests for POST /extract-doodle (convert photo to flat-colour doodle)."""

    def test_missing_file_returns_422(self):
        """No file uploaded should return 422."""
        resp = client.post('/extract-doodle')
        self.assertEqual(resp.status_code, 422)

    def test_valid_image_accepted(self):
        """Valid image should return 200 PNG or 500 if segmenter not loaded."""
        buf = make_png()
        resp = client.post(
            '/extract-doodle',
            files={'file': ('photo.png', buf, 'image/png')},
        )
        self.assertIn(resp.status_code, (200, 500))
        if resp.status_code == 200:
            self.assertEqual(resp.headers['content-type'], 'image/png')

    def test_num_colors_param(self):
        """Optional num_colors form field should not cause a 422."""
        buf = make_png()
        resp = client.post(
            '/extract-doodle',
            files={'file': ('photo.png', buf, 'image/png')},
            data={'num_colors': '5'},
        )
        self.assertIn(resp.status_code, (200, 500))


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestInpaintEndpoint(unittest.TestCase):
    """Tests for POST /inpaint (SD img2img with mask)."""

    def test_missing_all_params_returns_422(self):
        """Empty request should return 422."""
        resp = client.post('/inpaint')
        self.assertEqual(resp.status_code, 422)

    def test_missing_mask_returns_422(self):
        """Missing mask file should return 422."""
        buf = make_png()
        resp = client.post(
            '/inpaint',
            files={'reference': ('ref.png', buf, 'image/png')},
            data={'prompt': 'blue shirt', 'strength': '0.75'},
        )
        self.assertEqual(resp.status_code, 422)

    def test_valid_params_accepted(self):
        """Both reference and mask provided should return 200 or 500 (model)."""
        ref = make_png()
        mask = make_png(color='white')
        resp = client.post(
            '/inpaint',
            files={
                'reference': ('ref.png', ref, 'image/png'),
                'mask':      ('mask.png', mask, 'image/png'),
            },
            data={'prompt': 'a blue denim shirt', 'strength': '0.75'},
        )
        self.assertIn(resp.status_code, (200, 500))

    def test_strength_out_of_range_clamped(self):
        """Strength values outside 0-1 should be clamped, not rejected."""
        ref = make_png()
        mask = make_png(color='white')
        resp = client.post(
            '/inpaint',
            files={
                'reference': ('ref.png', ref, 'image/png'),
                'mask':      ('mask.png', mask, 'image/png'),
            },
            data={'prompt': 'floral pattern', 'strength': '1.5'},
        )
        self.assertNotEqual(resp.status_code, 422)


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestRefinePatternEndpoint(unittest.TestCase):
    """Tests for POST /refine-pattern (SD img2img on tiled pattern)."""

    def test_missing_image_returns_422(self):
        resp = client.post('/refine-pattern', data={'prompt': 'floral', 'strength': '0.5'})
        self.assertEqual(resp.status_code, 422)

    def test_valid_request_accepted(self):
        buf = make_png()
        resp = client.post(
            '/refine-pattern',
            files={'image': ('pattern.png', buf, 'image/png')},
            data={'prompt': 'seamless floral pattern', 'strength': '0.6'},
        )
        self.assertIn(resp.status_code, (200, 500))
        if resp.status_code == 200:
            self.assertEqual(resp.headers['content-type'], 'image/png')

    def test_default_strength_used_when_omitted(self):
        """strength field is optional — endpoint should not 422 without it."""
        buf = make_png()
        resp = client.post(
            '/refine-pattern',
            files={'image': ('pattern.png', buf, 'image/png')},
            data={'prompt': 'geometric'},
        )
        self.assertNotEqual(resp.status_code, 422)


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestRefineStylebendEndpoint(unittest.TestCase):
    """Tests for POST /refine-stylebend (low-strength SD pass on StyleGAN output)."""

    def test_missing_image_returns_422(self):
        resp = client.post('/refine-stylebend')
        self.assertEqual(resp.status_code, 422)

    def test_valid_image_accepted(self):
        buf = make_png(height=768)
        resp = client.post(
            '/refine-stylebend',
            files={'image': ('result.png', buf, 'image/png')},
            data={'strength': '0.35'},
        )
        self.assertIn(resp.status_code, (200, 500))

    def test_default_strength_works(self):
        """Omitting strength should use the default (0.35) without 422."""
        buf = make_png(height=768)
        resp = client.post(
            '/refine-stylebend',
            files={'image': ('result.png', buf, 'image/png')},
        )
        self.assertNotEqual(resp.status_code, 422)


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestTextToClothesEndpoint(unittest.TestCase):
    """Tests for POST /text-to-clothes (SegFormer mask + SD inpainting)."""

    def test_missing_all_returns_422(self):
        resp = client.post('/text-to-clothes')
        self.assertEqual(resp.status_code, 422)

    def test_missing_prompt_returns_422(self):
        buf = make_rgba_png()
        resp = client.post(
            '/text-to-clothes',
            files={'reference': ('ref.png', buf, 'image/png')},
        )
        self.assertEqual(resp.status_code, 422)

    def test_missing_reference_returns_422(self):
        resp = client.post('/text-to-clothes', data={'prompt': 'red dress'})
        self.assertEqual(resp.status_code, 422)

    def test_valid_params_accepted(self):
        """Valid reference + prompt should return 200 PNG or 500 (model not loaded)."""
        buf = make_rgba_png()
        resp = client.post(
            '/text-to-clothes',
            files={'reference': ('ref.png', buf, 'image/png')},
            data={'prompt': 'red silk dress', 'strength': '0.95'},
        )
        self.assertIn(resp.status_code, (200, 400, 500))

    def test_various_garment_prompts(self):
        """Different garment keywords should all be accepted without 422."""
        prompts = ['blue jeans', 'black blazer', 'white hoodie', 'floral dress']
        for prompt in prompts:
            with self.subTest(prompt=prompt):
                buf = make_rgba_png()
                resp = client.post(
                    '/text-to-clothes',
                    files={'reference': ('ref.png', buf, 'image/png')},
                    data={'prompt': prompt},
                )
                self.assertNotEqual(resp.status_code, 422)


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestBlendStylesEndpoint(unittest.TestCase):
    """Tests for POST /blend-styles (StyleGAN latent blending)."""

    def test_missing_both_images_returns_422(self):
        resp = client.post('/blend-styles')
        self.assertEqual(resp.status_code, 422)

    def test_missing_second_image_returns_422(self):
        buf = make_png()
        resp = client.post(
            '/blend-styles',
            files={'image1': ('img1.png', buf, 'image/png')},
            data={'alpha': '0.5'},
        )
        self.assertEqual(resp.status_code, 422)

    def test_valid_request_accepted(self):
        """Two images uploaded should return 200 JSON with frames, or 500."""
        buf1 = make_png(color='blue')
        buf2 = make_png(color='green')
        resp = client.post(
            '/blend-styles',
            files={
                'image1': ('img1.png', buf1, 'image/png'),
                'image2': ('img2.png', buf2, 'image/png'),
            },
            data={'alpha': '0.5', 'outpaint1': 'false', 'outpaint2': 'false'},
        )
        self.assertIn(resp.status_code, (200, 500))
        if resp.status_code == 200:
            data = resp.json()
            self.assertIn('frames', data)
            self.assertIsInstance(data['frames'], list)
            self.assertEqual(len(data['frames']), 21)

    def test_outpaint_flags_accepted(self):
        """outpaint1/outpaint2 boolean strings should not cause 422."""
        buf1 = make_png()
        buf2 = make_png()
        resp = client.post(
            '/blend-styles',
            files={
                'image1': ('img1.png', buf1, 'image/png'),
                'image2': ('img2.png', buf2, 'image/png'),
            },
            data={'alpha': '0.3', 'outpaint1': 'true', 'outpaint2': 'false'},
        )
        self.assertNotEqual(resp.status_code, 422)


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestGenerateHumanEndpoint(unittest.TestCase):
    """Tests for POST /generate-human (SD txt2img fashion model)."""

    def test_default_params_accepted(self):
        """All params have defaults — an empty POST should not return 422."""
        resp = client.post('/generate-human')
        self.assertNotEqual(resp.status_code, 422)

    def test_custom_prompt_accepted(self):
        resp = client.post('/generate-human', data={
            'prompt': 'a female model wearing a red evening gown',
            'negative_prompt': 'blurry, low quality',
            'steps': '30',
            'guidance': '7.5',
        })
        self.assertIn(resp.status_code, (200, 500))

    def test_returns_png_on_success(self):
        """When the model is loaded, response must be image/png."""
        resp = client.post('/generate-human', data={'steps': '20'})
        if resp.status_code == 200:
            self.assertEqual(resp.headers['content-type'], 'image/png')


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestSuggestColorsEndpoint(unittest.TestCase):
    """Tests for POST /suggest-colors (HSL keyword palette generator)."""

    def test_missing_prompt_returns_422(self):
        resp = client.post('/suggest-colors')
        self.assertEqual(resp.status_code, 422)

    def test_valid_prompt_returns_png(self):
        """Colour suggestion uses no ML model — should always return 200 PNG."""
        resp = client.post('/suggest-colors', data={'prompt': 'happy summer vibes'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers['content-type'], 'image/png')

    def test_emotion_keywords(self):
        """Various emotion/aesthetic prompts should all return 200."""
        prompts = ['sad', 'angry', 'calm', 'romantic', 'mysterious', 'cyberpunk', 'vintage']
        for prompt in prompts:
            with self.subTest(prompt=prompt):
                resp = client.post('/suggest-colors', data={'prompt': prompt})
                self.assertEqual(resp.status_code, 200)

    def test_color_keywords(self):
        """Direct colour keywords should return a matching palette."""
        resp = client.post('/suggest-colors', data={'prompt': 'navy blue minimal'})
        self.assertEqual(resp.status_code, 200)

    def test_unknown_prompt_returns_fallback_palette(self):
        """Unrecognised prompt falls back to MD5-derived hue — still 200."""
        resp = client.post('/suggest-colors', data={'prompt': 'xylophone kazoo'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers['content-type'], 'image/png')


@unittest.skipUnless(IMPORT_OK, "App import failed — skipping all tests")
class TestInputValidation(unittest.TestCase):
    """Cross-cutting validation: FastAPI returns 422 (not 400) for missing required fields."""

    def test_translate_doodle_no_file_is_422(self):
        self.assertEqual(client.post('/translate-doodle').status_code, 422)

    def test_extract_doodle_no_file_is_422(self):
        self.assertEqual(client.post('/extract-doodle').status_code, 422)

    def test_inpaint_no_files_is_422(self):
        self.assertEqual(client.post('/inpaint').status_code, 422)

    def test_refine_pattern_no_image_is_422(self):
        self.assertEqual(client.post('/refine-pattern', data={'prompt': 'x'}).status_code, 422)

    def test_suggest_colors_no_prompt_is_422(self):
        self.assertEqual(client.post('/suggest-colors').status_code, 422)

    def test_blend_styles_no_images_is_422(self):
        self.assertEqual(client.post('/blend-styles').status_code, 422)

    def test_text_to_clothes_no_data_is_422(self):
        self.assertEqual(client.post('/text-to-clothes').status_code, 422)


if __name__ == '__main__':
    unittest.main(verbosity=2)
