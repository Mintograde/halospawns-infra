import json


def handler(event, context):
    return {
        "statusCode": 503,
        "headers": {
            "content-type": "application/json",
            "cache-control": "no-store",
        },
        "body": json.dumps(
            {
                "status": "unavailable",
                "message": "The app API has not been deployed yet.",
            }
        ),
    }
