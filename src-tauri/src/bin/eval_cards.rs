use std::path::{Path, PathBuf};
use tft_strategist_lib::shop_vision::{
    extract_signature_from_bgra, signature_from_png_bytes, ChampionReference,
    PixelRect, get_default_set18_candidates,
};

fn read_bmp(path: &Path) -> (Vec<u8>, u32, u32) {
    let bytes = std::fs::read(path).expect("read bmp");
    // BMP header
    let w = i32::from_le_bytes(bytes[18..22].try_into().unwrap()) as u32;
    let h_raw = i32::from_le_bytes(bytes[22..26].try_into().unwrap());
    let h = h_raw.abs() as u32;
    let offset = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
    let raw = bytes[offset..].to_vec();
    (raw, w, h)
}

fn main() {
    let cache_dir = PathBuf::from("artifacts/champion_cache");
    let candidates = get_default_set18_candidates();
    let mut references = Vec::new();

    for c in &candidates {
        let p = cache_dir.join(format!("{}.png", c.api_name));
        if p.exists() {
            if let Ok(bytes) = std::fs::read(&p) {
                if let Ok(sig) = signature_from_png_bytes(&bytes) {
                    references.push(ChampionReference {
                        candidate: c.clone(),
                        signature: sig,
                    });
                }
            }
        }
    }
    println!("Loaded {} reference signatures", references.len());

    let scratch_dir = PathBuf::from("C:/Users/K/.gemini/antigravity-ide/brain/7a8cb10b-2128-4285-9a79-13849c56b2e2/scratch");
    let card_expected = [
        ("card_0.bmp", "DA_18_Akali_AD", "Akali"),
        ("card_1.bmp", "DA_18_RekSai", "Rek'Sai"),
        ("card_2.bmp", "DA_18_Kobuko", "Kobuko"),
        ("card_3.bmp", "DA_18_Veigar", "Veigar"),
        ("card_4.bmp", "DA_Cinderling18", "Cinderling"),
    ];

    let weight_configs = [
        (0.50, 0.40, 0.10, "50% col, 40% spat, 10% edge"),
        (0.60, 0.30, 0.10, "60% col, 30% spat, 10% edge"),
        (0.65, 0.25, 0.10, "65% col, 25% spat, 10% edge"),
        (0.70, 0.20, 0.10, "70% col, 20% spat, 10% edge"),
    ];

    for (w_col, w_spat, w_edge, desc) in &weight_configs {
        println!("\n=======================================================");
        println!("Testing weights: {}", desc);
        println!("=======================================================");

        let mut correct_count = 0;
        let mut total_score = 0.0;
        for (file_name, expected_id, expected_name) in &card_expected {
            let bmp_path = scratch_dir.join(file_name);
            let (bgra, w, h) = read_bmp(&bmp_path);

            let art_x = ((w as f32) * 0.48).round() as i32;
            let art_y = ((h as f32) * 0.04).round() as i32;
            let art_w = ((w as f32) * 0.50).round() as u32;
            let art_h = ((h as f32) * 0.69).round() as u32;

            let rect = PixelRect { x: art_x, y: art_y, width: art_w, height: art_h };
            let sig = extract_signature_from_bgra(&bgra, w, h, rect).expect("sig");

            let mut scores: Vec<(&ChampionReference, f32, f32, f32)> = references.iter().map(|r| {
                let col = sig.color_similarity(&r.signature);
                let spat = sig.spatial_similarity(&r.signature);
                let edge = 1.0 - (sig.edge_energy - r.signature.edge_energy).abs().min(1.0);
                let score = w_col * col + w_spat * spat + w_edge * edge;
                (r, score, col, spat)
            }).collect();
            scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

            let is_top = scores[0].0.candidate.api_name == *expected_id;
            if is_top { correct_count += 1; }
            let (rank, (_, score, col, spat)) = scores.iter().enumerate().find(|(_, (r, _, _, _))| r.candidate.api_name == *expected_id).unwrap();
            total_score += score;
            let margin = if scores.len() > 1 {
                if is_top { scores[0].1 - scores[1].1 } else { scores[0].1 - score }
            } else { 0.0 };
            println!("  {}: rank #{}, score: {:.3} (col: {:.3}, spat: {:.3}), top: {} ({:.3}, margin: {:.3}) - {}",
                expected_name, rank + 1, score, col, spat, scores[0].0.candidate.name, scores[0].1, margin, if is_top { "PASS" } else { "FAIL" });
        }
        println!("--> Total Correct #1: {}/5, Avg Score: {:.3}", correct_count, total_score / 5.0);
    }
}


