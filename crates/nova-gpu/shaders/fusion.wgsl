// SPDX-License-Identifier: AGPL-3.0-or-later
// Native NOVA fusion kernels; PAR force/alignment adaptation, MIT force-law ports.
// Cell density-feedback formula is an independent implementation, not copied CellFlow source.
struct Particle {p:vec4<f32>,v:vec4<f32>,phenotype:vec4<u32>,genome:vec4<u32>}
struct Params {
 counts:vec4<u32>,domain:vec4<f32>,dynamics:vec4<f32>,limits:vec4<f32>,
 step:vec4<u32>,cell:vec4<f32>,feedback:vec4<f32>,brush:vec4<f32>,brush_radius:vec4<f32>,
 matrix:array<vec4<f32>,16>,inner:array<vec4<f32>,16>,outer:array<vec4<f32>,16>,masses:array<vec4<f32>,2>
}
@group(0) @binding(0) var<storage,read> src:array<Particle>;
@group(0) @binding(1) var<storage,read_write> dst:array<Particle>;
@group(0) @binding(2) var<storage,read> ranges:array<vec2<u32>>;
@group(0) @binding(3) var<storage,read> neighbors:array<u32>;
@group(0) @binding(4) var<uniform> cfg:Params;
fn difference(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{
 var d=b-a;if(cfg.counts.w==1u){let size=2.*cfg.domain.xyz;d=d-size*round(d/size);}
 if(cfg.counts.z==2u){d.z=0.;}return d;
}
fn hash(value:u32)->u32 {let x=value*747796405u+2891336453u;let y=((x>>((x>>28u)+4u))^x)*277803737u;return (y>>22u)^y;}
fn thermal(id:u32,k:u32)->f32{return f32(hash(id+cfg.step.x*74839u+k*7919u))/4294967295.-.5;}
@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) gid:vec3<u32>){
 let i=gid.x;if(i>=cfg.counts.x){return;}
 let a=src[i];let range=ranges[i];let family=cfg.counts.y;let dimensions=cfg.counts.z;
 var force=vec3(0.);var alignment=vec3(0.);var weight=0.;var count=0u;
 let epsilon=select(.0001,1e-10,family==1u);
 for(var cursor=range.x;cursor<range.y;cursor++){
  let j=neighbors[cursor];if(j==i){continue;}
  let other=src[j];let d=difference(a.p.xyz,other.p.xyz);let d2=dot(d,d);
  let key=a.phenotype.x*8u+other.phenotype.x;
  let lo=cfg.inner[key/4u][key%4u];let hi=cfg.outer[key/4u][key%4u];
  if(d2<epsilon||d2>=hi*hi){continue;}
  count+=1u;let distance=sqrt(d2);let affinity=cfg.matrix[key/4u][key%4u];var f=0.;
  if(family==0u){f=-affinity;}
  else if(family==5u){let q=distance/hi;f=affinity*(cfg.cell.x/(1.+pow(cfg.cell.z*q,2.))-cfg.cell.y*q*q);}
  else if(distance<lo){f=(distance/lo-1.)*cfg.dynamics.z;}
  else{f=affinity*(1.-abs(2.*distance-lo-hi)/(hi-lo));}
  force+=d/distance*f;
  if(cfg.dynamics.w>0.&&distance>=lo){let w=1.-(distance-lo)/(hi-lo);alignment+=(other.v.xyz-a.v.xyz)*w;weight+=w;}
 }
 if(weight>0.){force+=cfg.dynamics.w*alignment/weight;}
 let checked=f32(range.y-range.x-1u);var scale=1.;if(cfg.limits.z>0.&&checked>cfg.limits.z){scale=cfg.limits.z/checked;}
 var adaptive=1.;if(family==5u){let occupancy=clamp(f32(a.phenotype.z)/cfg.feedback.x,0.,1.);adaptive=1.+3.*cfg.cell.w-3.99*cfg.cell.w*occupancy;}
 let mass=cfg.masses[a.phenotype.x/4u][a.phenotype.x%4u];
 let dt=cfg.domain.w;let retention=cfg.dynamics.y;
 let kick=select(cfg.dynamics.x*dt,cfg.dynamics.x,family==0u||family==3u);
 let acceleration=force*(kick*scale*adaptive/mass);
 var velocity=(a.v.xyz+acceleration)*retention;
 if(family==2u||family==5u){velocity=a.v.xyz*retention+acceleration;}
 if(cfg.limits.y>0.){for(var k=0u;k<dimensions;k++){velocity[k]+=thermal(a.genome.x,k)*cfg.limits.y;}}
 if(cfg.brush_radius.x>0.){let d=difference(a.p.xyz,cfg.brush.xyz);let distance=length(d);if(distance>1e-6&&distance<cfg.brush_radius.x){velocity+=d/distance*cfg.brush.w*(1.-distance/cfg.brush_radius.x)*dt;}}
 let speed=length(velocity);var flags=select(0u,2u,scale<1.);
 if(cfg.limits.x>0.&&speed>cfg.limits.x){velocity*=cfg.limits.x/speed;flags|=1u;}
 var position=a.p.xyz+dt*velocity;
 for(var k=0u;k<dimensions;k++){
  let half=cfg.domain[k];let width=2.*half;
  if(cfg.counts.w==1u){position[k]=(position[k]+half)-width*floor((position[k]+half)/width)-half;}
  if(cfg.counts.w==2u){let t=position[k]+half;let q=t-2.*width*floor(t/(2.*width));if(q>width){position[k]=2.*width-q-half;velocity[k]=-velocity[k];}else{position[k]=q-half;}}
 }
 var result=a;result.p=vec4(position,a.p.w);result.v=vec4(velocity,a.v.w);result.phenotype.y=flags;result.phenotype.z=count;dst[i]=result;
}
