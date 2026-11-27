import assert from 'node:assert/strict';
import {S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3';
import {LambdaClient, InvokeCommand} from '@aws-sdk/client-lambda';
import * as codec from './replayDeltaCodec.mjs';
import {cutClip, sha} from './lambda/replay_clips/cut.mjs';

const s3 = new S3Client(), api = new LambdaClient();
const bucket = process.env.UPLOADS_BUCKET;
async function control(operation, fields = {}) {
  const response = await api.send(new InvokeCommand({FunctionName:process.env.API_ALIAS,
    Payload:Buffer.from(JSON.stringify({schema:'halospawns.replayClips.v1',operation,...fields}))}));
  assert.ok(!response.FunctionError, 'Clip API operation failed: '+operation);
  return JSON.parse(Buffer.from(response.Payload));
}

async function objectReader(ref) {
  assert.ok(ref.s3_bucket === bucket && ref.s3_key.startsWith(process.env.VIEWER_PREFIX+'/')
    && !ref.s3_key.includes('/clips/') && ref.size_bytes <= 512*1024*1024);
  const location = {Bucket:bucket,Key:ref.s3_key};
  if (ref.s3_version_id) location.VersionId = ref.s3_version_id;
  else {
    // Earlier Xbox generations can omit a version. Bind all subsequent ranges
    // to a single version, verifying the stored producer digest before use.
    const head = await s3.send(new HeadObjectCommand(location));
    assert.ok(head.VersionId && head.ContentLength === ref.size_bytes);
    location.VersionId = head.VersionId;
    if (head.Metadata?.sha256 !== ref.sha256) {
      const pinned = await s3.send(new GetObjectCommand(location));
      const {createHash} = await import('node:crypto');
      const digest = createHash('sha256');
      for await (const part of pinned.Body) digest.update(part);
      assert.equal(digest.digest('hex'),ref.sha256);
    }
  }
  return async (at,n) => {
    assert.ok(Number.isSafeInteger(at) && Number.isSafeInteger(n) && at>=0 && n>0
      && n<=64*1024*1024 && at+n<=ref.size_bytes);
    const r = await s3.send(new GetObjectCommand({...location,Range:`bytes=${at}-${at+n-1}`}));
    assert.equal(r.ContentRange,`bytes ${at}-${at+n-1}/${ref.size_bytes}`);
    assert.equal(r.VersionId,location.VersionId);
    const bytes = Buffer.from(await r.Body.transformToByteArray());
    assert.equal(bytes.length,n);
    return bytes;
  };
}

async function extract(job) {
  const read = await objectReader(job.source);
  const {body,...proof} = await cutClip(job,read,codec,objectReader);
  const hash = sha(body), key = process.env.VIEWER_PREFIX+'/clips/v1/'+hash+'.hsrv';
  const dest = {Bucket:bucket,Key:key};
  let version;
  try {
    const written = await s3.send(new PutObjectCommand({...dest,Body:body,IfNoneMatch:'*',
      ContentType:'application/vnd.halospawns.replay-delta',CacheControl:'public,max-age=31536000,immutable',
      ChecksumSHA256:Buffer.from(hash,'hex').toString('base64'),Metadata:{sha256:hash}}));
    version = written.VersionId;
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 412) throw error;
    const head = await s3.send(new HeadObjectCommand(dest));
    assert.equal(head.Metadata?.sha256,hash);
    assert.equal(head.ContentLength,body.length);
    version = head.VersionId;
  }
  assert.ok(version && version !== 'null');
  return {...proof,sha256:hash,size_bytes:body.length,version_id:version};
}

export async function handler(event, context) {
  const id = event.id;
  if (!id && !event.build_only) await control('discover',{limit:16});
  let ready = 0, failures = 0;
  while (context.getRemainingTimeInMillis() > 45000) {
    const {job} = await control('claim',id ? {id} : {});
    if (!job) break;
    try {
      const product = await extract(job);
      const result = await control('complete',{lease:job.lease,product});
      if (result.accepted) ready++;
    } catch (error) {
      console.error('Clip extraction failed',job.id,error.name,error.message);
      await control('retry',{lease:job.lease});
      failures++;
    }
    if (id) break;
  }
  return {ready,failures};
}
