fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=capabilities");
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "desktop_state",
                "desktop_connect",
                "desktop_resume_instance",
                "desktop_refresh_instance",
                "desktop_remove_instance",
                "desktop_return_done",
                "desktop_passkey_ceremony",
            ]),
        ),
    )
    .expect("failed to build hostid desktop tauri resources");
}
