use std::path::Path;
fn validate_directory(root: &Path) {
    println!("cargo:rerun-if-changed={}", root.display());
    for entry in std::fs::read_dir(root).expect("shader directory missing") {
        let path = entry.expect("shader entry").path();
        if path.is_dir() {
            validate_directory(&path);
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("wgsl") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("shader source missing");
        if path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            == Some("chromatic")
        {
            let canonical = Path::new("../nova/visuals/shaders").join(path.file_name().unwrap());
            if canonical.is_file() {
                println!("cargo:rerun-if-changed={}", canonical.display());
                assert_eq!(
                    source,
                    std::fs::read_to_string(&canonical).unwrap(),
                    "run scripts/sync_visual_shaders.py"
                );
            }
        }
        let module = naga::front::wgsl::parse_str(&source)
            .unwrap_or_else(|e| panic!("{}: {}", path.display(), e.emit_to_string(&source)));
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .unwrap_or_else(|e| panic!("{}: {:?}", path.display(), e));
    }
}
fn main() {
    if std::env::var_os("CARGO_FEATURE_WEBGPU").is_some() {
        validate_directory(Path::new("src/compute_shaders"));
    }
}
