use std::path::Path;

fn convert(bmp_path: &Path, png_path: &Path) {
    let bytes = std::fs::read(bmp_path).unwrap();
    let w = i32::from_le_bytes(bytes[18..22].try_into().unwrap()) as u32;
    let h_raw = i32::from_le_bytes(bytes[22..26].try_into().unwrap());
    let h = h_raw.abs() as u32;
    let offset = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
    let bgra = &bytes[offset..];

    let mut rgba = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            if i + 3 < bgra.len() {
                rgba[i] = bgra[i + 2];
                rgba[i + 1] = bgra[i + 1];
                rgba[i + 2] = bgra[i];
                rgba[i + 3] = bgra[i + 3];
            }
        }
    }

    let file = std::fs::File::create(png_path).unwrap();
    let ref mut w_writer = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(w_writer, w, h);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(&rgba).unwrap();
}

fn main() {
    let audit_dir = Path::new("scratch/audit");
    for entry in std::fs::read_dir(audit_dir).unwrap() {
        let entry = entry.unwrap();
        let p = entry.path();
        if p.extension().map_or(false, |e| e == "bmp") {
            let png_p = p.with_extension("png");
            convert(&p, &png_p);
            println!("Converted {} -> {}", p.display(), png_p.display());
        }
    }
}
