// NOVA Particle Life + optional finite PBF constraints. All state stays on GPU.
struct Particle {
    p:vec4<f32>, v:vec4<f32>, previous:vec4<f32>
}
struct Sim {
    counts:vec4<u32>, dynamics:vec4<f32>, fluid:vec4<f32>, art:vec4<f32>, extra:vec4<f32>
}
@group(0) @binding(0) var<storage,read> src:array<Particle>;
@group(0) @binding(1) var<storage,read_write> dst:array<Particle>;
@group(0) @binding(2) var<storage,read_write> heads:array<atomic<i32>>;
@group(0) @binding(3) var<storage,read_write> links:array<i32>;
@group(0) @binding(4) var<storage,read_write> density:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read> affinity:array<f32>;
@group(0) @binding(6) var<storage,read_write> stats:array<atomic<u32>>;
@group(0) @binding(7) var<uniform> cfg:Sim;
fn wrap(p:vec3<f32>)->vec3<f32>{
    return p-2.*floor((p+1.)/2.);
}
fn delta(a:vec3<f32>,b:vec3<f32>)->vec3<f32>{
    return wrap(a-b);
}
fn cell(p:vec3<f32>)->vec3<i32>{
    return vec3<i32>(floor((wrap(p)+1.)*.5*f32(cfg.counts.y)));
}
fn key(p:vec3<i32>)->u32{
    let n=i32(cfg.counts.y);
    let q=((p%vec3(n))+vec3(n))%vec3(n);
    return u32((q.z*n+q.y)*n+q.x);
}
fn weight(r2:f32)->f32{
    let h=cfg.dynamics.y;
    let q=max(h*h-r2,0.);
    return 315./(64.*3.14159265*pow(h,9.))*q*q*q;
}
fn gradient(d:vec3<f32>)->vec3<f32>{
    let r=length(d);
    let h=cfg.dynamics.y;
    if(r<1e-6||r>=h){
        return vec3(0.);
    }
    return -45./(3.14159265*pow(h,6.))*(h-r)*(h-r)*d/r;
}
fn neighbor_cell(c:vec3<i32>,k:i32)->u32{
    return key(c+vec3(k%3-1,(k/3)%3-1,k/9-1));
}
@compute @workgroup_size(64)
fn clear_grid(@builtin(global_invocation_id) id:vec3<u32>){
    let i=id.x;
    let n=cfg.counts.y;
    if(i<n*n*n){
        atomicStore(&heads[i],-1);
    }
}
@compute @workgroup_size(64)
fn clear_stats(@builtin(global_invocation_id) id:vec3<u32>){
    if(id.x<4u){
        atomicStore(&stats[id.x],0u);
    }
}
@compute @workgroup_size(64)
fn build_grid(@builtin(global_invocation_id) id:vec3<u32>){
    let i=id.x;
    if(i>=cfg.counts.x){
        return;
    }
    links[i]=atomicExchange(&heads[key(cell(src[i].p.xyz))],i32(i));
}
@compute @workgroup_size(64)
fn predict(@builtin(global_invocation_id) id:vec3<u32>){
    let i=id.x;
    if(i>=cfg.counts.x){
        return;
    }
    let old=src[i];
    let c=cell(old.p.xyz);
    let h=cfg.dynamics.y;
    var force=vec3(0.);
    var viscous=vec3(0.);
    var shear=0.;
    var neighbors=0.;
    var visited=0u;
    var truncated=false;
    for(var k=0;k<27;k++){
        var j=atomicLoad(&heads[neighbor_cell(c,k)]);
        loop{
            if(j<0){
                break;
            }
            if(visited>=cfg.counts.w){
                truncated=true;
                break;
            }
            visited++;
            let other=src[u32(j)];
            if(u32(j)!=i){
                let d=delta(other.p.xyz,old.p.xyz);
                let r=length(d);
                if(r>1e-5&&r<h){
                    let q=r/h;
                    let a=affinity[u32(old.p.w)*8u+u32(other.p.w)];
                    let beta=cfg.extra.x;
                    var f=q/beta-1.;
                    if(q>=beta){
                        f=a*(1.-abs(2.*q-1.-beta)/(1.-beta));
                    }
                    force+=d/r*f;
                    let w=1.-q;
                    viscous+=(other.v.xyz-old.v.xyz)*w;
                    shear+=length(other.v.xyz-old.v.xyz)*w/max(r,.01);
                    neighbors+=1.;
                }
            }
            j=links[u32(j)];
        }
        if(truncated){
            break;
        }
    }
    if(truncated){
        atomicAdd(&stats[0],1u);
    }
    if(cfg.extra.y>.5){
        force/=max(neighbors,1.);
    }
    viscous/=max(neighbors,1.);
    shear/=max(neighbors,1.);
    let dt=cfg.dynamics.x;
    let structure=(old.v.w+dt*.5)/(1.+dt*(.5+shear));
    let eta=clamp(cfg.fluid.w+cfg.art.w*structure/(.05+shear),0.,2.);
    let p=old.p.xyz;
    let t=f32(cfg.counts.z)*dt;
    let curl=vec3(sin(2.*p.z+t*.2)+cos(2.*p.y),sin(2.*p.x)+cos(2.*p.z+t*.2),sin(2.*p.y)+cos(2.*p.x));
    force=cfg.dynamics.z*force+eta*viscous+cfg.art.x*curl+vec3(0.,cfg.art.y,0.)-cfg.art.z*p*max(dot(p,p)-.64,0.);
    var velocity=(old.v.xyz+dt*force)*exp(-cfg.dynamics.w*dt);
    let speed=length(velocity);
    if(speed>cfg.extra.z){
        velocity*=cfg.extra.z/speed;
        atomicAdd(&stats[1],1u);
    }
    var out=old;
    out.previous=old.p;
    if(cfg.extra.w>.5){
        velocity.z=0.;
        out.previous.z=0.;
    }
    out.p=vec4(wrap(p+dt*velocity),old.p.w);
    if(cfg.extra.w>.5){
        out.p.z=0.;
    }
    out.v=vec4(velocity,clamp(structure,0.,1.));
    dst[i]=out;
}
@compute @workgroup_size(64)
fn solve_density(@builtin(global_invocation_id) id:vec3<u32>){
    let i=id.x;
    if(i>=cfg.counts.x){
        return;
    }
    let p=src[i].p.xyz;
    let c=cell(p);
    var rho=0.;
    var norm=0.;
    var sum_gradient=vec3(0.);
    var visited=0u;
    var truncated=false;
    for(var k=0;k<27;k++){
        var j=atomicLoad(&heads[neighbor_cell(c,k)]);
        loop{
            if(j<0){
                break;
            }
            if(visited>=cfg.counts.w){
                truncated=true;
                break;
            }
            visited++;
            let d=delta(p,src[u32(j)].p.xyz);
            let r2=dot(d,d);
            if(r2<cfg.dynamics.y*cfg.dynamics.y){
                rho+=cfg.fluid.x*weight(r2);
                let g=cfg.fluid.x/cfg.fluid.y*gradient(d);
                if(u32(j)!=i){
                    norm+=dot(g,g);
                    sum_gradient+=g;
                }
            }
            j=links[u32(j)];
        }
        if(truncated){
            break;
        }
    }
    if(truncated){
        atomicAdd(&stats[0],1u);
    }
    let constraint=max(rho/cfg.fluid.y-1.,0.);
    density[i]=vec4(-constraint/(norm+dot(sum_gradient,sum_gradient)+cfg.fluid.z),rho,0.,0.);
    atomicMax(&stats[2],u32(min(rho,1000.)*1000.));
}
@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) id:vec3<u32>){
    let i=id.x;
    if(i>=cfg.counts.x){
        return;
    }
    let old=src[i];
    let p=old.p.xyz;
    let c=cell(p);
    var correction=vec3(0.);
    var visited=0u;
    var truncated=false;
    for(var k=0;k<27;k++){
        var j=atomicLoad(&heads[neighbor_cell(c,k)]);
        loop{
            if(j<0){
                break;
            }
            if(visited>=cfg.counts.w){
                truncated=true;
                break;
            }
            visited++;
            if(u32(j)!=i){
                let d=delta(p,src[u32(j)].p.xyz);
                if(dot(d,d)<cfg.dynamics.y*cfg.dynamics.y){
                    let relative=weight(dot(d,d))/max(weight(.09*cfg.dynamics.y*cfg.dynamics.y),1e-6);
                    let anti_clump=-.0005*pow(relative,4.);
                    correction+=(density[i].x+density[u32(j)].x+anti_clump)*gradient(d)*cfg.fluid.x/cfg.fluid.y;
                }
            }
            j=links[u32(j)];
        }
        if(truncated){
            break;
        }
    }
    if(truncated){
        atomicAdd(&stats[0],1u);
    }
    let magnitude=length(correction);
    if(magnitude>.04){
        correction*=.04/magnitude;
        atomicAdd(&stats[3],1u);
    }
    var out=old;
    out.p=vec4(wrap(p+correction),old.p.w);
    dst[i]=out;
}
@compute @workgroup_size(64)
fn finalize(@builtin(global_invocation_id) id:vec3<u32>){
    let i=id.x;
    if(i>=cfg.counts.x){
        return;
    }
    var out=src[i];
    var velocity=delta(out.p.xyz,out.previous.xyz)/cfg.dynamics.x;
    if(cfg.extra.w>.5){
        velocity.z=0.;
    }
    let speed=length(velocity);
    out.v=vec4(velocity*min(1.,cfg.extra.z/max(speed,1e-6)),out.v.w);
    dst[i]=out;
}
