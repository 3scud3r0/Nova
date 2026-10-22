// GGX surface, Beer-Lambert thickness, approximate SSS/HG and thin-film tint.
struct Camera {
    eye:vec4<f32>,right:vec4<f32>,up:vec4<f32>,forward:vec4<f32>,view:vec4<f32>,material:vec4<f32>,light:vec4<f32>,post:vec4<f32>
}
@group(0) @binding(0) var depth:texture_2d<f32>;
@group(0) @binding(1) var pigment:texture_2d<f32>;
@group(0) @binding(2) var<uniform> cam:Camera;
struct Quad {
    @builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>
}
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->Quad{
    var p=array<vec2<f32>,3>(vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
    var out:Quad;
    out.pos=vec4(p[i],0.,1.);
    out.uv=p[i]*vec2(.5,-.5)+.5;
    return out;
}
fn ray(p:vec2<f32>)->vec3<f32>{
    let uv=(p/cam.view.xy*2.-1.)*vec2(1.,-1.);
    return normalize(cam.forward.xyz+cam.right.xyz*uv.x*cam.forward.w*cam.view.x/cam.view.y+cam.up.xyz*uv.y*cam.forward.w);
}
fn position(p:vec2<i32>,fallback:f32)->vec3<f32>{
    let size=vec2<i32>(textureDimensions(depth));
    let q=clamp(p,vec2(0),size-1);
    var z=textureLoad(depth,q,0).r;
    if(z>=9.99){
        z=fallback;
    }
    let r=ray(vec2<f32>(q)+.5);
    return cam.eye.xyz+r*z/max(dot(r,cam.forward.xyz),.01);
}
fn environment(r:vec3<f32>)->vec3<f32>{
    let ceiling=pow(max(r.y,0.),5.);
    let panel=pow(max(dot(r,normalize(vec3(-.5,.7,.4))),0.),45.);
    return mix(vec3(.012,.018,.035),vec3(.15,.19,.25),r.y*.5+.5)+vec3(.9,.8,.7)*ceiling+vec3(5.,5.5,6.)*panel;
}
fn phase(cosine:f32,g:f32)->f32{
    return (1.-g*g)/(12.5663706*pow(max(1.+g*g-2.*g*cosine,.001),1.5));
}
fn brdf(n:vec3<f32>,v:vec3<f32>,l:vec3<f32>,albedo:vec3<f32>,F0:vec3<f32>)->vec3<f32>{
    let h=normalize(v+l);
    let nl=max(dot(n,l),0.);
    let nv=max(dot(n,v),.001);
    let nh=max(dot(n,h),0.);
    let vh=max(dot(v,h),0.);
    let a=max(.025,cam.material.x*cam.material.x);
    let a2=a*a;
    let denom=nh*nh*(a2-1.)+1.;
    let D=a2/(3.14159265*denom*denom);
    let k=(cam.material.x+1.)*(cam.material.x+1.)/8.;
    let G=nv/(nv*(1.-k)+k)*nl/max(nl*(1.-k)+k,.001);
    let F=F0+(1.-F0)*pow(1.-vh,5.);
    return ((1.-F)*albedo/3.14159265+D*G*F/max(4.*nl*nv,.001))*nl;
}
@fragment fn shade(in:Quad)->@location(0) vec4<f32>{
    let pixel=vec2<i32>(in.pos.xy);
    let z=textureLoad(depth,pixel,0).r;
    let r=ray(in.pos.xy);
    let background=environment(r)*.12+vec3(.008,.006,.018);
    if(z>=9.99){
        return vec4(background,1.);
    }
    let p=position(pixel,z);
    let xp=position(pixel+vec2(1,0),z)-p;
    let xm=p-position(pixel-vec2(1,0),z);
    let yp=position(pixel+vec2(0,1),z)-p;
    let ym=p-position(pixel-vec2(0,1),z);
    let dx=select(xm,xp,abs(dot(xp,cam.forward.xyz))<abs(dot(xm,cam.forward.xyz)));
    let dy=select(ym,yp,abs(dot(yp,cam.forward.xyz))<abs(dot(ym,cam.forward.xyz)));
    var n=normalize(cross(dx,dy)+vec3(1e-8));
    let v=normalize(cam.eye.xyz-p);
    if(dot(n,v)<0.){
        n=-n;
    }
    let raw=textureLoad(pigment,pixel,0);
    let thickness=clamp(raw.a,0.,4.);
    let albedo=clamp(raw.rgb/max(raw.a,.00001),vec3(.015),vec3(.98));
    let sigma=-log(albedo)*cam.material.y;
    let trans=exp(-sigma*thickness);
    let nv=max(dot(n,v),0.);
    let wavelength=vec3(650.,510.,475.);
    let film=.5+.5*cos(12.5663706*1.33*cam.material.w*max(.2,nv)/wavelength);
    let F0=mix(vec3(.04),vec3(.04)+.18*film,cam.light.w);
    var color=vec3(0.);
    let l1=normalize(vec3(-.6,.9,.8));
    let l2=normalize(vec3(.8,.1,-.6));
    let l3=normalize(vec3(-.4,-.5,-.8));
    color+=brdf(n,v,l1,albedo,F0)*vec3(4.,3.8,3.5);
    color+=brdf(n,v,l2,albedo,F0)*vec3(1.1,1.5,2.4);
    color+=brdf(n,v,l3,albedo,F0)*vec3(1.8,.6,1.2);
    let reflection=reflect(-v,n);
    let F=F0+(1.-F0)*pow(1.-nv,5.);
    color+=environment(reflection)*F;
    let back=pow(max(dot(-n,l2),0.),2.)+phase(dot(-v,l2),cam.light.z)*2.;
    color+=cam.material.z*(1.-trans)*albedo*(.4+back)*vec3(.9,1.1,1.5);
    let bend=r+(.18*(1.-trans.r))*n;
    let behind=environment(normalize(bend))*.2;
    color+=trans*behind*(1.-F);
    color+=.02*albedo*pow(1.-nv,3.);
    return vec4(max(color,vec3(0.)),1.);
}
