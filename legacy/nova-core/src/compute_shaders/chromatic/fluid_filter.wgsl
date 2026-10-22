// Separable bilateral depth + guided pigment/thickness smoothing.
struct Filter {
    axis:vec4<i32>,values:vec4<f32>
}
@group(0) @binding(0) var depth:texture_2d<f32>;
@group(0) @binding(1) var pigment:texture_2d<f32>;
@group(0) @binding(2) var output_depth:texture_storage_2d<r32float,write>;
@group(0) @binding(3) var output_pigment:texture_storage_2d<rgba16float,write>;
@group(0) @binding(4) var<uniform> cfg:Filter;
@compute @workgroup_size(8,8)
fn bilateral_main(@builtin(global_invocation_id) id:vec3<u32>){
    let p=vec2<i32>(id.xy);
    let size=vec2<i32>(textureDimensions(depth));
    if(any(p>=size)){
        return;
    }
    let center=textureLoad(depth,p,0).r;
    if(center>=9.99){
        textureStore(output_depth,p,vec4(10.));
        textureStore(output_pigment,p,vec4(0.));
        return;
    }
    var sum=0.;
    var z=0.;
    var color=vec4(0.);
    for(var k=-8;k<=8;k++){
        if(abs(k)>cfg.axis.z){
            continue;
        }
        let q=clamp(p+cfg.axis.xy*k,vec2(0),size-1);
        let d=textureLoad(depth,q,0).r;
        if(d>=9.99){
            continue;
        }
        let spatial=exp(-.5*f32(k*k)/cfg.values.x);
        let range=exp(-.5*(d-center)*(d-center)/cfg.values.y);
        let w=spatial*range;
        sum+=w;
        z+=w*d;
        color+=w*textureLoad(pigment,q,0);
    }
    textureStore(output_depth,p,vec4(z/max(sum,1e-8)));
    textureStore(output_pigment,p,color/max(sum,1e-8));
}
