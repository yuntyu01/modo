import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from googleapiclient.errors import HttpError

spec = importlib.util.spec_from_file_location('play_release', Path(__file__).with_name('play_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class PlayReleaseTests(unittest.TestCase):
    def api(self):
        api = MagicMock()
        api.insert.return_value.execute.return_value = {'id': 'isolated-edit'}
        api.bundles.return_value.upload.return_value.execute.return_value = {'versionCode': 24}
        return api

    def test_other_apps_and_production_rejected_before_any_api_mutation(self):
        api = self.api()
        with self.assertRaises(ValueError):
            release.upload(api, 'unused.aab', 'production')
        with patch.object(release, 'PACKAGE', 'com.other.app'), self.assertRaises(ValueError):
            release.next_version_code(api)
        api.insert.assert_not_called()

    def test_next_version_includes_uploaded_but_unreleased_bundles(self):
        api = self.api()
        api.tracks.return_value.list.return_value.execute.return_value = {'tracks': [{'releases': [{'versionCodes': ['22']}]}]}
        api.bundles.return_value.list.return_value.execute.return_value = {'bundles': [{'versionCode': 25}]}
        self.assertEqual(release.next_version_code(api), 26)
        api.delete.assert_called_once()

    @patch.object(release, 'MediaFileUpload')
    def test_existing_country_targeting_is_retained_and_approval_not_claimed(self, _media):
        api = self.api()
        targeting = {'countries': ['KR', 'JP'], 'includeRestOfWorld': False}
        api.tracks.return_value.get.return_value.execute.return_value = {'releases': [{'countryTargeting': targeting}]}
        with patch.object(release, 'report') as report:
            release.upload(api, 'isolated.aab', 'alpha')
        body = api.tracks.return_value.update.call_args.kwargs['body']
        self.assertEqual(body['track'], 'alpha')
        self.assertEqual(body['releases'][0]['countryTargeting'], targeting)
        self.assertEqual(body['releases'][0]['versionCodes'], ['24'])
        self.assertIn('not proof of review approval', report.call_args.args[0])
        api.delete.assert_not_called()

    @patch.object(release, 'MediaFileUpload')
    def test_review_fallback_is_reported_as_not_submitted(self, _media):
        api = self.api()
        api.tracks.return_value.get.return_value.execute.return_value = {}
        error = HttpError(MagicMock(status=400, reason='Bad Request'), b'{"error":{"message":"changesNotSentForReview required"}}')
        api.commit.return_value.execute.side_effect = [error, {}]
        with patch.object(release, 'report') as report:
            release.upload(api, 'isolated.aab', 'alpha')
        self.assertTrue(api.commit.call_args.kwargs['changesNotSentForReview'])
        self.assertIn('NOT sent for review', report.call_args.args[0])
        api.delete.assert_not_called()

    @patch.object(release, 'MediaFileUpload')
    def test_failed_upload_discards_only_its_uncommitted_edit(self, _media):
        api = self.api()
        api.bundles.return_value.upload.return_value.execute.side_effect = RuntimeError('isolated upload failure')
        with self.assertRaises(RuntimeError):
            release.upload(api, 'isolated.aab', 'alpha')
        api.delete.assert_called_once_with(packageName=release.EXPECTED_PACKAGE, editId='isolated-edit')
        api.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
