fn main() {
    println!("cargo:rerun-if-changed=src/compute_shaders/fields.wgsl");
    if std::env::var_os("CARGO_FEATURE_WEBGPU").is_some() {
        let source = std::fs::read_to_string("src/compute_shaders/fields.wgsl")
            .expect("field shader missing");
        let module = naga::front::wgsl::parse_str(&source)
            .unwrap_or_else(|error| panic!("{}", error.emit_to_string(&source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .expect("invalid field compute shader");
    }
}
