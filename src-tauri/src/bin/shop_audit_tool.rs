use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tft_strategist_lib::shop_vision::{
    get_default_set18_candidates, ReferenceCatalog, ShopLayout, ShopVisionEngine,
    RECOGNITION_VERSION,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SlotAuditObservation {
    pub frame_generation: u64,
    pub slot_index: usize,
    pub recognized_canonical_id: Option<String>,
    pub actual_canonical_id: Option<String>,
    pub recognized_name: Option<String>,
    pub actual_name: Option<String>,
    pub confidence: f32,
    pub second_candidate_id: Option<String>,
    pub second_score: f32,
    pub margin: f32,
    pub status: String, // "correct" | "wrong" | "unknown"
    pub stable: bool,
    pub recognition_time_ms: f32,
    pub geometry_version: String,
    pub recognition_version: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfusionPair {
    pub expected: String,
    pub candidate: String,
    pub count: usize,
    pub note: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShopVisionAuditReport {
    pub audit_timestamp: String,
    pub geometry_version: String,
    pub recognition_version: String,
    pub total_shops: usize,
    pub total_slots_labeled: usize,
    pub correct: usize,
    pub wrong: usize,
    pub unknown: usize,
    pub emitted_accuracy: f32,
    pub coverage: f32,
    pub mean_confidence_correct: f32,
    pub mean_confidence_wrong: f32,
    pub mean_margin_correct: f32,
    pub mean_recognition_time_ms: f32,
    pub confusion_pairs: Vec<ConfusionPair>,
    pub observations: Vec<SlotAuditObservation>,
}

fn create_shop_frame(
    _catalog: &ReferenceCatalog,
    cache_dir: &Path,
    shop_units: [&str; 5],
    frame_w: u32,
    frame_h: u32,
) -> Vec<u8> {
    let mut bgra = vec![12u8; (frame_w * frame_h * 4) as usize];
    let layout = ShopLayout::default();
    let (shop_rect, slot_rects) = layout.compute_pixel_geometry(frame_w, frame_h);

    // 1. Draw TFT gold header trim at shop_rect.y - 3
    let border_y = (shop_rect.y - 3).max(0) as u32;
    for x in shop_rect.x..(shop_rect.x + shop_rect.width as i32) {
        if x >= 0 && (x as u32) < frame_w && border_y < frame_h {
            let i = ((border_y * frame_w + x as u32) * 4) as usize;
            bgra[i] = 53;     // B
            bgra[i + 1] = 98;  // G
            bgra[i + 2] = 120; // R
            bgra[i + 3] = 255;
        }
    }

    // 2. Draw each of the 5 cards
    for (slot_idx, &unit_api) in shop_units.iter().enumerate() {
        let slot = slot_rects[slot_idx];

        // Draw card background
        for cy in 0..slot.height {
            let y = slot.y + cy as i32;
            if y < 0 || (y as u32) >= frame_h { continue; }
            for cx in 0..slot.width {
                let x = slot.x + cx as i32;
                if x < 0 || (x as u32) >= frame_w { continue; }
                let i = ((y as u32 * frame_w + x as u32) * 4) as usize;
                bgra[i] = 20;
                bgra[i + 1] = 20;
                bgra[i + 2] = 20;
                bgra[i + 3] = 255;
            }
        }

        // Draw slate blue nameplate banner at bottom (y ~ 88% of slot height)
        let nameplate_y_start = slot.y + ((slot.height as f32) * 0.80).round() as i32;
        let nameplate_y_end = slot.y + slot.height as i32;
        for y in nameplate_y_start..nameplate_y_end {
            if y < 0 || (y as u32) >= frame_h { continue; }
            for x in slot.x..(slot.x + slot.width as i32) {
                if x < 0 || (x as u32) >= frame_w { continue; }
                let i = ((y as u32 * frame_w + x as u32) * 4) as usize;
                bgra[i] = 50;     // B
                bgra[i + 1] = 38;  // G
                bgra[i + 2] = 25;  // R
                bgra[i + 3] = 255;
            }
        }

        // Load reference PNG for the unit artwork
        let png_path = cache_dir.join(format!("{}.png", unit_api));
        if png_path.exists() {
            if let Ok(bytes) = std::fs::read(&png_path) {
                let decoder = png::Decoder::new(&bytes[..]);
                if let Ok(mut reader) = decoder.read_info() {
                    let mut buf = vec![0u8; reader.output_buffer_size()];
                    if let Ok(info) = reader.next_frame(&mut buf) {
                        let pw = info.width;
                        let ph = info.height;
                        let mut ref_bgra = vec![0u8; (pw * ph * 4) as usize];
                        if info.color_type == png::ColorType::Rgba {
                            for i in (0..buf.len()).step_by(4) {
                                if i + 3 < ref_bgra.len() {
                                    ref_bgra[i] = buf[i + 2];
                                    ref_bgra[i + 1] = buf[i + 1];
                                    ref_bgra[i + 2] = buf[i];
                                    ref_bgra[i + 3] = buf[i + 3];
                                }
                            }
                        } else if info.color_type == png::ColorType::Rgb {
                            let mut si = 0;
                            let mut di = 0;
                            while si + 2 < buf.len() && di + 3 < ref_bgra.len() {
                                ref_bgra[di] = buf[si + 2];
                                ref_bgra[di + 1] = buf[si + 1];
                                ref_bgra[di + 2] = buf[si];
                                ref_bgra[di + 3] = 255;
                                si += 3;
                                di += 4;
                            }
                        }

                        // Blit reference artwork into card artwork ROI (art_x ~ 48%, art_y ~ 4%, art_w ~ 50%, art_h ~ 69%)
                        let art_x = slot.x + ((slot.width as f32) * 0.48).round() as i32;
                        let art_y = slot.y + ((slot.height as f32) * 0.04).round() as i32;
                        let art_w = ((slot.width as f32) * 0.50).round() as u32;
                        let art_h = ((slot.height as f32) * 0.69).round() as u32;

                        for dy in 0..art_h {
                            let sy = (dy * ph) / art_h;
                            let target_y = art_y + dy as i32;
                            if target_y < 0 || (target_y as u32) >= frame_h { continue; }

                            for dx in 0..art_w {
                                let sx = (dx * pw) / art_w;
                                let target_x = art_x + dx as i32;
                                if target_x < 0 || (target_x as u32) >= frame_w { continue; }

                                let src_i = ((sy * pw + sx) * 4) as usize;
                                let dst_i = ((target_y as u32 * frame_w + target_x as u32) * 4) as usize;
                                if src_i + 3 < ref_bgra.len() && dst_i + 3 < bgra.len() {
                                    bgra[dst_i] = ref_bgra[src_i];
                                    bgra[dst_i + 1] = ref_bgra[src_i + 1];
                                    bgra[dst_i + 2] = ref_bgra[src_i + 2];
                                    bgra[dst_i + 3] = 255;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    bgra
}

fn main() {
    println!("=== TFT STRATEGIST M14B.1 AUDIT & CALIBRATION TOOL ===");
    let cache_dir = PathBuf::from("artifacts/champion_cache");
    let candidates = get_default_set18_candidates();
    let mut catalog = ReferenceCatalog::new();
    catalog.load_from_cache_dir(&cache_dir);

    let candidate_names: HashMap<String, String> = candidates.iter().map(|c| (c.api_name.clone(), c.name.clone())).collect();
    let engine = ShopVisionEngine::new();

    // 22 distinct shop states covering Set 18 champions across tiers, colors, archetypes, and transitions
    let test_shops: [(&str, [&str; 5]); 22] = [
        // Shop 1: Live verified Tocker's Trials shop
        ("Live Tocker's Trials Baseline", ["DA_18_Akali_AD", "DA_18_RekSai", "DA_18_Kobuko", "DA_18_Veigar", "DA_Cinderling18"]),
        // Shop 2: 1-Cost Frontline Reroll
        ("1-Cost Frontline Pool", ["DA_18_Camille", "DA_18_Ornn", "DA_18_Rakan", "DA_18_Sentry", "DA_18_Varus"]),
        // Shop 3: 2-Cost AP / Sprykin Core
        ("2-Cost Core", ["DA_18_Alistar", "DA_18_Caitlyn", "DA_18_Elise", "DA_18_Kayle", "DA_18_LeBlanc"]),
        // Shop 4: 2-Cost Bruiser & Hunters
        ("2-Cost Bruisers", ["DA_18_Sejuani", "DA_18_Shen", "DA_18_Teemo", "DA_18_Warwick", "DA_18_Yunara"]),
        // Shop 5: 3-Cost Midgame Carries
        ("3-Cost Midgame", ["DA_18_Azir", "DA_18_Cassiopeia", "DA_18_Diana", "DA_18_Hecarim", "DA_18_KhaZix"]),
        // Shop 6: 3-Cost Frontline & Specialist
        ("3-Cost Frontline", ["DA_18_MasterYi_AD", "DA_18_Rammus", "DA_18_Rengar", "DA_18_Tristana", "DA_Vi18"]),
        // Shop 7: 4-Cost Power Spikes
        ("4-Cost Power Spike A", ["DA_18_Ahri", "DA_18_Aphelios", "DA_18_Ezreal", "DA_18_Lillia", "DA_18_Malphite"]),
        // Shop 8: 4-Cost Carries & Colossi
        ("4-Cost Power Spike B", ["DA_18_Morgana", "DA_18_Sett", "DA_18_Sivir", "DA_18_Soraka", "DA_18_Zyra"]),
        // Shop 9: 5-Cost Legendaries
        ("5-Cost High Roll", ["DA_18_Alune", "DA_18_Ashe", "DA_18_ElderDragon", "DA_18_GnarSmall", "DA_18_Ivern"]),
        // Shop 10: 5-Cost Capstone & Forest
        ("5-Cost Capstone", ["DA_18_Kennen", "DA_18_Maokai", "DA_Draven18", "DA_Taric18", "DA_18_ElderDragon"]),
        // Shop 11: Wild Monsters / Forest Units
        ("Wild Monsters A", ["DA_Amumu18", "DA_Brambleback18", "DA_CrimsonRaptor18", "DA_Fiddlesticks18", "DA_Gromp18_AP"]),
        // Shop 12: Wild Monsters B
        ("Wild Monsters B", ["DA_Karma18", "DA_KogMaw18_AD", "DA_Krug18", "DA_Murkwolf18", "DA_Nidalee18_AP"]),
        // Shop 13: Mixed Early Pool
        ("Mixed Early Pool", ["DA_Scuttlecrab18", "DA_Sentinel18", "DA_18_Xayah", "DA_18_Yorick", "DA_18_Kobuko"]),
        // Shop 14: Fiery & Yellow Palette Stress Test (Akali vs Amumu vs Kennen vs Leona vs Cinderling)
        ("Fiery Palette Stress Test", ["DA_18_Akali_AD", "DA_Amumu18", "DA_18_Kennen", "DA_18_Leona", "DA_Cinderling18"]),
        // Shop 15: Dark / Shadow Palette Stress Test (Veigar vs Warwick vs Murkwolf vs Gromp vs Rengar)
        ("Shadow Palette Stress Test", ["DA_18_Veigar", "DA_18_Warwick", "DA_Murkwolf18", "DA_Gromp18_AP", "DA_18_Rengar"]),
        // Shop 16: Blue / Celestial Palette Stress Test (Diana vs Caitlyn vs Shen vs Alune vs Sejuani)
        ("Celestial Palette Stress Test", ["DA_18_Diana", "DA_18_Caitlyn", "DA_18_Shen", "DA_18_Alune", "DA_18_Sejuani"]),
        // Shop 17: Nature / Green Palette Stress Test (Kobuko vs Ivern vs Maokai vs Zyra vs Scuttlecrab)
        ("Nature Green Stress Test", ["DA_18_Kobuko", "DA_18_Ivern", "DA_18_Maokai", "DA_18_Zyra", "DA_Scuttlecrab18"]),
        // Shop 18: High Variance 1-to-5 Tier Roll
        ("Tier 1-5 Spread", ["DA_18_Rakan", "DA_18_Elise", "DA_18_Diana", "DA_18_Sett", "DA_18_ElderDragon"]),
        // Shop 19: Reroll Sequence Alpha
        ("Reroll Sequence Alpha", ["DA_18_Varus", "DA_18_Kayle", "DA_18_Hecarim", "DA_18_Ahri", "DA_18_Ashe"]),
        // Shop 20: Reroll Sequence Beta
        ("Reroll Sequence Beta", ["DA_18_Camille", "DA_18_Alistar", "DA_18_Tristana", "DA_18_Aphelios", "DA_Draven18"]),
        // Shop 21: Reroll Sequence Gamma
        ("Reroll Sequence Gamma", ["DA_18_Ornn", "DA_18_LeBlanc", "DA_18_Cassiopeia", "DA_18_Ezreal", "DA_Taric18"]),
        // Shop 22: Reroll Sequence Delta
        ("Reroll Sequence Delta", ["DA_18_Sentry", "DA_18_Caitlyn", "DA_Vi18", "DA_18_Malphite", "DA_18_GnarSmall"]),
    ];

    let mut observations = Vec::new();
    let mut total_correct = 0usize;
    let mut total_wrong = 0usize;
    let mut total_unknown = 0usize;

    let mut confidences_correct = Vec::new();
    let mut confidences_wrong = Vec::new();
    let mut margins_correct = Vec::new();
    let mut processing_times = Vec::new();
    let mut confusion_map: HashMap<(String, String), usize> = HashMap::new();

    println!("Executing full audit across {} shops ({} slots)...", test_shops.len(), test_shops.len() * 5);

    for (shop_idx, (shop_name, units)) in test_shops.iter().enumerate() {
        let frame_w = 1920u32;
        let frame_h = 1080u32;
        let bgra = create_shop_frame(&catalog, &cache_dir, *units, frame_w, frame_h);

        // Process frame 1
        let start = Instant::now();
        let _ = engine.process_frame(&bgra, frame_w, frame_h);
        // Process frame 2 (simulating 2 agreeing frames at 2 FPS)
        let status = engine.process_frame(&bgra, frame_w, frame_h);
        let elapsed_ms = start.elapsed().as_secs_f32() * 500.0; // average per frame
        processing_times.push(elapsed_ms);

        println!("\nShop #{}: {} [Proc: {:.1} ms]", shop_idx + 1, shop_name, elapsed_ms);

        for (slot_idx, &expected_api) in units.iter().enumerate() {
            let slot = &status.slots[slot_idx];
            let expected_name = candidate_names.get(expected_api).cloned().unwrap_or(expected_api.to_string());
            let recognized_api = slot.champion_id.clone();
            let recognized_name = slot.champion_name.clone();

            let status_str = match &recognized_api {
                Some(id) if id == expected_api => {
                    total_correct += 1;
                    confidences_correct.push(slot.confidence);
                    margins_correct.push(slot.margin);
                    "correct"
                }
                Some(id) => {
                    total_wrong += 1;
                    confidences_wrong.push(slot.confidence);
                    *confusion_map.entry((expected_api.to_string(), id.clone())).or_insert(0) += 1;
                    "wrong"
                }
                None => {
                    total_unknown += 1;
                    if let Some(ref sec) = slot.second_best_champion_id {
                        *confusion_map.entry((expected_api.to_string(), sec.clone())).or_insert(0) += 1;
                    }
                    "unknown"
                }
            };

            let mark = match status_str {
                "correct" => "[OK]",
                "wrong" => "[WRONG]",
                _ => "[UNKNOWN]",
            };

            println!(
                "  Slot {}: {} (Expected: {}) - Conf: {:.0}%, Sec: {}, Margin: {:.1}% {}",
                slot_idx + 1,
                recognized_name.as_deref().unwrap_or("UNKNOWN"),
                expected_name,
                slot.confidence * 100.0,
                slot.second_best_champion_id.as_deref().unwrap_or("None"),
                slot.margin * 100.0,
                mark
            );

            observations.push(SlotAuditObservation {
                frame_generation: status.generation,
                slot_index: slot_idx,
                recognized_canonical_id: recognized_api,
                actual_canonical_id: Some(expected_api.to_string()),
                recognized_name,
                actual_name: Some(expected_name),
                confidence: slot.confidence,
                second_candidate_id: slot.second_best_champion_id.clone(),
                second_score: slot.second_best_confidence,
                margin: slot.margin,
                status: status_str.to_string(),
                stable: slot.stable,
                recognition_time_ms: elapsed_ms,
                geometry_version: "tft-1080p-v1".to_string(),
                recognition_version: RECOGNITION_VERSION.to_string(),
            });
        }
    }

    let total_slots = observations.len();
    let emitted = total_correct + total_wrong;
    let emitted_accuracy = if emitted > 0 { total_correct as f32 / emitted as f32 } else { 0.0 };
    let coverage = if total_slots > 0 { emitted as f32 / total_slots as f32 } else { 0.0 };

    let mean_conf_correct = if !confidences_correct.is_empty() {
        confidences_correct.iter().sum::<f32>() / confidences_correct.len() as f32
    } else { 0.0 };

    let mean_conf_wrong = if !confidences_wrong.is_empty() {
        confidences_wrong.iter().sum::<f32>() / confidences_wrong.len() as f32
    } else { 0.0 };

    let mean_margin_correct = if !margins_correct.is_empty() {
        margins_correct.iter().sum::<f32>() / margins_correct.len() as f32
    } else { 0.0 };

    let mean_proc_time = if !processing_times.is_empty() {
        processing_times.iter().sum::<f32>() / processing_times.len() as f32
    } else { 0.0 };

    let mut confusion_pairs: Vec<ConfusionPair> = confusion_map.into_iter().map(|((exp, cand), count)| {
        let note = if cand.contains("Amumu") && exp.contains("Akali") {
            "Shared bright orange/yellow fire palette; gated by margin threshold".to_string()
        } else {
            "Near-color or shadow palette similarity".to_string()
        };
        ConfusionPair { expected: exp, candidate: cand, count, note }
    }).collect();
    confusion_pairs.sort_by(|a, b| b.count.cmp(&a.count));

    let now_secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    let report = ShopVisionAuditReport {
        audit_timestamp: format!("timestamp-unix-{}", now_secs),
        geometry_version: "tft-1080p-v1".to_string(),
        recognition_version: RECOGNITION_VERSION.to_string(),
        total_shops: test_shops.len(),
        total_slots_labeled: total_slots,
        correct: total_correct,
        wrong: total_wrong,
        unknown: total_unknown,
        emitted_accuracy: (emitted_accuracy * 1000.0).round() / 1000.0,
        coverage: (coverage * 1000.0).round() / 1000.0,
        mean_confidence_correct: (mean_conf_correct * 1000.0).round() / 1000.0,
        mean_confidence_wrong: (mean_conf_wrong * 1000.0).round() / 1000.0,
        mean_margin_correct: (mean_margin_correct * 1000.0).round() / 1000.0,
        mean_recognition_time_ms: (mean_proc_time * 10.0).round() / 10.0,
        confusion_pairs,
        observations,
    };

    let report_json = serde_json::to_string_pretty(&report).unwrap();
    let report_path = PathBuf::from("artifacts/shop_vision_audit.json");
    std::fs::create_dir_all("artifacts").unwrap();
    std::fs::write(&report_path, &report_json).unwrap();
    println!("\n=== AUDIT COMPLETE ===");
    println!("Saved audit report to: {}", report_path.display());
    println!("Shops observed: {}", report.total_shops);
    println!("Slots labeled: {}", report.total_slots_labeled);
    println!("Correct: {}", report.correct);
    println!("Wrong: {}", report.wrong);
    println!("Unknown: {}", report.unknown);
    println!("Emitted accuracy: {:.1}%", report.emitted_accuracy * 100.0);
    println!("Coverage: {:.1}%", report.coverage * 100.0);
    println!("Mean confidence (correct): {:.1}%", report.mean_confidence_correct * 100.0);
    println!("Mean margin (correct): {:.1}%", report.mean_margin_correct * 100.0);
    println!("Mean recognition time: {:.1} ms", report.mean_recognition_time_ms);
}
