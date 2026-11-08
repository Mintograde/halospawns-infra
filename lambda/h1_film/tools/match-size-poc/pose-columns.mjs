import assert from 'node:assert/strict';

// Lossless transform of the existing pose wire bytes: transpose varint payloads
// into byte planes without changing a single quantized pose channel.
export function encodePoseColumns(raw) {
  let at=0;
  const u8=()=>raw[at++],u16=()=>{const v=raw.readUInt16LE(at);at+=2;return v;};
  const count=u16(),runs=[],blocks=[];let offset=0;
  const save=b=>{blocks.push(b);const p=[offset,b.length];offset+=b.length;return p;};
  for(let i=0;i<count;i++) {
    const first=u16(),player=u8(),frames=u16(),bones=u8(),parents=Array.from(raw.subarray(at,at+bones));at+=bones;
    const channels=[];
    for(let j=0;j<bones*8;j++) {
      const mode=u8(),initial=raw.readInt32LE(at);at+=4;assert.ok(mode<=2);
      if(mode===0){channels.push([mode,initial]);continue;}
      const values=[];let max=0;
      for(let f=1;f<frames;f++) {
        let value=0,mul=1,byte;
        do {byte=u8();value+=(byte&127)*mul;mul*=128;assert.ok(mul<=2**56);}while(byte&128);
        assert.ok(Number.isSafeInteger(value)&&value<=0xffffffff);values.push(value);max=Math.max(max,value);
      }
      const width=Math.max(1,Math.ceil((32-Math.clz32(max))/8)),bytes=Buffer.alloc(values.length*width);
      values.forEach((v,k)=>{for(let p=0;p<width;p++)bytes[p*values.length+k]=(v>>>(p*8))&255;});
      channels.push([mode,initial,width,save(bytes)]);
    }
    const start=at,rawCount=u16();at+=rawCount*(2+bones*13*8);assert.ok(at<=raw.length);
    runs.push({first,player,frames,bones,parents,channels,fallback:save(raw.subarray(start,at))});
  }
  assert.equal(at,raw.length);const head=Buffer.from(JSON.stringify(runs)),size=Buffer.alloc(4);size.writeUInt32LE(head.length);
  return Buffer.concat([size,head,...blocks]);
}

export function decodePoseColumns(raw) {
  const n=raw.readUInt32LE(),runs=JSON.parse(raw.subarray(4,4+n)),data=raw.subarray(4+n),pieces=[];
  const count=Buffer.alloc(2);count.writeUInt16LE(runs.length);pieces.push(count);
  const take=([at,n])=>{assert.ok(at>=0&&n>=0&&at+n<=data.length);return data.subarray(at,at+n);};
  for(const r of runs) {
    const head=Buffer.alloc(6+r.bones);head.writeUInt16LE(r.first);head[2]=r.player;head.writeUInt16LE(r.frames,3);head[5]=r.bones;head.set(r.parents,6);pieces.push(head);
    for(const [mode,initial,width,position] of r.channels) {
      const head=Buffer.alloc(5);head[0]=mode;head.writeInt32LE(initial,1);pieces.push(head);
      if(!mode)continue;
      const bytes=take(position),values=Buffer.alloc((r.frames-1)*5);let at=0;
      for(let f=0;f<r.frames-1;f++) {
        let value=0;for(let p=0;p<width;p++)value+=bytes[p*(r.frames-1)+f]*2**(8*p);
        while(value>=128){values[at++]=(value%128)|128;value=Math.floor(value/128);}values[at++]=value;
      }
      pieces.push(values.subarray(0,at));
    }
    pieces.push(take(r.fallback));
  }
  return Buffer.concat(pieces);
}

export function poseRuns(raw) {
  const transformed=encodePoseColumns(raw),n=transformed.readUInt32LE(),runs=JSON.parse(transformed.subarray(4,4+n)),data=transformed.subarray(4+n);
  return runs.map(r=>({...r,modes:r.channels.map(c=>c[0]),fallback:Buffer.from(data.subarray(r.fallback[0],r.fallback[0]+r.fallback[1])),channels:r.channels.map(([mode,initial,width,range])=>{
    const values=new Int32Array(r.frames);values[0]=initial;let delta=0;
    for(let i=1;i<r.frames;i++){
      let value=0;if(mode){for(let p=0;p<width;p++)value+=data[range[0]+p*(r.frames-1)+i-1]*2**(8*p);const d=(value>>>1)^-(value&1);delta=mode===1?d:delta+d;}
      values[i]=values[i-1]+delta;
    }return values;
  })}));
}

export function serializePoseRuns(runs) {
  const pieces=[],count=Buffer.alloc(2);count.writeUInt16LE(runs.length);pieces.push(count);
  for(const r of runs) {
    const head=Buffer.alloc(6+r.bones);head.writeUInt16LE(r.first);head[2]=r.player;head.writeUInt16LE(r.frames,3);head[5]=r.bones;head.set(r.parents,6);pieces.push(head);
    r.channels.forEach((values,j)=>{
      const mode=r.modes[j],head=Buffer.alloc(5);head[0]=mode;head.writeInt32LE(values[0],1);pieces.push(head);
      if(!mode){assert.ok(values.every(v=>v===values[0]));return;}
      const bytes=Buffer.alloc((r.frames-1)*6);let at=0,last=0;
      for(let i=1;i<r.frames;i++){
        const delta=values[i]-values[i-1],signed=mode===1?delta:delta-last;last=delta;
        let value=signed>=0?signed*2:-signed*2-1;
        while(value>=128){bytes[at++]=(value%128)|128;value=Math.floor(value/128);}bytes[at++]=value;
      }pieces.push(bytes.subarray(0,at));
    });pieces.push(r.fallback);
  }
  return Buffer.concat(pieces);
}
