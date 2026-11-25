import assert from 'node:assert/strict';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {LambdaClient,InvokeCommand} from '@aws-sdk/client-lambda';
import {decodeReplayDeltaChunk} from './replayDeltaCodec.mjs';
import {audit} from './lambda/pb2_idle_worker/audit.mjs';
import {inputProfiles} from './lambda/pb2_idle_worker/profiles.mjs';

const s3 = new S3Client(), service = new LambdaClient();
async function control(schema, operation, fields = {}) {
  const response = await service.send(new InvokeCommand({FunctionName:process.env.API_ALIAS,
    Payload:Buffer.from(JSON.stringify({schema,operation,...fields}))}));
  assert.ok(!response.FunctionError,'Idle audit control failed');
  return JSON.parse(Buffer.from(response.Payload));
}

function reader(ref) {
  assert.ok(ref.s3_bucket === process.env.UPLOADS_BUCKET && ref.s3_version_id && ref.s3_version_id !== 'null');
  return async (at,n) => {
    assert.ok(Number.isSafeInteger(at) && Number.isSafeInteger(n) && at>=0 && n>0
      && n<=512*1024*1024 && at+n<=ref.size_bytes);
    const range = `bytes=${at}-${at+n-1}`;
    const r = await s3.send(new GetObjectCommand({Bucket:ref.s3_bucket,Key:ref.s3_key,
      VersionId:ref.s3_version_id,Range:range}));
    assert.equal(r.ContentRange,`bytes ${at}-${at+n-1}/${ref.size_bytes}`);
    assert.equal(r.VersionId,ref.s3_version_id);
    assert.equal(r.ContentLength,n);
    const bytes = Buffer.from(await r.Body.transformToByteArray());
    assert.equal(bytes.length,n);
    return bytes;
  };
}

async function run(context, schema, inspect, deadline, batchSize) {
  let checked = 0, failures = 0;
  while (context.getRemainingTimeInMillis() > deadline) {
    const {jobs} = await control(schema,'claim',{limit:batchSize});
    if (!jobs.length) break;
    for (const job of jobs) {
      if (context.getRemainingTimeInMillis() < 30000) return {checked,failures};
      try {
        const evidence = await inspect(job);
        const response = await control(schema,'complete',{lease:job.lease,evidence});
        if (response.accepted) checked++;
      } catch (error) {
        failures++;
        console.error(schema,job.game_id,error.name,error.message);
        await control(schema,'retry',{lease:job.lease});
      }
    }
  }
  return {checked,failures};
}

export async function handler(event,context) {
  const idle = event?.task === 'inputs' ? {checked:0,failures:0} :
    await run(context,'halospawns.pb2IdleAudit.v1',
      job => audit(job,reader(job.film),reader(job.viewer),decodeReplayDeltaChunk),90000,4);
  const inputs = await run(context,'halospawns.pb2PlayerInputs.v1',
    job => inputProfiles(job,reader(job.film)),60000,4);
  return {...idle,inputs};
}
