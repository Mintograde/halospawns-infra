import json
import os
import time
import boto3

ddb = boto3.resource('dynamodb')

def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')
        game_id = body.get('game_id')
        status = body.get('status')

        if not game_id or status is None:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Missing required fields: game_id and status'})
            }

        now_ms = int(time.time() * 1000)
        recent_window_sec = int(os.getenv('RECENT_WINDOW_SECONDS', '600'))
        ttl_sec = int(time.time()) + recent_window_sec
        print(f'Now: {now_ms} TTL: {ttl_sec}')

        table = ddb.Table(os.environ['TABLE_NAME'])
        item = {
            'game_id': game_id,
            'entity': 'game',
            'last_updated': now_ms,
            'status': status,
            'ttl': ttl_sec
        }
        table.put_item(Item=item)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'ok': True})
        }
    except Exception as e:
        print('Error in update_status handler', e)
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal Server Error'})
        }
