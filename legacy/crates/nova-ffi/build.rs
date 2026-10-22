fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=../nova-core/src/lib.rs");
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let config = cbindgen::Config {
        language: cbindgen::Language::C,
        include_guard: Some("NOVA_H".into()),
        cpp_compat: true,
        usize_is_size_t: true,
        parse: cbindgen::ParseConfig {
            parse_deps: true,
            include: Some(vec!["nova-core".into()]),
            ..Default::default()
        },
        ..Default::default()
    };
    cbindgen::Builder::new()
        .with_crate(dir)
        .with_config(config)
        .generate()
        .expect("generate C header")
        .write_to_file(std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("nova.h"));
}
