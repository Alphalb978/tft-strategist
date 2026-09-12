use std::path::{Path, PathBuf};
use tft_strategist_lib::shop_vision::{
    ChampionCandidate, PixelRect, get_default_set18_candidates,
};

fn read_bmp(path: &Path) -> (Vec<u8>, u32, u32) {
    let bytes = std::fs::read(path).expect("read bmp");
    let w = i32::from_le_bytes(bytes[18..22].try_into().unwrap()) as u32;
    let h_raw = i32::from_le_bytes(bytes[22..26].try_into().unwrap());
    let h = h_raw.abs() as u32;
    let offset = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
    let raw = bytes[offset..].to_vec();
    (raw, w, h)
}

struct MultiZoneSignature {
    upper_hist: [f32; 64],
    lower_hist: [f32; 64],
    spatial_grid: [f32; 256],
    edge_energy: f32,
}

impl MultiZoneSignature {
    fn extract_from_bgra(bgra: &[u8], frame_w: u32, frame_h: u32, rect: PixelRect) -> Option<Self> {
        let x_end = ((rect.x + rect.width as i32) as u32).min(frame_w);
        let y_end = ((rect.y + rect.height as i32) as u32).min(frame_h);
        let x_start = (rect.x.max(0) as u32).min(x_end);
        let y_start = (rect.y.max(0) as u32).min(y_end);
        let roi_w = x_end.saturating_sub(x_start);
        let roi_h = y_end.saturating_sub(y_start);
        if roi_w < 16 || roi_h < 16 { return None; }

        let y_mid = y_start + roi_h / 2;
        let mut upper_hist = [0.0f32; 64];
        let mut lower_hist = [0.0f32; 64];
        let mut upper_count = 0u32;
        let mut lower_count = 0u32;

        let mut grid_sums = [0.0f32; 256];
        let mut grid_counts = [0u32; 256];
        let mut total_gradient = 0.0f32;
        let mut total_pixels = 0u32;

        for y in y_start..y_end {
            let row_idx = (y * frame_w * 4) as usize;
            let gy = (((y - y_start) * 16) / roi_h).min(15) as usize;
            let is_upper = y < y_mid;

            for x in x_start..x_end {
                let px_idx = row_idx + (x * 4) as usize;
                if px_idx + 3 >= bgra.len() { continue; }

                let b = bgra[px_idx] as f32;
                let g = bgra[px_idx + 1] as f32;
                let r = bgra[px_idx + 2] as f32;

                let r_bin = (r / 64.0).floor().min(3.0) as usize;
                let g_bin = (g / 64.0).floor().min(3.0) as usize;
                let b_bin = (b / 64.0).floor().min(3.0) as usize;
                let bin_idx = r_bin * 16 + g_bin * 4 + b_bin;

                if is_upper {
                    upper_hist[bin_idx] += 1.0;
                    upper_count += 1;
                } else {
                    lower_hist[bin_idx] += 1.0;
                    lower_count += 1;
                }
                total_pixels += 1;

                let gx = (((x - x_start) * 16) / roi_w).min(15) as usize;
                let cell_idx = gy * 16 + gx;
                let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
                grid_sums[cell_idx] += lum;
                grid_counts[cell_idx] += 1;

                if x + 1 < x_end {
                    let next_idx = px_idx + 4;
                    let next_lum = (0.299 * bgra[next_idx + 2] as f32 + 0.587 * bgra[next_idx + 1] as f32 + 0.114 * bgra[next_idx] as f32) / 255.0;
                    total_gradient += (lum - next_lum).abs();
                }
            }
        }

        if upper_count > 0 {
            for i in 0..64 { upper_hist[i] /= upper_count as f32; }
        }
        if lower_count > 0 {
            for i in 0..64 { lower_hist[i] /= lower_count as f32; }
        }
        let mut spatial_grid = [0.0f32; 256];
        for i in 0..256 {
            if grid_counts[i] > 0 { spatial_grid[i] = grid_sums[i] / grid_counts[i] as f32; }
        }
        let edge_energy = (total_gradient / total_pixels as f32 * 5.0).min(1.0);

        Some(Self { upper_hist, lower_hist, spatial_grid, edge_energy })
    }

