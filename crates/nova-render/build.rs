fn main() {
    for entry in std::fs::read_dir("shaders").expect("shaders directory") {
        let p = entry.unwrap().path();
        if p.extension().and_then(|x| x.to_str()) != Some("wgsl") {
            continue;
        }
        println!("cargo:rerun-if-changed={}", p.display());
        let source = std::fs::read_to_string(&p).unwrap();
        let module = naga::front::wgsl::parse_str(&source)
            .unwrap_or_else(|e| panic!("{}: {}", p.display(), e.emit_to_string(&source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap_or_else(|e| panic!("{}: {:?}", p.display(), e));
    }
}
