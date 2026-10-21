#!/usr/bin/env python3
"""Google Play 비공개 테스트 트랙에 AAB 올리기 (.github/workflows/mobile-release.yml에서 쓴다).

사용:
  play_release.py next-version-code      모든 트랙·올린 번들 중 가장 큰 버전 코드 + 1을 출력
  play_release.py upload <aab> [트랙]    번들을 올리고 그 트랙(기본 alpha = 비공개 테스트)의 출시를 이 번들로 바꾼다

환경 변수:
  PLAY_SERVICE_ACCOUNT_JSON  Play Console에서 출시 권한을 준 서비스 계정 키(JSON 내용)
  PLAY_PACKAGE               패키지 이름(기본 com.yuntyu01.naegirok)
"""
import json
import hashlib
import os
import ssl
import sys
import time

import httplib2
from google_auth_httplib2 import AuthorizedHttp
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

PACKAGE = os.environ.get('PLAY_PACKAGE', 'com.yuntyu01.naegirok')
EXPECTED_PACKAGE = 'com.yuntyu01.naegirok'
HTTP_TIMEOUT_SECONDS = 300
UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
UPLOAD_RETRIES = 5


def require_closed_test(track='alpha'):
    if PACKAGE != EXPECTED_PACKAGE or track != 'alpha':
        raise ValueError('This workflow only supports modo com.yuntyu01.naegirok on closed-test track alpha')


def report(message):
    print(message)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as stream:
            stream.write(message + '\n')


def edits():
    require_closed_test()
    info = json.loads(os.environ['PLAY_SERVICE_ACCOUNT_JSON'])
    creds = service_account.Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/androidpublisher'])
    http = AuthorizedHttp(creds, http=httplib2.Http(timeout=HTTP_TIMEOUT_SECONDS))
    return build('androidpublisher', 'v3', http=http, cache_discovery=False).edits()


def bundle_sha256(aab):
    with open(aab, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def resumable_bundle_upload(request):
    response = None
    failures = 0
    while response is None:
        try:
            _, response = request.next_chunk(num_retries=UPLOAD_RETRIES)
        except (TimeoutError, ConnectionError, ssl.SSLError, httplib2.HttpLib2Error):
            if failures >= UPLOAD_RETRIES:
                raise
            failures += 1
            report(f'::warning::Transient bundle upload transport error; resuming the same session (retry {failures}/{UPLOAD_RETRIES}).')
            time.sleep(min(2 ** failures, 30))
    return response


def next_version_code(api):
    require_closed_test()
    edit = api.insert(packageName=PACKAGE, body={}).execute()['id']
    try:
        tracks = api.tracks().list(packageName=PACKAGE, editId=edit).execute().get('tracks', [])
        codes = [int(c) for t in tracks for r in t.get('releases', []) for c in r.get('versionCodes', [])]
        bundles = api.bundles().list(packageName=PACKAGE, editId=edit).execute().get('bundles', [])
        codes += [int(b['versionCode']) for b in bundles]
        return max(codes, default=0) + 1
    finally:
        api.delete(packageName=PACKAGE, editId=edit).execute()


def upload(api, aab, track):
    require_closed_test(track)
    edit = api.insert(packageName=PACKAGE, body={}).execute()['id']
    committed = False
    try:
        digest = bundle_sha256(aab)
        bundles = api.bundles().list(packageName=PACKAGE, editId=edit).execute().get('bundles', [])
        existing = next((b for b in bundles if b.get('sha256') == digest), None)
        if existing:
            code = str(existing['versionCode'])
            report(f'Reusing already uploaded versionCode {code} with matching SHA-256.')
        else:
            media = MediaFileUpload(aab, mimetype='application/octet-stream',
                                    chunksize=UPLOAD_CHUNK_BYTES, resumable=True)
            try:
                request = api.bundles().upload(packageName=PACKAGE, editId=edit, media_body=media)
                code = str(resumable_bundle_upload(request)['versionCode'])
            finally:
                media.stream().close()
        current = api.tracks().get(packageName=PACKAGE, editId=edit, track=track).execute()
        prev = next((r for r in current.get('releases', []) if r.get('countryTargeting')), None)
        release = {'versionCodes': [code], 'status': 'completed'}
        sha = os.environ.get('GITHUB_SHA', '')[:12]
        release['name'] = f'modo ({code})' + (f' - {sha}' if sha else '')
        if prev:
            release['countryTargeting'] = prev['countryTargeting']
        api.tracks().update(packageName=PACKAGE, editId=edit, track=track, body={'track': track, 'releases': [release]}).execute()
        try:
            api.commit(packageName=PACKAGE, editId=edit).execute()
            committed = True
            report(f'Uploaded versionCode {code} to alpha and committed the edit. This is not proof of review approval or tester availability; confirm those states in Play Console.')
        except HttpError as error:
            if 'changesNotSentForReview' not in str(error):
                raise
            api.commit(packageName=PACKAGE, editId=edit, changesNotSentForReview=True).execute()
            committed = True
            report(f'::warning::Uploaded versionCode {code} to alpha, but changes were NOT sent for review. Send changes for review from Play Console publishing overview. Not yet approved or available to testers.')
    finally:
        if not committed:
            try:
                api.delete(packageName=PACKAGE, editId=edit).execute()
            except HttpError:
                print('::warning::Could not discard the uncommitted edit; inspect Play Console before retrying.')


def main():
    api = edits()
    if sys.argv[1:2] == ['next-version-code']:
        print(next_version_code(api))
    elif sys.argv[1:2] == ['upload'] and len(sys.argv) >= 3:
        upload(api, sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'alpha')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
