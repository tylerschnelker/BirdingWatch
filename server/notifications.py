"""
Web Push notification sending for first-ever species detections.
"""

import json

from pywebpush import webpush, WebPushException

from config import VAPID_PRIVATE_KEY, VAPID_CLAIM_EMAIL
from database import get_all_push_subscriptions, remove_push_subscription


def send_first_ever_notification(species_common: str, species_scientific: str) -> None:
    """
    Push a "first time ever" alert to every subscribed browser.

    Best-effort and never raises: a failed or unconfigured push must never
    fail the /upload-audio request or affect detection logging.
    """
    if not VAPID_PRIVATE_KEY or not VAPID_CLAIM_EMAIL:
        return  # Push not configured on this deploy yet - silently skip.

    subscriptions = get_all_push_subscriptions()
    if not subscriptions:
        return

    payload = json.dumps({
        "title": "First time ever!",
        "body": f"{species_common} was just detected in your backyard for the first time.",
        "url": "/"
    })

    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub["endpoint"],
            "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}
        }
        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{VAPID_CLAIM_EMAIL}"}
            )
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):
                # Subscription expired or was revoked by the browser/OS - clean up.
                remove_push_subscription(sub["endpoint"])
                print(f"Removed expired push subscription (status {status})")
            else:
                print(f"Push send failed for a subscription (status {status}): {e}")
        except Exception as e:
            # Never let one bad subscription (or a network hiccup) break the loop.
            print(f"Unexpected error sending push notification: {e}")
