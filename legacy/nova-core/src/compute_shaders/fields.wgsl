// Periodic 3D, nondimensional f32 model. Each invocation writes one cell.
struct Cell { chem: vec4<f32>, flow: vec4<f32>, aux: vec4<f32> }
struct Params { n:u32, stage:u32, dt:f32, feed:f32, kill:f32, du:f32, dv:f32, viscosity:f32, speed:f32, damping:f32, row_stride:u32, pad1:f32 }
@group(0) @binding(0) var<storage,read> src:array<Cell>;
@group(0) @binding(1) var<storage,read_write> dst:array<Cell>;
@group(0) @binding(2) var<uniform> cfg:Params;
fn index(p:vec3<i32>)->u32 { let n=i32(cfg.n);let a=((p%vec3(n))+vec3(n))%vec3(n);return u32((a.z*n+a.y)*n+a.x); }
fn at(p:vec3<i32>)->Cell {return src[index(p)];}
fn sample_flow(q:vec3<f32>)->vec4<f32> {let lo=vec3<i32>(floor(q));let f=fract(q);var out=vec4(0.);for(var z=0;z<2;z++){for(var y=0;y<2;y++){for(var x=0;x<2;x++){let d=vec3(x,y,z);let w=select(vec3(1.)-f,f,d==vec3(1));out+=at(lo+d).flow*w.x*w.y*w.z;}}}return out;}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x+gid.y*cfg.row_stride;let n=cfg.n;if(i>=n*n*n){return;}let p=vec3<i32>(i32(i%n),i32((i/n)%n),i32(i/(n*n)));let c=src[i];let ex=vec3(1,0,0);let ey=vec3(0,1,0);let ez=vec3(0,0,1);var out=c;
let xp=at(p+ex);let xm=at(p-ex);let yp=at(p+ey);let ym=at(p-ey);let zp=at(p+ez);let zm=at(p-ez);
if(cfg.stage==0u){let lap=xp.chem+xm.chem+yp.chem+ym.chem+zp.chem+zm.chem-6.*c.chem;let reaction=c.chem.x*c.chem.y*c.chem.y;out.chem.x=clamp(c.chem.x+cfg.dt*(cfg.du*lap.x-reaction+cfg.feed*(1.-c.chem.x)),0.,1.);out.chem.y=clamp(c.chem.y+cfg.dt*(cfg.dv*lap.y+reaction-(cfg.feed+cfg.kill)*c.chem.y),0.,1.);out.chem.w=c.chem.w+cfg.dt*(cfg.speed*cfg.speed*lap.z-cfg.damping*c.chem.w);out.chem.z=c.chem.z+cfg.dt*out.chem.w;
}else if(cfg.stage==1u){let advected=sample_flow(vec3<f32>(p)-cfg.dt*c.flow.xyz);let lap=xp.flow+xm.flow+yp.flow+ym.flow+zp.flow+zm.flow-6.*c.flow;out.flow=advected+cfg.dt*cfg.viscosity*lap;
}else if(cfg.stage==2u){out.aux.x=0.;out.aux.y=(c.flow.x-xm.flow.x+c.flow.y-ym.flow.y+c.flow.z-zm.flow.z)/cfg.dt;
}else if(cfg.stage==3u){out.aux.x=(xp.aux.x+xm.aux.x+yp.aux.x+ym.aux.x+zp.aux.x+zm.aux.x-c.aux.y)/6.;
}else if(cfg.stage==4u){out.flow.x-=cfg.dt*(xp.aux.x-c.aux.x);out.flow.y-=cfg.dt*(yp.aux.x-c.aux.x);out.flow.z-=cfg.dt*(zp.aux.x-c.aux.x);}
dst[i]=out;}
