import os
import sys
import json
import urllib.request


def main():
    base_url = os.getenv("INVOKE_URL")
    if not base_url:
        print("Error: Please set INVOKE_URL environment variable (e.g., https://abc123.execute-api.us-east-1.amazonaws.com/dev)")
        sys.exit(1)

    url = base_url.rstrip("/") + "/games"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            print("Status:", resp.status)
            try:
                print(json.dumps(json.loads(body), indent=2))
            except Exception:
                print(body)
    except urllib.error.HTTPError as e:
        print("HTTPError:", e.code, e.read().decode("utf-8"))
        sys.exit(2)
    except Exception as e:
        print("Error:", e)
        sys.exit(3)


if __name__ == "__main__":
    main()
