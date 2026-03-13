use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_path = PathBuf::from("../../proto/pilot.proto");

    if !proto_path.exists() {
        panic!(
            "Proto file not found at {:?}. Expected at ../../proto/pilot.proto relative to packages/pilot-core/",
            proto_path.canonicalize().unwrap_or(proto_path)
        );
    }

    tonic_build::configure()
        .build_server(true)
        .build_client(false)
        .compile_protos(&[&proto_path], &["../../proto"])?;

    println!("cargo:rerun-if-changed=../../proto/pilot.proto");

    Ok(())
}
