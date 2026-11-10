import assert from 'node:assert/strict';

// Beta 6/7's pinned create_local_players runs before create_remote_players.
// Human host seats therefore occupy the initial prefix; hosted bots are created
// with the remote roster, but (unlike remote humans) have no FNET drop bit.
// Neither lobby bots nor the downloaded film's viewing-player mask proves this.
export function classifyNetworkHost({players,localPlayers,initialDropMask,observedRemoteMask,
  firstTick,initialRosterChanged,initialMaskChanged,rosterEvidence}) {
  if(firstTick!==0 || !Number.isInteger(initialDropMask) || initialDropMask<0
    || initialDropMask>>>players || initialRosterChanged || initialMaskChanged)return;
  const nonremote=Array.from({length:players},(_,slot)=>slot).filter(slot=>!(initialDropMask&(1<<slot)));
  let locals,basis=rosterEvidence?.start??rosterEvidence?.rounds;
  if(basis?.kind==='start_item_v1')locals=nonremote.length-basis.bot_count;
  else if(basis?.kind==='host_rounds_v1') {
    locals=0;
    for(let mask=basis.local_player_mask;mask;mask>>>=1)locals+=mask&1;
    if(basis.local_player_mask!==(1<<locals)-1)return;
  } else if(initialDropMask&1) {
    // A remote slot zero positively excludes an initial human host. This also
    // works on mirrored films, which may omit the optional item directory.
    locals=0;basis={kind:'initial_remote_player_v1'};
  } else return; // One nonremote participant could be a bot, not a human host.
  if(!Number.isInteger(locals)||locals<0||locals>4
    || (locals ? locals!==localPlayers : localPlayers!==1))return;
  if(rosterEvidence?.rounds&&rosterEvidence.rounds.local_player_mask!==(1<<locals)-1)return;
  const hostSlots=Array.from({length:locals},(_,slot)=>slot);
  if(hostSlots.some(slot=>observedRemoteMask&(1<<slot)))return;
  const botSlots=nonremote.filter(slot=>slot>=locals);
  if(nonremote.length!==hostSlots.length+botSlots.length || botSlots.length>15)return;
  return {provenance:'initial_fnet_bot_roster_v1',source_tick:0,initial_player_count:players,
    local_player_count:locals,remote_player_mask:initialDropMask,host_slots:hostSlots,
    bot_slots:botSlots,roster_evidence:basis};
}

async function read(file,at,size) {
  const bytes=Buffer.alloc(size),result=await file.read(bytes,0,size,at);
  assert.equal(result.bytesRead,size,'Truncated film roster evidence');return bytes;
}

// Optional THI1 items start immediately after the trailer's hash samples.
// Bound the directory to the next declared section, including an MTCH host's
// end. Never scan arbitrary bytes for a plausible START/HRS1 signature.
export async function readHostRosterEvidence(file,{at,limit,firstTick,firstHash,players}) {
  if(limit-at<16)return;
  const head=await read(file,at,16);
  if(head.readUInt32LE(0)!==0x31494854)return;
  const headSize=head.readUInt32LE(4),count=head.readUInt32LE(8),size=head.readUInt32LE(12);
  assert.ok(headSize===16&&count>=1&&count<=16&&headSize+count*16<=size&&size<=limit-at,
    'Invalid film item directory');
  const entries=await read(file,at+headSize,count*16),seen=new Set(),ranges=[];
  let start,rounds;
  for(let i=0;i<count;i++) {
    const [kind,version,offset,length]=Array.from({length:4},(_,j)=>entries.readUInt32LE(i*16+j*4));
    assert.ok(!seen.has(kind)&&length>0&&offset>=headSize+count*16&&offset+length<=size,
      'Invalid film item bounds or duplicate kind');
    seen.add(kind);ranges.push([offset,offset+length]);
    if(kind===1&&version===1) {
      assert.ok(length>=24&&length<=1024,'Invalid START size');
      const bytes=await read(file,at+offset,length),rows=bytes.readUInt32LE(4),bots=bytes.readInt32LE(8);
      assert.ok(bytes.readUInt32LE(0)===firstTick&&length===24+rows*8&&bytes.readUInt32LE(12)===0
        &&bots>=0&&bots<=15&&bots<=players,'Invalid START roster');
      const hash=bytes.readBigUInt64LE(16);
      assert.equal(hash,firstHash,'START world hash differs from first recorded sample');
      const keys=new Set();
      for(let j=0;j<rows;j++) {const key=bytes.readUInt32LE(24+j*8);assert.ok(!keys.has(key),'Duplicate START row');keys.add(key);}
      start={kind:'start_item_v1',bot_count:bots,world_hash:hash.toString(16).padStart(16,'0')};
    } else if(kind===3&&version===1) {
      assert.ok(length>=64&&length<=64*1024*1024,'Invalid host rounds size');
      const bytes=await read(file,at+offset,64),mask=bytes.readUInt32LE(20);
      assert.ok(bytes.readUInt32LE(0)===0x31535248&&bytes.readUInt32LE(4)===1
        &&bytes.readUInt32LE(8)===64&&bytes.readUInt32LE(12)===length
        &&bytes.readUInt32LE(16)<=1&&mask>0&&mask>>>players===0
        &&bytes.subarray(52).every(v=>v===0),'Invalid host rounds roster');
      const raw=bytes.readUInt32LE(24)*64+bytes.readUInt32LE(32)*68+bytes.readUInt32LE(40)*16;
      assert.ok(bytes.readUInt32LE(28)===64&&bytes.readUInt32LE(36)===68
        &&bytes.readUInt32LE(44)===16&&raw===bytes.readUInt32LE(48)&&raw<=64*1024*1024
        &&(bytes.readUInt32LE(16)===1||length===64+raw),'Invalid host rounds tables');
      rounds={kind:'host_rounds_v1',local_player_mask:mask};
    }
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<ranges.length;i++)assert.ok(ranges[i-1][1]<=ranges[i][0],'Overlapping film items');
  // START gives the actual created count even when no human fired a round.
  return {start,rounds};
}
