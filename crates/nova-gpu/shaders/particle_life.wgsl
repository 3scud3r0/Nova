struct Particle {p:vec4<f32>,v:vec4<f32>,phenotype:vec4<u32>,genome:vec4<u32>}
struct Params {counts:vec4<u32>,law:vec4<f32>,extra:vec4<f32>,matrix:array<vec4<f32>,16>}
@group(0) @binding(0) var<storage,read> src:array<Particle>;
@group(0) @binding(1) var<storage,read_write> dst:array<Particle>;
@group(0) @binding(2) var<storage,read> ranges:array<vec2<u32>>;
@group(0) @binding(3) var<storage,read> neighbors:array<u32>;
@group(0) @binding(4) var<uniform> cfg:Params;
fn vortex(p:vec3<f32>,t:f32)->vec3<f32>{
 return vec3(sin(p.x+.7*t)*cos(p.y)-sin(p.x)*cos(p.z+.3*t),sin(p.y+.9*t)*cos(p.z)-sin(p.y)*cos(p.x+.7*t),sin(p.z+.3*t)*cos(p.x)-sin(p.z)*cos(p.y+.9*t));
}
@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=cfg.counts.x){return;}
 let a=src[i];var force=vec3(0.);let range=ranges[i];
 for(var k=range.x;k<range.y;k++){
  let j=neighbors[k];if(i==j){continue;}
  let b=src[j];let d=b.p.xyz-a.p.xyz;let distance=length(d);
  if(distance>=cfg.law.y){continue;}
  let q=distance/cfg.law.y;let index=a.phenotype.x*8u+b.phenotype.x;
  let affinity=cfg.matrix[index/4u][index%4u];
  var f=affinity*(1.-abs(2.*q-1.-cfg.law.z)/(1.-cfg.law.z));
  if(q<cfg.law.z){f=q/cfg.law.z-1.;}
  var direction=d/max(distance,1e-9);
  if(distance<1e-9){direction=vec3(select(-1.,1.,i<j),0.,0.);}
  force+=direction*f*cfg.law.w;
 }
 var out=a;
 out.v=vec4((a.v.xyz+cfg.law.x*(force+cfg.extra.y*vortex(a.p.xyz,cfg.extra.z))/a.v.w)*exp(-cfg.extra.x*cfg.law.x),a.v.w);
 out.p=vec4(a.p.xyz+cfg.law.x*out.v.xyz,a.p.w);dst[i]=out;
}
