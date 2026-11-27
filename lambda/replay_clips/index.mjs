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
  const stored = await storeImmutable(body, 'v1', '.hsrv', 'application/vnd.halospawns.replay-delta');
  return {...proof,...stored};
}

async function storeImmutable(body, folder, extension, contentType) {
  const hash = sha(body), key = process.env.VIEWER_PREFIX+'/clips/'+folder+'/'+hash+extension;
  const dest = {Bucket:bucket,Key:key};
  let version;
  try {
    const written = await s3.send(new PutObjectCommand({...dest,Body:body,IfNoneMatch:'*',
      ContentType:contentType,CacheControl:'public,max-age=31536000,immutable',
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
  return {sha256:hash,size_bytes:body.length,version_id:version};
}

async function renderThumbnail(job) {
  const response = await api.send(new InvokeCommand({FunctionName:process.env.THUMBNAIL_RENDERER,
    Payload:Buffer.from(JSON.stringify({...job,schema:'halospawns.clipThumbnail.v1'}))}));
  const result = JSON.parse(Buffer.from(response.Payload));
  if (response.FunctionError) throw new Error('Clip renderer: '+result.errorMessage);
  const {image,player_name,...proof} = result;
  assert.equal(player_name,job.player_name);
  assert.equal(proof.player_slot,job.player_slot);
  assert.equal(proof.source_sha256,job.asset.sha256);
  assert.equal(proof.map_sha256,job.source_glb.sha256);
  assert.ok(Number.isInteger(proof.frame) && proof.frame >= 0 && proof.frame < job.asset.tick_count);
  const bytes = Buffer.from(image,'base64');
  assert.ok(bytes.length > 20 && bytes.length <= 1024*1024);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.equal(bytes.readUInt32LE(4),bytes.length-8);
  return {...proof,...await storeImmutable(bytes, 'thumbnails/v1', '.webp', 'image/webp')};
}

async function buildThumbnails(id, context) {
  let ready = 0, failures = 0;
  while (context.getRemainingTimeInMillis() > 125000) {
    const {job} = await control('claim_thumbnail',id ? {id} : {});
    if (!job) break;
    const claim = {id:job.id,lease:job.lease};
    try {
      const product = await renderThumbnail(job);
      const result = await control('complete_thumbnail',{...claim,product});
      if (result.accepted) ready++;
    } catch (error) {
      console.error('Clip thumbnail failed',job.id,error.name,error.message);
      await control('retry_thumbnail',claim);
      failures++;
    }
    if (id) break;
  }
  return {ready,failures};
}

export async function handler(event, context) {
  const id = event.id;
  if (event.thumbnails_only) {
    if (!id && event.backfill === true) {
      // These jobs only wait on the screenshot Lambda. Independent leases let
      // a bounded backfill share the normal writer and leave extraction capacity.
      const batches = await Promise.allSettled(Array.from({length: 3}, () => buildThumbnails(null, context)));
      const failed = batches.find(batch => batch.status === 'rejected');
      if (failed) throw failed.reason;
      return batches.reduce((total, {value}) => ({
        ready: total.ready + value.ready, failures: total.failures + value.failures
      }), {ready: 0, failures: 0});
    }
    return buildThumbnails(id, context);
  }
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
  if (id && process.env.THUMBNAIL_RENDERER) await buildThumbnails(id, context);
  return {ready,failures};
}
