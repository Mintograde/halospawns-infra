import json
import os
import time
import boto3
from boto3.dynamodb.conditions import Attr

ddb = boto3.resource('dynamodb')

def handler(event, context):
    try:
        recent_window_sec = int(os.getenv('RECENT_WINDOW_SECONDS', '600'))
        now_ms = int(time.time() * 1000)
        cutoff = now_ms - (recent_window_sec * 1000)
        print(cutoff)

        table = ddb.Table(os.environ['TABLE_NAME'])
        resp = table.scan(
            FilterExpression=Attr('entity').eq('game') & Attr('last_updated').gte(cutoff)
        )
        items = resp.get('Items', [])
        items.sort(key=lambda x: x.get('last_updated', 0), reverse=True)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'items': items}, default=str)
        }
    except Exception as e:
        print('Error in list_games handler', e)
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal Server Error'})
        }