    fn similarity(&self, other: &Self) -> (f32, f32, f32, f32) {
        let mut upper_sim = 0.0f32;
        let mut lower_sim = 0.0f32;
        for i in 0..64 {
            upper_sim += (self.upper_hist[i] * other.upper_hist[i]).sqrt();
            lower_sim += (self.lower_hist[i] * other.lower_hist[i]).sqrt();
        }
        let col_sim = 0.5 * upper_sim + 0.5 * lower_sim;

        // Spatial similarity (NCC)
        let mut mean1 = 0.0f32;
        let mut mean2 = 0.0f32;
        for i in 0..256 {
            mean1 += self.spatial_grid[i];
            mean2 += other.spatial_grid[i];
        }
        mean1 /= 256.0;
        mean2 /= 256.0;
        let mut nom = 0.0f32;
        let mut var1 = 0.0f32;
        let mut var2 = 0.0f32;
        for i in 0..256 {
            let d1 = self.spatial_grid[i] - mean1;
            let d2 = other.spatial_grid[i] - mean2;
            nom += d1 * d2;
            var1 += d1 * d1;
            var2 += d2 * d2;
        }
        let denom = (var1 * var2).sqrt();
        let spat_sim = if denom > 0.0001 { (nom / denom).max(0.0).min(1.0) } else { 0.0 };

        let edge_sim = 1.0 - (self.edge_energy - other.edge_energy).abs().min(1.0);
        let score = 0.60 * col_sim + 0.30 * spat_sim + 0.10 * edge_sim;
        (score, col_sim, spat_sim, edge_sim)
    }
}

fn main() {
    let cache_dir = PathBuf::from("artifacts/champion_cache");
    let candidates = get_default_set18_candidates();
    let mut references = Vec::new();

    for c in &candidates {
        let p = cache_dir.join(format!("{}.png", c.api_name));
        if let Ok(bytes) = std::fs::read(&p) {
            let decoder = png::Decoder::new(&bytes[..]);
            if let Ok(mut reader) = decoder.read_info() {
                let mut buf = vec![0u8; reader.output_buffer_size()];
                if let Ok(info) = reader.next_frame(&mut buf) {
                    let w = info.width;
                    let h = info.height;
                    let mut bgra = vec![0u8; (w * h * 4) as usize];
                    for i in (0..buf.len()).step_by(4) {
                        bgra[i] = buf[i + 2];
                        bgra[i + 1] = buf[i + 1];
                        bgra[i + 2] = buf[i];
                        bgra[i + 3] = buf[i + 3];
                    }
                    let rect = PixelRect { x: 0, y: 0, width: w, height: (h as f32 * 0.70).round() as u32 };
                    if let Some(sig) = MultiZoneSignature::extract_from_bgra(&bgra, w, h, rect) {
                        references.push((c.clone(), sig));
                    }
                }
            }
        }
    }
    println!("Loaded {} multi-zone references", references.len());

    let scratch_dir = PathBuf::from("C:/Users/K/.gemini/antigravity-ide/brain/7a8cb10b-2128-4285-9a79-13849c56b2e2/scratch");
    let card_expected = [
        ("card_0.bmp", "DA_18_Akali_AD", "Akali"),
        ("card_1.bmp", "DA_18_RekSai", "Rek'Sai"),
        ("card_2.bmp", "DA_18_Kobuko", "Kobuko"),
        ("card_3.bmp", "DA_18_Veigar", "Veigar"),
        ("card_4.bmp", "DA_Cinderling18", "Cinderling"),
    ];

    println!("\n=== MULTI-ZONE SIGNATURE EVALUATION ===");
    for (file_name, expected_id, expected_name) in &card_expected {
        let bmp_path = scratch_dir.join(file_name);
        let (bgra, w, h) = read_bmp(&bmp_path);
        let art_x = ((w as f32) * 0.48).round() as i32;
        let art_y = ((h as f32) * 0.04).round() as i32;
        let art_w = ((w as f32) * 0.50).round() as u32;
        let art_h = ((h as f32) * 0.69).round() as u32;
        let rect = PixelRect { x: art_x, y: art_y, width: art_w, height: art_h };
        let card_sig = MultiZoneSignature::extract_from_bgra(&bgra, w, h, rect).unwrap();

        let mut scores: Vec<(&ChampionCandidate, f32, f32, f32, f32)> = references.iter().map(|(c, r_sig)| {
            let (score, col, spat, edge) = card_sig.similarity(r_sig);
            (c, score, col, spat, edge)
        }).collect();
        scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        let (rank, (_, score, col, spat, _)) = scores.iter().enumerate().find(|(_, (c, _, _, _, _))| c.api_name == *expected_id).unwrap();
        let is_top = rank == 0;
        let margin = if scores.len() > 1 {
            if is_top { scores[0].1 - scores[1].1 } else { scores[0].1 - score }
        } else { 0.0 };

        println!("  {}: rank #{}, score: {:.3} (col: {:.3}, spat: {:.3}), top: {} ({:.3}, margin: {:.3}) - {}",
            expected_name, rank + 1, score, col, spat, scores[0].0.name, scores[0].1, margin, if is_top { "PASS" } else { "FAIL" });

        println!("    Top 3 candidates:");
        for i in 0..3 {
            println!("      #{}: {} ({}) score={:.3}", i + 1, scores[i].0.name, scores[i].0.api_name, scores[i].1);
        }
    }
}
