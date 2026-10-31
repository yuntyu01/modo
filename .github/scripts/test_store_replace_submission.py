import io
import unittest
import urllib.error

from store_replace_submission import BASE, replace_pending


class ReplaceSubmissionTests(unittest.TestCase):
    def test_no_pending_submission_is_left_alone(self):
        self.assertFalse(replace_pending(lambda url, method="GET": {}, "PRODUCT"))

    def test_submitted_flight_is_deleted_by_its_own_id(self):
        calls = []

        def api(url, method="GET"):
            calls.append((method, url))
            if url.endswith("/status"):
                return {"status": "Certification"}
            return {"pendingFlightSubmission": {"id": "123"}}

        self.assertTrue(replace_pending(api, "PRODUCT", "FLIGHT"))
        self.assertEqual(calls[-1], ("DELETE", f"{BASE}/PRODUCT/flights/FLIGHT/submissions/123"))

    def test_user_draft_is_not_deleted(self):
        calls = []

        def api(url, method="GET"):
            calls.append(method)
            return {"status": "PendingCommit"} if url.endswith("/status") else {
                "pendingApplicationSubmission": {"id": "123"}
            }

        with self.assertRaisesRegex(RuntimeError, "draft is preserved"):
            replace_pending(api, "PRODUCT")
        self.assertNotIn("DELETE", calls)

    def test_microsoft_refusing_cancellation_is_reported(self):
        for code in (400, 409):
            with self.subTest(code=code):
                def api(url, method="GET"):
                    if method == "DELETE":
                        raise urllib.error.HTTPError(url, code, "Rejected", {}, io.BytesIO())
                    return {"status": "Certification"} if url.endswith("/status") else {
                        "pendingApplicationSubmission": {"id": "123"}
                    }

                with self.assertRaisesRegex(RuntimeError, f"HTTP {code}.*cancel it in Partner Center"):
                    replace_pending(api, "PRODUCT")

    def test_malformed_submission_id_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "invalid submission ID"):
            replace_pending(lambda url, method="GET": {"pendingApplicationSubmission": {"id": "../x"}}, "PRODUCT")

    def test_canceled_submission_rejection_requests_manual_draft_update(self):
        def api(url, method="GET"):
            if method == "DELETE":
                raise urllib.error.HTTPError(url, 400, "Rejected", {}, io.BytesIO())
            return {"status": "Canceled"} if url.endswith("/status") else {
                "pendingFlightSubmission": {"id": "123"}
            }

        with self.assertRaisesRegex(RuntimeError, "update or remove the canceled draft"):
            replace_pending(api, "PRODUCT", "FLIGHT")


if __name__ == "__main__":
    unittest.main()

