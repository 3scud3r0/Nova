// Bounded image-space lens/bloom; ACES fitted display curve, not full ACES OCIO.
struct Post {
    view:vec4<f32>,lens:vec4<f32>,style:vec4<f32>
}
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var depth:texture_2d<f32>;
@group(0) @binding(2) var linear:sampler;
@group(0) @binding(3) var<uniform> cfg:Post;
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
fn aces(x:vec3<f32>)->vec3<f32>{
    return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3(0.),vec3(1.));
}
@fragment fn post(in:Quad)->@location(0) vec4<f32>{
    let uv=in.uv;
    let size=cfg.view.xy;
    let z=textureLoad(depth,vec2<i32>(clamp(in.pos.xy,vec2(0.),size-1.)),0).r;
    let coc=min(12.,cfg.lens.y*abs(z-cfg.lens.x)/max(z,.1));
    var color=textureSampleLevel(hdr,linear,uv,0.).rgb;
    var weight=1.;
    var bloom=vec3(0.);
    for(var i=0;i<16;i++){
        let a=f32(i)*2.399963;
        let radius=sqrt((f32(i)+.5)/16.);
        let direction=vec2(cos(a),sin(a));
        let aperture=direction*radius*coc/size;
        let sample=textureSampleLevel(hdr,linear,clamp(uv+aperture,vec2(0.),vec2(1.)),0.).rgb;
        if(coc>.5){
            color+=sample;
            weight+=1.;
        }
        let light=textureSampleLevel(hdr,linear,clamp(uv+direction*radius*24./size,vec2(0.),vec2(1.)),0.).rgb;
        bloom+=max(light-vec3(1.),vec3(0.))/16.;
    }
    color=color/weight+cfg.lens.z*bloom;
    let vignette=1.-cfg.style.x*dot(uv-.5,uv-.5);
    let noise=fract(sin(dot(in.pos.xy,vec2(12.9898,78.233))+cfg.view.z*.13)*43758.5453)-.5;
    let mapped=pow(aces(color*cfg.lens.w),vec3(1./2.2))*vignette+noise*cfg.style.y;
    return vec4(clamp(mapped,vec3(0.),vec3(1.)),1.);
}
