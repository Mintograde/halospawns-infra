import assert from 'node:assert/strict';
import {orderedPool} from './ordered-pool.mjs';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inspectMatchFilm} from './match-film.mjs';
import {fnv1a} from './format3-codec.mjs';
import {readEnvelope} from './adapters/beta6-v3-120.mjs';
import {sha256} from './engine-store.mjs';
import {clientDesyncEvidence} from './client-desync.mjs';
import {clientRosterEvidence} from './client-roster.mjs';
import {unsupportedClientBuild} from './client-build.mjs';
import {profileById,BUILD_MATCHING} from './profiles.mjs';

export async function convertMatchTracks(stage,values,report,convertFilm,deadline) {
  const bytes=await readFile(values.film);
  const match=inspectMatchFilm(bytes);
  assert.equal(match.sha256,report.provenance.film_sha256,'Match film changed');
  const tracks=await orderedPool(match.parts,Number(values['client-concurrency'] ?? 1),async part => {
    const id=`client-${part.index}`,film=join(stage,`${id}.h1film`);
    if(part.rest.flags&1) {
      // Use the pinned upstream restorer for the RNET shared-message representation.
      // Validate its complete result before allowing any simulation or publication.
      const args=['--permission',`--allow-fs-read=${values.film}`,`--allow-fs-read=${dirname(values.engine)}`,
        `--allow-fs-read=${stage}`,
        `--allow-fs-read=${fileURLToPath(new URL('./engine-permissions.mjs',import.meta.url))}`,
        `--allow-fs-write=${film}`,'--import',new URL('./engine-permissions.mjs',import.meta.url).href,
        values.engine,'--film-part-export',values.film,String(part.index),film];
      const timeout=Math.min(60000,Math.floor(deadline-performance.now()));assert.ok(timeout>0,'Match conversion timed out');
      const log=openSync(join(stage,`${id}-restore.log`),'wx');
      try {
        const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore',log,log],timeout,
          env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(BLAMPC_|H1_EXPORT_|AWS_)/i.test(k)))});
        const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
        assert.equal(code,0,'Thin client restoration failed');
      } finally {closeSync(log);}
    } else await writeFile(film,bytes.subarray(part.offset,part.offset+part.size),{flag:'wx'});
    assert.equal((await stat(film)).size,part.rest.whole_size,'Restored client size differs');
    if(part.rest.fnv1a)assert.equal(fnv1a(await readFile(film)),part.rest.fnv1a,'Restored client checksum differs');
    const envelope=await readEnvelope(film,{allowClientView:true});
    assert.equal(envelope.recorded_own_player,part.player,'Recorded client player differs');
    assert.equal(envelope.match_id,match.host.match_id,'Restored client match differs');
    const remaining=(deadline-performance.now())/1000;assert.ok(remaining>1,'Match conversion timed out');
    const track={id,part,envelope,source_film_sha256:await sha256(film)};
    const unsupported=unsupportedClientBuild(envelope,profileById(report.engine_profile),
      report.exporter_revision,BUILD_MATCHING[report.engine_profile]);
    if(unsupported) {
      return {...track,status:'unavailable',failure:unsupported};
    }
    let converted;
    try { converted=await convertFilm({...values,film,output:join(stage,id),analytics:false,reference:undefined,'engine-root':undefined,
      'client-view':true,'embedded-match':true,'analytics-revision':'2','viewer-revision':'5',timeout:String(remaining)});
    } catch(error) {
      const failure=(report.exporter_revision>=16 && clientDesyncEvidence(error))
        || (report.exporter_revision>=18 && clientRosterEvidence(error));
      if(!failure)throw error;
      assert.equal(await sha256(film),track.source_film_sha256,'Client source changed');
      return {...track,status:'unavailable',failure};
    }
    assert.equal(converted.provenance.map_sha256,report.provenance.map_sha256);
    for(const key of ['wasm_sha256','glue_sha256'])assert.equal(converted.provenance[key],report.provenance[key]);
    return {...track,...(report.exporter_revision>=16?{status:'available'}:{}),verification:converted.simulation,
      world:`${id}/candidate/replay.120hz.hsrdc`,world_sha256:converted.encoding['120hz'].sha256};
  });
  const result={schema:'halospawns.h1MatchTracks.v1',source_film_sha256:match.sha256,match_id:match.host.match_id,
    version:match.version,tracks};
  await writeFile(join(stage,'match-tracks.json'),JSON.stringify(result),{flag:'wx'});
  return {schema:result.schema,match_id:result.match_id,client_count:tracks.length,
    ...(report.exporter_revision>=16?{unavailable_client_count:tracks.filter(t=>t.status==='unavailable').length}:{})};
}
