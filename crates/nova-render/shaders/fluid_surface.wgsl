// Surface splats: sphere depth and additive pigment optical thickness.
struct Particle {
    p:vec4<f32>,v:vec4<f32>,previous:vec4<f32>
}
struct Camera {
    eye:vec4<f32>,right:vec4<f32>,up:vec4<f32>,forward:vec4<f32>,view:vec4<f32>,material:vec4<f32>,light:vec4<f32>,post:vec4<f32>
}
@group(0) @binding(0) var<storage,read> particles:array<Particle>;
@group(0) @binding(1) var<uniform> cam:Camera;
@group(0) @binding(2) var<storage,read> palette:array<vec4<f32>>;
struct Vertex {
    @builtin(position) position:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) @interpolate(flat) depth:f32,@location(2) @interpolate(flat) pigment:vec3<f32>
}
@vertex fn splat(@builtin(vertex_index) vi:u32,@builtin(instance_index) pi:u32)->Vertex{
    var corners=array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
    let p=particles[pi];
    let corner=corners[vi];
    let radius=cam.view.z;
    let local=p.p.xyz-cam.eye.xyz;
    let z=dot(local,cam.forward.xyz);
    let x=dot(local,cam.right.xyz)+corner.x*radius;
    let y=dot(local,cam.up.xyz)+corner.y*radius;
    let near=.05;
    let far=10.;
    var out:Vertex;
    out.position=vec4(x/(cam.forward.w*cam.view.x/cam.view.y),y/cam.forward.w,far/(far-near)*z-far*near/(far-near),z);
    out.uv=corner;
    out.depth=z;
    out.pigment=palette[u32(p.p.w)].rgb;
    return out;
}
struct DepthOut {
    @location(0) depth:f32,@builtin(frag_depth) hardware:f32
}
@fragment fn sphere_depth(in:Vertex)->DepthOut{
    let q=dot(in.uv,in.uv);
    if(q>=1.||in.depth<.06){
        discard;
    }
    let z=max(.051,in.depth-cam.view.z*sqrt(1.-q));
    var out:DepthOut;
    out.depth=z;
    out.hardware=10./9.95-.5/(9.95*z);
    return out;
}
@fragment fn optical_thickness(in:Vertex)->@location(0) vec4<f32>{
    let q=dot(in.uv,in.uv);
    if(q>=1.||in.depth<.06){
        discard;
    }
    let thickness=2.*cam.view.z*sqrt(1.-q);
    return vec4(in.pigment*thickness,thickness);
}
