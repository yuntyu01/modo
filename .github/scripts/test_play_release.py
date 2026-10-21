import importlib.util
import json
import socket
import tempfile
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import httplib2
from googleapiclient.errors import HttpError
from googleapiclient.http import HttpRequest, MediaFileUpload

spec = importlib.util.spec_from_file_location('play_release', Path(__file__).with_name('play_release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class PlayReleaseTests(unittest.TestCase):
    def setUp(self):
        digest = patch.object(release, 'bundle_sha256', return_value='isolated-hash')
        digest.start()
        self.addCleanup(digest.stop)

    def api(self):
        api = MagicMock()
        api.insert.return_value.execute.return_value = {'id': 'isolated-edit'}
        api.bundles.return_value.upload.return_value.next_chunk.return_value = (None, {'versionCode': 24})
        api.bundles.return_value.list.return_value.execute.return_value = {'bundles': []}
        return api

    def test_retry_resumes_same_upload_after_socket_timeout(self):
        api = self.api()
        http = MagicMock()
        http.request.side_effect = [
            (httplib2.Response({'status': '200', 'location': 'https://isolated.test/resumable'}), b''),
            socket.timeout('isolated network timeout'),
            (httplib2.Response({'status': '200'}), b'{"versionCode": 24}'),
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.aab'
            path.write_bytes(b'isolated bundle')
            media = MediaFileUpload(str(path), chunksize=release.UPLOAD_CHUNK_BYTES, resumable=True)
            request = HttpRequest(http, lambda _response, body: json.loads(body),
                                  'https://isolated.test/upload', method='POST', body='{}',
                                  headers={}, resumable=media)
            request._sleep = MagicMock()
            api.bundles.return_value.upload.return_value = request
            with patch.object(release, 'MediaFileUpload', return_value=media), patch.object(release, 'report'), patch.object(release.time, 'sleep'):
                release.upload(api, str(path), 'alpha')
        self.assertEqual(http.request.call_count, 3)
        api.commit.assert_called_once()
        api.delete.assert_not_called()

    @patch.object(release, 'MediaFileUpload')
    def test_persistent_timeout_is_bounded_and_does_not_commit(self, _media):
        api = self.api()
        api.bundles.return_value.upload.return_value.next_chunk.side_effect = TimeoutError('isolated timeout')
        with patch.object(release.time, 'sleep'), patch.object(release, 'report'), self.assertRaises(TimeoutError):
            release.upload(api, 'isolated.aab', 'alpha')
        self.assertEqual(api.bundles.return_value.upload.return_value.next_chunk.call_count, 6)
        api.delete.assert_called_once()
        api.commit.assert_not_called()

    def test_existing_exact_bundle_is_reused_without_duplicate_upload(self):
        api = self.api()
        api.bundles.return_value.list.return_value.execute.return_value = {
            'bundles': [{'versionCode': 29, 'sha256': 'isolated-hash'}]}
        with patch.object(release, 'report'):
            release.upload(api, 'already-uploaded.aab', 'alpha')
        api.bundles.return_value.upload.assert_not_called()
        body = api.tracks.return_value.update.call_args.kwargs['body']
        self.assertEqual(body['releases'][0]['versionCodes'], ['29'])

    @patch.object(release, 'build')
    @patch.object(release, 'AuthorizedHttp')
    @patch.object(release.service_account.Credentials, 'from_service_account_info')
    def test_slow_processing_uses_bounded_five_minute_transport(self, _creds, authorized, _build):
        with patch.dict(release.os.environ, {'PLAY_SERVICE_ACCOUNT_JSON': '{}'}):
            release.edits()
        self.assertEqual(authorized.call_args.kwargs['http'].timeout, 300)

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
        api.bundles.return_value.upload.return_value.next_chunk.side_effect = RuntimeError('isolated upload failure')
        with self.assertRaises(RuntimeError):
            release.upload(api, 'isolated.aab', 'alpha')
        api.delete.assert_called_once_with(packageName=release.EXPECTED_PACKAGE, editId='isolated-edit')
        api.commit.assert_not_called()


if __name__ == '__main__':
    unittest.main()
