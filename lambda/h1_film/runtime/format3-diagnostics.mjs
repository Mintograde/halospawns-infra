import assert from 'node:assert/strict';
import {unpackMszip} from './adapters/beta5-v2-120.mjs';
import {TABLES,decodeDiagnosticRow} from './diagnostics-codec.mjs';

export function unpackRowColumns(bytes,count,stride,keyOffset,keySize=1) {
  assert.ok(Number.isSafeInteger(count)&&count>=0&&count*stride===bytes.length,'Invalid diagnostic columns');
  assert.ok(keySize>=1&&keySize<=4&&keyOffset>=0&&keyOffset+keySize<=stride,'Invalid diagnostic key');
  const result=Buffer.alloc(bytes.length),previous=new Map();
  for(let row=0;row<count;row++) {
    const out=result.subarray(row*stride,(row+1)*stride);
    for(let j=0;j<stride;j++) out[j]=bytes[j*count+row];
    const key=out.readUIntLE(keyOffset,keySize),last=previous.get(key);
    if(last) for(let j=0;j<stride;j++) if(j<keyOffset||j>=keyOffset+keySize) out[j]^=last[j];
    previous.set(key,out);
  }
  return result;
}

// Expand the recorded LDC1 v12 tables to the same typed rows as the v11 reader.
// Original bytes remain available to the caller for lossless archive storage.
export function readClientAccount(bytes) {
  assert.ok(bytes.length>=160&&bytes.length<=128*1024*1024,'Invalid client account size');
  const u=n=>bytes.readUInt32LE(n);
  assert.ok(u(0)===0x3143444c&&u(4)===12&&u(8)===160&&u(20)===14,'Unsupported client account');
  const tables=[];let at=160;
  for(let i=0;i<14;i++) {
    const count=u(48+i*8),stride=u(52+i*8),expected=i===13?1:TABLES.client[i][1];
    assert.equal(stride,expected,'Invalid client table stride');
    assert.ok(count*stride<=128*1024*1024&&at+count*stride<=bytes.length,'Truncated client table');
    tables.push({count,stride,bytes:bytes.subarray(at,at+count*stride)});at+=count*stride;
  }
  assert.equal(at,bytes.length,'Trailing client account data');
  const packed=tables[13].bytes;
  assert.equal(tables[5].count,0);assert.equal(tables[6].count,0);
  if(packed.length) {
    assert.ok(packed.length>=16,'Truncated packed diagnostic header');
    const aim=packed.readUInt32LE(0),seen=packed.readUInt32LE(4),size=packed.readUInt32LE(8),flags=packed.readUInt32LE(12);
    assert.ok(aim<=1<<19&&seen<=1<<20&&flags<=1&&size===(aim+seen)*28,'Invalid packed diagnostic size');
    const raw=flags?unpackMszip(packed.subarray(16),size):packed.subarray(16);
    assert.equal(raw.length,size,'Packed diagnostic length mismatch');
    tables[5]={count:aim,stride:28,bytes:unpackRowColumns(raw.subarray(0,aim*28),aim,28,26)};
    tables[6]={count:seen,stride:28,bytes:unpackRowColumns(raw.subarray(aim*28),seen,28,22)};
  }
  const own=bytes.readInt32LE(28);
  assert.ok(own>=0&&own<16,'Invalid diagnostic recording player');
  return {version:12,flags:u(12),clock_period:u(16),own_machine_slot:bytes.readInt32LE(24),own_player:own,
    host_rules:{tolerance:Number.isFinite(bytes.readFloatLE(32))?bytes.readFloatLE(32):null,
      steps:u(36),refusal_codes_version:u(40)},
    last_verdict_host_tick:bytes.readInt32LE(44),
    tables:tables.slice(0,13).map((t,i)=>({...t,name:TABLES.client[i][0],capped:Boolean(u(12)&(1<<i))}))};
}

export function decodeAccountRows(account,name) {
  const table=account.tables.find(t=>t.name===name);assert.ok(table,'Unknown account table');
  return Array.from({length:table.count},(_,i)=>decodeDiagnosticRow('client',name,table.bytes.subarray(i*table.stride,(i+1)*table.stride),i));
}

export function readHostLedger(bytes,matchId) {
  assert.ok(bytes.length>=88&&bytes.length<=128*1024*1024,'Invalid host ledger size');
  const u=n=>bytes.readUInt32LE(n);
  assert.ok(u(0)===0x3147444c&&u(4)===5&&u(8)===88&&u(28)===5,'Unsupported host ledger');
  assert.equal(bytes.readBigUInt64LE(16).toString(16).padStart(16,'0'),matchId,'Ledger match differs');
  const tables=[];let at=88;
  for(let i=0;i<5;i++) {
    const [name,stride]=TABLES.ledger[i],count=u(32+i*8);
    assert.ok(count<=65536&&u(36+i*8)===stride&&at+count*stride<=bytes.length,'Invalid ledger table');
    tables.push({name,count,stride,bytes:bytes.subarray(at,at+count*stride),capped:Boolean(u(12)&(1<<i))});
    at+=count*stride;
  }
  assert.equal(at,bytes.length,'Trailing host ledger data');
  return {version:5,flags:u(12),clock_period:u(24),tables};
}
