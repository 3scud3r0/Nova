// Integer Moore automata. Native WGSL adaptation of the g3dl/WebGL ping-pong model.
// Licensed source references and modifications are documented in THIRD_PARTY_NOTICES.md.
struct Config {shape:vec4<u32>,rule:vec4<u32>,control:vec4<u32>}
@group(0) @binding(0) var<storage,read> src:array<u32>;
@group(0) @binding(1) var<storage,read_write> dst:array<u32>;
@group(0) @binding(2) var<uniform> cfg:Config;
@group(0) @binding(3) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> living:array<u32>;
fn value(p:vec3<i32>)->u32 {
 let shape=vec3<i32>(cfg.shape.xyz);var q=p;
 if(cfg.rule.w==1u){q=((q%shape)+shape)%shape;}
 else if(any(q<vec3(0))||any(q>=shape)){return 0u;}
 return src[(u32(q.z)*cfg.shape.y+u32(q.y))*cfg.shape.x+u32(q.x)];
}
@compute @workgroup_size(64)
fn evolve(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x+id.y*cfg.control.y;if(i>=cfg.shape.w){return;}
 let x=i%cfg.shape.x;let y=(i/cfg.shape.x)%cfg.shape.y;let z=i/(cfg.shape.x*cfg.shape.y);let p=vec3<i32>(i32(x),i32(y),i32(z));
 let radius=i32(cfg.rule.z);let zr=select(0,radius,cfg.control.x==3u);var total=0u;
 for(var dz=-zr;dz<=zr;dz++){for(var dy=-radius;dy<=radius;dy++){for(var dx=-radius;dx<=radius;dx++){
  if(dx!=0||dy!=0||dz!=0){total+=value(p+vec3(dx,dy,dz));}
 }}}
 let mask=select(cfg.rule.x,cfg.rule.y,src[i]!=0u);let next=(mask>>total)&1u;dst[i]=next;
 atomicAdd(&counters[0],next);atomicAdd(&counters[1],select(0u,1u,next!=src[i]));
}
@compute @workgroup_size(64)
fn compact(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x+id.y*cfg.control.y;if(i<cfg.shape.w&&src[i]!=0u){let slot=atomicAdd(&counters[0],1u);living[slot]=i;}
}
