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
import os
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

PACKAGE = os.environ.get('PLAY_PACKAGE', 'com.yuntyu01.naegirok')


def edits():
    info = json.loads(os.environ['PLAY_SERVICE_ACCOUNT_JSON'])
    creds = service_account.Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/androidpublisher'])
    return build('androidpublisher', 'v3', credentials=creds, cache_discovery=False).edits()


def next_version_code(api):
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
    edit = api.insert(packageName=PACKAGE, body={}).execute()['id']
    media = MediaFileUpload(aab, mimetype='application/octet-stream', resumable=True)
    code = str(api.bundles().upload(packageName=PACKAGE, editId=edit, media_body=media).execute()['versionCode'])
    # 이전 출시의 국가 제한이 있으면 그대로 잇는다(트랙의 출시 하나를 새 번들로 바꾼다)
    current = api.tracks().get(packageName=PACKAGE, editId=edit, track=track).execute()
    prev = next((r for r in current.get('releases', []) if r.get('countryTargeting')), None)
    release = {'versionCodes': [code], 'status': 'completed'}
    if prev:
        release['countryTargeting'] = prev['countryTargeting']
    api.tracks().update(packageName=PACKAGE, editId=edit, track=track, body={'track': track, 'releases': [release]}).execute()
    try:
        api.commit(packageName=PACKAGE, editId=edit).execute()
        print(f'versionCode {code} → {track} 출시(검토가 필요하면 Google이 검토 후 테스터에게)')
    except HttpError as e:
        # 앱 상태에 따라(거부된 변경 등) 자동으로 검토에 보낼 수 없다고 하면, 올려 두고 Console에서 검토 보내기를 누르게 한다
        if 'changesNotSentForReview' not in str(e):
            raise
        api.commit(packageName=PACKAGE, editId=edit, changesNotSentForReview=True).execute()
        print(f'::warning::versionCode {code}를 {track}에 올렸지만 자동으로 검토에 보내지 못했습니다. Play Console → 게시 개요에서 "검토를 위해 변경사항 보내기"를 누르세요.')


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
