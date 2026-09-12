use std::path::PathBuf;
use tft_strategist_lib::shop_vision::{
    extract_signature_from_bgra, PixelRect, ReferenceCatalog,
};

fn load_png_as_bgra(path: &std::path::Path) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoder = png::Decoder::new(&bytes[..]);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let w = info.width;
    let h = info.height;

    let mut rgba = vec![0u8; (w * h * 4) as usize];
    match info.color_type {
        png::ColorType::Rgba => {
            let copy_len = rgba.len().min(buf.len());
            rgba[..copy_len].copy_from_slice(&buf[..copy_len]);
        }
        png::ColorType::Rgb => {
            let mut src_i = 0;
            let mut dst_i = 0;
            while src_i + 2 < buf.len() && dst_i + 3 < rgba.len() {
                rgba[dst_i] = buf[src_i];
                rgba[dst_i + 1] = buf[src_i + 1];
                rgba[dst_i + 2] = buf[src_i + 2];
                rgba[dst_i + 3] = 255;
                src_i += 3;
                dst_i += 4;
            }
        }
        _ => return Err("Unsupported format".into()),
    }

    let mut bgra = vec![0u8; rgba.len()];
    for i in (0..rgba.len()).step_by(4) {
        if i + 3 < rgba.len() {
            bgra[i] = rgba[i + 2];
            bgra[i + 1] = rgba[i + 1];
            bgra[i + 2] = rgba[i];
            bgra[i + 3] = rgba[i + 3];
        }
    }

    Ok((bgra, w, h))
}

fn main() {
    println!("=== CALIBRATING SHOP ARTWORK MATCHING ===");
    let mut catalog = ReferenceCatalog::new();
    let cache_dir = PathBuf::from("artifacts/champion_cache");
    let loaded = catalog.load_from_cache_dir(&cache_dir);
    println!("Loaded {} reference signatures from cache", loaded);

    let ground_truths = [
        ("Akali", "scratch/card_0.png", vec!["DA_18_Akali_AD", "DA_18_Akali_AP"]),
        ("Rek'Sai", "scratch/card_1.png", vec!["DA_18_RekSai"]),
        ("Kobuko", "scratch/card_2.png", vec!["DA_18_Kobuko"]),
        ("Veigar", "scratch/card_3.png", vec!["DA_18_Veigar"]),
        ("Cinderling", "scratch/card_4.png", vec!["DA_Cinderling18"]),
    ];

    // Test different card artwork sub-regions
    let crop_configs = [
        ("Current (x: 92..188, y: 6..112)", PixelRect { x: 92, y: 6, width: 96, height: 106 }),
        ("Wider (x: 60..188, y: 6..116)", PixelRect { x: 60, y: 6, width: 128, height: 110 }),
        ("Centered (x: 75..185, y: 10..115)", PixelRect { x: 75, y: 10, width: 110, height: 105 }),
        ("Full upper (x: 40..190, y: 4..120)", PixelRect { x: 40, y: 4, width: 150, height: 116 }),
    ];

    for (config_name, crop_rect) in &crop_configs {
        println!("\n--------------------------------------------------");
        println!("TESTING CONFIG: {}", config_name);
        println!("--------------------------------------------------");

        let mut total_correct = 0;

        for (champ_name, card_path, expected_ids) in &ground_truths {
            let path = PathBuf::from(card_path);
            if !path.exists() {
                eprintln!("File not found: {}", card_path);
                continue;
            }

            let (bgra, w, h) = match load_png_as_bgra(&path) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("Error loading {}: {}", card_path, e);
                    continue;
                }
            };

            let card_sig = match extract_signature_from_bgra(&bgra, w, h, *crop_rect) {
                Some(s) => s,
                None => {
                    println!("Failed to extract signature for {}", champ_name);
                    continue;
                }
            };

            let mut scores: Vec<(&str, &str, f32, f32, f32)> = catalog
                .references
                .iter()
                .map(|r| {
                    let col = card_sig.color_similarity(&r.signature);
                    let spat = card_sig.spatial_similarity(&r.signature);
                    let total = card_sig.match_score(&r.signature);
                    (r.candidate.api_name.as_str(), r.candidate.name.as_str(), total, col, spat)
                })
                .collect();

            scores.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

            let top1 = scores.get(0).unwrap();
            let top2 = scores.get(1).unwrap();
            let is_match = expected_ids.iter().any(|&exp| exp == top1.0);
            if is_match {
                total_correct += 1;
            }

            let mark = if is_match { "CORRECT" } else { "MISMATCH" };
            println!(
                "  [{}] Expected: {:<10} -> #1: {} ({}) [{:.1}%, col:{:.1}%, spat:{:.1}%] | #2: {} [{:.1}%] | margin: {:.1}%",
                mark,
                champ_name,
                top1.1,
                top1.0,
                top1.2 * 100.0,
                top1.3 * 100.0,
                top1.4 * 100.0,
                top2.0,
                top2.2 * 100.0,
                (top1.2 - top2.2) * 100.0
            );
        }

        println!("Result: {} / {} correct", total_correct, ground_truths.len());
    }
}
