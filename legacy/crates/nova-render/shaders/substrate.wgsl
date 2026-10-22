struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) index:u32)->VertexOut {
    var positions=array<vec2<f32>,3>(vec2<f32>(-1.,-1.),vec2<f32>(3.,-1.),vec2<f32>(-1.,3.));
    var out:VertexOut;
    out.position=vec4<f32>(positions[index],0.,1.);
    out.uv=vec2<f32>((positions[index].x+1.)*0.5,1.-(positions[index].y+1.)*0.5);
    return out;
}
@group(0) @binding(0) var field:texture_2d<f32>;
@fragment fn fs(in:VertexOut)->@location(0) vec4<f32> {
    let size=textureDimensions(field);
    let p=vec2<i32>(clamp(in.uv*vec2<f32>(size),vec2<f32>(0.),vec2<f32>(size)-vec2<f32>(1.)));
    let value=clamp(textureLoad(field,p,0).r,0.,1.);
    let dark=vec3<f32>(0.015,0.025,0.055);
    let cyan=vec3<f32>(0.06,0.64,0.8);
    let amber=vec3<f32>(1.,0.78,0.3);
    let color=mix(mix(dark,cyan,smoothstep(0.,0.65,value)),amber,smoothstep(0.6,1.,value));
    return vec4<f32>(color,1.);
}
