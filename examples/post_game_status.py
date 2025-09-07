import os
import sys
import json
import urllib.request


def main():
    base_url = os.getenv("INVOKE_URL")
    api_key = os.getenv("API_KEY")

    if not base_url:
        print("Error: Please set INVOKE_URL environment variable (e.g., https://abc123.execute-api.us-east-1.amazonaws.com/dev)")
        sys.exit(1)
    if not api_key:
        print("Error: Please set API_KEY environment variable (use output current_games_api_key_value)")
        sys.exit(1)

    url = base_url.rstrip("/") + "/game-status"
    payload = {
        "game_id": os.getenv("GAME_ID", "example-game-2"),
        "status": {
            "map": "Chill Out",
            "mode": "Slayer",
            "players": 4,
            "scores": {
                "red": 46,
                "blue": 35,
            }
        }
    }
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-api-key", api_key)

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
