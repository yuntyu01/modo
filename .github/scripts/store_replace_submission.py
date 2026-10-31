"""Remove a superseded submitted Store update, without discarding drafts."""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


BASE = "https://manage.devcenter.microsoft.com/v1.0/my/applications"
REPLACEABLE = {
    "CommitStarted", "CommitFailed", "PendingPublication", "Publishing",
    "PublishFailed", "PreProcessing", "PreProcessingFailed", "Certification",
    "CertificationFailed", "Release", "ReleaseFailed", "Canceled",
}


def request(url, method="GET", headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=60) as response:
        body = response.read()
    return json.loads(body) if body else None


def replace_pending(api, product, flight=None):
    """Return whether a pending submission was removed; raise if unsafe."""
    target = f"{BASE}/{product}"
    pending_name = "pendingApplicationSubmission"
    if flight:
        target += f"/flights/{flight}"
        pending_name = "pendingFlightSubmission"

    details = api(target)
    submission = (details.get(pending_name) or {}).get("id")
    if not submission:
        return False
    if not re.fullmatch(r"[0-9]+", str(submission)):
        raise RuntimeError("Microsoft returned an invalid submission ID")

    submission_url = f"{target}/submissions/{submission}"
    status = api(submission_url + "/status").get("status")
    if status not in REPLACEABLE:
        raise RuntimeError(
            f"Existing submission {submission} has status {status!r}; "
            "an unsubmitted or unknown draft is preserved for review."
        )
    try:
        api(submission_url, method="DELETE")
    except urllib.error.HTTPError as error:
        if error.code in {400, 409}:
            next_step = (
                "update or remove the canceled draft in Partner Center"
                if status == "Canceled" else
                "cancel it in Partner Center or wait for certification"
            )
            raise RuntimeError(
                f"Microsoft rejected cancellation of submission {submission} "
                f"with HTTP {error.code} while its status is {status}; {next_step}, "
                "then run the workflow again."
            ) from error
        raise
    return True


def main():
    lane = sys.argv[1] if len(sys.argv) == 2 else ""
    if lane not in {"public", "flight"}:
        raise ValueError("Expected public or flight")
    product = os.environ["MODO_STORE_PRODUCT_ID"]
    flight = os.environ.get("MODO_STORE_FLIGHT_ID") if lane == "flight" else None
    if product != "9P8SSJ8GBB1X" or (lane == "flight" and not re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", flight or ""
    )):
        raise ValueError("Store product or flight ID is invalid")
    tenant = os.environ["STORE_TENANT_ID"]
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", tenant):
        raise ValueError("Store tenant ID is invalid")
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials", "client_id": os.environ["STORE_CLIENT_ID"],
        "client_secret": os.environ["STORE_CLIENT_SECRET"],
        "resource": "https://manage.devcenter.microsoft.com",
    }).encode()
    token = request(f"https://login.microsoftonline.com/{tenant}/oauth2/token", "POST", data=data)["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    def api(url, method="GET"):
        return request(url, method, headers)

    replaced = replace_pending(api, product, flight)
    print(f"{lane}: " + ("superseded submission canceled" if replaced else "no pending submission"))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        print(f"Microsoft Store API returned HTTP {error.code}", file=sys.stderr)
        sys.exit(1)
    except (KeyError, ValueError, RuntimeError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

