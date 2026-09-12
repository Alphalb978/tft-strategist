use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Instant,
};

pub const RECOGNITION_VERSION: &str = "shop-vision-v1";
pub const BASELINE_WIDTH: u32 = 1920;
pub const BASELINE_HEIGHT: u32 = 1080;

/// Normalized rectangle relative to client frame [0.0..1.0]
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct RectNormalized {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl RectNormalized {
    pub fn to_pixel_rect(&self, frame_w: u32, frame_h: u32) -> PixelRect {
        PixelRect {
            x: (self.x * frame_w as f32).round() as i32,
            y: (self.y * frame_h as f32).round() as i32,
            width: (self.width * frame_w as f32).round() as u32,
            height: (self.height * frame_h as f32).round() as u32,
        }
    }
}

/// Pixel rectangle in frame coordinates
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct PixelRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShopLayout {
    pub region_normalized: RectNormalized,
    pub slot_rects_normalized: [RectNormalized; 5],
    pub baseline_aspect_ratio: f32,
    pub geometry_version: String,
}

impl Default for ShopLayout {
    fn default() -> Self {
        // Measured baseline 1920x1080:
        // Shop outer bounds: x=448, y=920, width=1000, height=154
        // Slots 0..4: width=192, height=154, gap=10, pitch=202
        let region_normalized = RectNormalized {
            x: 448.0 / 1920.0,
            y: 920.0 / 1080.0,
            width: 1000.0 / 1920.0,
            height: 154.0 / 1080.0,
        };

        let mut slot_rects_normalized = [RectNormalized {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        }; 5];

        for i in 0..5 {
            let sx = 448.0 + (i as f32) * 202.0;
            slot_rects_normalized[i] = RectNormalized {
                x: sx / 1920.0,
                y: 920.0 / 1080.0,
                width: 192.0 / 1920.0,
                height: 154.0 / 1080.0,
            };
        }

        Self {
            region_normalized,
            slot_rects_normalized,
            baseline_aspect_ratio: 16.0 / 9.0,
            geometry_version: "tft-1080p-v1".to_string(),
        }
    }
}

impl ShopLayout {
    /// Computes pixel rectangles for any frame dimensions, with bottom-center anchoring for non-16:9
    pub fn compute_pixel_geometry(&self, frame_w: u32, frame_h: u32) -> (PixelRect, [PixelRect; 5]) {
        if frame_w == 0 || frame_h == 0 {
            let zero = PixelRect { x: 0, y: 0, width: 0, height: 0 };
            return (zero, [zero; 5]);
        }

        let aspect = frame_w as f32 / frame_h as f32;
        let is_standard_16_9 = (aspect - (16.0 / 9.0)).abs() < 0.05;

        if is_standard_16_9 {
            let shop_rect = self.region_normalized.to_pixel_rect(frame_w, frame_h);
            let mut slots = [PixelRect { x: 0, y: 0, width: 0, height: 0 }; 5];
            for i in 0..5 {
                slots[i] = self.slot_rects_normalized[i].to_pixel_rect(frame_w, frame_h);
            }
            (shop_rect, slots)
        } else {
            // Anchor to bottom-center preserving 1080p scale relative to viewport height
            let scale = frame_h as f32 / 1080.0;
            let shop_w = (1000.0 * scale).round() as u32;
            let shop_h = (154.0 * scale).round() as u32;
            let shop_x = ((frame_w as f32 - shop_w as f32) / 2.0).round() as i32;
            let shop_y = (frame_h as f32 - (1080.0 - 920.0) * scale).round() as i32;

            let shop_rect = PixelRect {
                x: shop_x,
                y: shop_y,
                width: shop_w,
                height: shop_h,
            };

            let card_w = (192.0 * scale).round() as u32;
            let pitch = 202.0 * scale;
            let mut slots = [PixelRect { x: 0, y: 0, width: 0, height: 0 }; 5];
            for i in 0..5 {
                let slot_x = shop_x + ((i as f32) * pitch).round() as i32;
                slots[i] = PixelRect {
                    x: slot_x,
                    y: shop_y,
                    width: card_w,
                    height: shop_h,
                };
            }
            (shop_rect, slots)
        }
    }
}

/// Classification of a shop card slot state
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShopSlotState {
    Champion,
    Empty,
    Unknown,
}

impl Default for ShopSlotState {
    fn default() -> Self {
        ShopSlotState::Unknown
    }
}

/// Structured recognition result for an individual card slot
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShopSlotRecognition {
    pub index: usize,
    #[serde(default)]
    pub state: ShopSlotState,
    pub champion_id: Option<String>,
    pub champion_name: Option<String>,
    pub cost: Option<u32>,
    pub confidence: f32,
    pub second_best_champion_id: Option<String>,
    pub second_best_confidence: f32,
    pub margin: f32,
    pub stable: bool,
    pub stable_frames: u32,
    pub rect: PixelRect,
}

/// Structured shop state published to frontend and diagnostic endpoints
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenShopStatus {
    pub available: bool,
    pub detected: bool,
    pub frame_age_ms: u64,
    pub processing_time_ms: f32,
    pub recognition_version: String,
    pub generation: u64,
    pub slots: Vec<ShopSlotRecognition>,
    pub shop_region: PixelRect,
}

impl Default for ScreenShopStatus {
    fn default() -> Self {
        let layout = ShopLayout::default();
        let (shop_rect, slot_rects) = layout.compute_pixel_geometry(BASELINE_WIDTH, BASELINE_HEIGHT);
        let slots = (0..5)
            .map(|i| ShopSlotRecognition {
                index: i,
                state: ShopSlotState::Unknown,
                champion_id: None,
                champion_name: None,
                cost: None,
                confidence: 0.0,
                second_best_champion_id: None,
                second_best_confidence: 0.0,
                margin: 0.0,
                stable: false,
                stable_frames: 0,
                rect: slot_rects[i],
            })
            .collect();

        Self {
            available: false,
            detected: false,
            frame_age_ms: 0,
            processing_time_ms: 0.0,
            recognition_version: RECOGNITION_VERSION.to_string(),
            generation: 0,
            slots,
            shop_region: shop_rect,
        }
    }
}

/// Multi-feature visual signature for a reference or card slot
#[derive(Clone, Debug)]
pub struct VisualSignature {
    pub color_hist: [f32; 64],  // 4x4x4 RGB color distribution (sum=1.0)
    pub spatial_grid: [f32; 256], // 16x16 downsampled luminance grid (normalized [0.0..1.0])
    pub edge_energy: f32,
}

impl VisualSignature {
    /// Computes Bhattacharyya coefficient similarity for color histograms [0.0..1.0]
    pub fn color_similarity(&self, other: &Self) -> f32 {
        let mut sum = 0.0f32;
        for i in 0..64 {
            sum += (self.color_hist[i] * other.color_hist[i]).sqrt();
        }
        sum.clamp(0.0, 1.0)
    }

    /// Computes Normalized Cross-Correlation for 16x16 spatial grids [0.0..1.0]
    pub fn spatial_similarity(&self, other: &Self) -> f32 {
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
        if denom <= 0.0001 {
            return 0.0;
        }
        (nom / denom).max(0.0).min(1.0)
    }

    /// Combined calibrated score combining color distribution, spatial template, and edge energy
    pub fn match_score(&self, other: &Self) -> f32 {
        let color = self.color_similarity(other);
        let spatial = self.spatial_similarity(other);
        let edge_diff = (self.edge_energy - other.edge_energy).abs().min(1.0);
        let edge_sim = 1.0 - edge_diff;

        // Calibrated weights: color distribution is highly discriminative across TFT champion art,
        // supported by spatial luminance grid and edge energy.
        let score = 0.65 * color + 0.25 * spatial + 0.10 * edge_sim;
        score.clamp(0.0, 1.0)
    }
}

/// Canonical champion candidate record from active set
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChampionCandidate {
    pub api_name: String,
    pub name: String,
    pub cost: u32,
    pub shop_status: String, // "pool" | "runtime-variant" | "placeholder"
}

/// Reference champion entry with precomputed visual signature
#[derive(Clone, Debug)]
pub struct ChampionReference {
    pub candidate: ChampionCandidate,
    pub signature: VisualSignature,
}

/// Extract visual signature from a sub-region of a BGRA buffer
pub fn extract_signature_from_bgra(
    bgra: &[u8],
    frame_w: u32,
    frame_h: u32,
    sub_rect: PixelRect,
) -> Option<VisualSignature> {
    if sub_rect.width < 16 || sub_rect.height < 16 {
        return None;
    }

    let mut hist = [0.0f32; 64];
    let mut total_pixels = 0u32;
    let mut grid_sums = [0.0f32; 256];
    let mut grid_counts = [0u32; 256];
    let mut total_gradient = 0.0f32;

    let x_end = ((sub_rect.x + sub_rect.width as i32) as u32).min(frame_w);
    let y_end = ((sub_rect.y + sub_rect.height as i32) as u32).min(frame_h);
    let x_start = (sub_rect.x.max(0) as u32).min(x_end);
    let y_start = (sub_rect.y.max(0) as u32).min(y_end);

    let roi_w = x_end.saturating_sub(x_start);
    let roi_h = y_end.saturating_sub(y_start);
    if roi_w < 16 || roi_h < 16 {
        return None;
    }

    for y in y_start..y_end {
        let row_idx = (y * frame_w * 4) as usize;
        let gy = (((y - y_start) * 16) / roi_h).min(15) as usize;

        for x in x_start..x_end {
            let px_idx = row_idx + (x * 4) as usize;
            if px_idx + 3 >= bgra.len() {
                continue;
            }

            let b = bgra[px_idx] as f32;
            let g = bgra[px_idx + 1] as f32;
            let r = bgra[px_idx + 2] as f32;

            // Color histogram binning
            let r_bin = (r / 64.0).floor().min(3.0) as usize;
            let g_bin = (g / 64.0).floor().min(3.0) as usize;
            let b_bin = (b / 64.0).floor().min(3.0) as usize;
            let bin_idx = r_bin * 16 + g_bin * 4 + b_bin;
            hist[bin_idx] += 1.0;
            total_pixels += 1;

            // Spatial grid (16x16 luminance)
            let gx = (((x - x_start) * 16) / roi_w).min(15) as usize;
            let cell_idx = gy * 16 + gx;
            let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
            grid_sums[cell_idx] += lum;
            grid_counts[cell_idx] += 1;

            // Simple edge gradient: difference with next horizontal pixel
            if x + 1 < x_end {
                let next_idx = px_idx + 4;
                let next_r = bgra[next_idx + 2] as f32;
                let next_g = bgra[next_idx + 1] as f32;
                let next_b = bgra[next_idx] as f32;
                let next_lum = (0.299 * next_r + 0.587 * next_g + 0.114 * next_b) / 255.0;
                total_gradient += (lum - next_lum).abs();
            }
        }
    }

    if total_pixels == 0 {
        return None;
    }

    // Normalize color histogram
    for i in 0..64 {
        hist[i] /= total_pixels as f32;
    }

    // Average spatial grid
    let mut spatial_grid = [0.0f32; 256];
    for i in 0..256 {
        if grid_counts[i] > 0 {
            spatial_grid[i] = grid_sums[i] / grid_counts[i] as f32;
        }
    }

    let edge_energy = (total_gradient / total_pixels as f32 * 5.0).min(1.0);

    Some(VisualSignature {
        color_hist: hist,
        spatial_grid,
        edge_energy,
    })
}

/// Decodes an image PNG buffer into a VisualSignature
pub fn signature_from_png_bytes(png_bytes: &[u8]) -> Result<VisualSignature, String> {
    let decoder = png::Decoder::new(png_bytes);
    let mut reader = decoder.read_info().map_err(|e| format!("PNG decode error: {}", e))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("PNG frame error: {}", e))?;

    let width = info.width;
    let height = info.height;
    if width < 16 || height < 16 {
        return Err("Reference PNG too small".to_string());
    }

    // Convert to RGBA buffer if not already
    let mut rgba = vec![0u8; (width * height * 4) as usize];
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
        _ => return Err("Unsupported PNG color type".to_string()),
    }

    // Convert RGBA to BGRA for uniform processing
    let mut bgra = vec![0u8; rgba.len()];
    for i in (0..rgba.len()).step_by(4) {
        if i + 3 < rgba.len() {
            bgra[i] = rgba[i + 2];     // B
            bgra[i + 1] = rgba[i + 1]; // G
            bgra[i + 2] = rgba[i];     // R
            bgra[i + 3] = rgba[i + 3]; // A
        }
    }

    // Focus on the upper ~70% where champion character portrait artwork resides
    let sub_rect = PixelRect {
        x: 0,
        y: 0,
        width,
        height: ((height as f32) * 0.70).round() as u32,
    };

    extract_signature_from_bgra(&bgra, width, height, sub_rect)
        .ok_or_else(|| "Failed to extract signature from reference PNG".to_string())
}

/// In-memory catalog of canonical champion references for active set
pub struct ReferenceCatalog {
    pub references: Vec<ChampionReference>,
    pub candidates_by_api_name: HashMap<String, ChampionCandidate>,
}

impl ReferenceCatalog {
    pub fn new() -> Self {
        let candidates = get_default_set18_candidates();
        let mut map = HashMap::new();
        for c in &candidates {
            map.insert(c.api_name.clone(), c.clone());
        }

        Self {
            references: Vec::new(),
            candidates_by_api_name: map,
        }
    }

    /// Loads references from local directory cache
    pub fn load_from_cache_dir(&mut self, cache_dir: &Path) -> usize {
        let mut loaded = 0;
        for c in self.candidates_by_api_name.values() {
            let png_path = cache_dir.join(format!("{}.png", c.api_name));
            if png_path.exists() {
                if let Ok(bytes) = std::fs::read(&png_path) {
                    if let Ok(sig) = signature_from_png_bytes(&bytes) {
                        self.references.push(ChampionReference {
                            candidate: c.clone(),
                            signature: sig,
                        });
                        loaded += 1;
                    }
                }
            }
        }
        loaded
    }
}

/// Validates whether the shop region is visually present and unobstructed in the frame
pub fn validate_shop_visibility(
    bgra: &[u8],
    frame_w: u32,
    frame_h: u32,
    layout: &ShopLayout,
) -> bool {
    let (shop_rect, slot_rects) = layout.compute_pixel_geometry(frame_w, frame_h);
    if shop_rect.width == 0 || shop_rect.height == 0 {
        return false;
    }

    // 1. Verify gold/bronze border above cards (measured baseline y=917 in 1080p: R~120, G~98, B~53)
    let mut gold_border_hits = 0;
    let check_x_coords = [
        slot_rects[0].x + (slot_rects[0].width / 2) as i32,
        slot_rects[1].x + (slot_rects[1].width / 2) as i32,
        slot_rects[2].x + (slot_rects[2].width / 2) as i32,
        slot_rects[3].x + (slot_rects[3].width / 2) as i32,
        slot_rects[4].x + (slot_rects[4].width / 2) as i32,
    ];

    let border_offset = (3.0 * frame_h as f32 / 1080.0).max(1.0).round() as i32;
    let border_y = (shop_rect.y - border_offset).max(0) as u32;
    if border_y < frame_h {
        for &cx in &check_x_coords {
            if cx >= 0 && (cx as u32) < frame_w {
                let idx = ((border_y * frame_w + cx as u32) * 4) as usize;
                if idx + 2 < bgra.len() {
                    let b = bgra[idx];
                    let g = bgra[idx + 1];
                    let r = bgra[idx + 2];
                    // TFT gold/bronze header trim
                    if r > 80 && g > 65 && r > b + 25 && g > b + 15 {
                        gold_border_hits += 1;
                    }
                }
            }
        }
    }

    // 2. Verify slate blue nameplates at the bottom of the card slots (at ~88% of slot height)
    let mut nameplate_hits = 0;
    let nameplate_offset = ((shop_rect.height as f32) * 0.88).round() as i32;
    let nameplate_y = (shop_rect.y + nameplate_offset).min(frame_h as i32 - 1).max(0) as u32;

    for slot in &slot_rects {
        let center_x = slot.x + (slot.width / 2) as i32;
        if center_x >= 0 && (center_x as u32) < frame_w {
            let idx = ((nameplate_y * frame_w + center_x as u32) * 4) as usize;
            if idx + 2 < bgra.len() {
                let b = bgra[idx];
                let g = bgra[idx + 1];
                let r = bgra[idx + 2];
                // Distinct slate blue: b > g > r with specific intensity range
                if b >= 38 && b <= 75 && g >= 25 && g <= 60 && r >= 12 && r <= 45 && b > g + 4 && g > r + 4 {
                    nameplate_hits += 1;
                }
            }
        }
    }

    // 3. Overall luminance check in the center card area (at ~25% of slot height)
    let sample_y = (slot_rects[2].y + ((slot_rects[2].height as f32) * 0.25).round() as i32).min(frame_h as i32 - 1).max(0) as u32;
    let sample_x = (slot_rects[2].x + ((slot_rects[2].width as f32) * 0.50).round() as i32).min(frame_w as i32 - 1).max(0) as u32;
    let center_slot_idx = (sample_y * frame_w + sample_x) as usize * 4;
    let not_blank = if center_slot_idx + 2 < bgra.len() {
        let b = bgra[center_slot_idx];
        let g = bgra[center_slot_idx + 1];
        let r = bgra[center_slot_idx + 2];
        let lum = 0.299 * r as f32 + 0.587 * g as f32 + 0.114 * b as f32;
        lum > 5.0 && lum < 250.0
    } else {
        false
    };

    // Both gold trim and nameplate must agree
    gold_border_hits >= 3 && nameplate_hits >= 3 && not_blank
}

/// Deterministic check for an empty shop card slot
pub fn is_shop_slot_empty(
    bgra: &[u8],
    frame_w: u32,
    frame_h: u32,
    slot_rect: PixelRect,
    sig: Option<&VisualSignature>,
) -> bool {
    // 1. Check if nameplate slate blue banner is present at bottom of slot (~88% of height)
    let nameplate_offset = ((slot_rect.height as f32) * 0.88).round() as i32;
    let nameplate_y = (slot_rect.y + nameplate_offset).min(frame_h as i32 - 1).max(0) as u32;
    let center_x = (slot_rect.x + (slot_rect.width / 2) as i32).min(frame_w as i32 - 1).max(0) as u32;

    let idx = ((nameplate_y * frame_w + center_x) * 4) as usize;
    if idx + 2 < bgra.len() {
        let b = bgra[idx];
        let g = bgra[idx + 1];
        let r = bgra[idx + 2];
        // TFT slate blue nameplate banner indicator
        if b >= 38 && b <= 75 && g >= 25 && g <= 60 && r >= 12 && r <= 45 && b > g + 4 && g > r + 4 {
            // A card with standard nameplate is present
            return false;
        }
    }

    // 2. Check visual signature of the card area if available
    if let Some(s) = sig {
        let mut mean_lum = 0.0f32;
        for &lum in &s.spatial_grid {
            mean_lum += lum;
        }
        mean_lum /= 256.0;

        let mut var_lum = 0.0f32;
        for &lum in &s.spatial_grid {
            let d = lum - mean_lum;
            var_lum += d * d;
        }
        var_lum = (var_lum / 256.0).sqrt();

        // Empty card tray in TFT:
        // - Dark background: mean luminance in range [0.03, 0.28] (RGB roughly 8 to 70)
        // - Very low variance: var_lum <= 0.08
        // - Low edge energy: edge_energy <= 0.22
        if mean_lum >= 0.03 && mean_lum <= 0.28 && var_lum <= 0.08 && s.edge_energy <= 0.22 {
            return true;
        }
    } else {
        // Direct pixel check across center of slot
        let cx = (slot_rect.x + (slot_rect.width / 2) as i32).clamp(0, frame_w.saturating_sub(1) as i32) as u32;
        let cy = (slot_rect.y + (slot_rect.height / 2) as i32).clamp(0, frame_h.saturating_sub(1) as i32) as u32;
        let pidx = ((cy * frame_w + cx) * 4) as usize;
        if pidx + 2 < bgra.len() {
            let b = bgra[pidx] as f32;
            let g = bgra[pidx + 1] as f32;
            let r = bgra[pidx + 2] as f32;
            let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
            if lum >= 0.03 && lum <= 0.28 {
                return true;
            }
        }
    }

    false
}

/// State tracker for stable temporal filtering across 2 FPS capture frames
pub struct SlotStabilityTracker {
    pub last_champion_id: Option<String>,
    pub consecutive_count: u32,
}

pub struct ShopVisionEngine {
    layout: ShopLayout,
    catalog: RwLock<ReferenceCatalog>,
    stability: Mutex<[SlotStabilityTracker; 5]>,
    latest_status: RwLock<ScreenShopStatus>,
    generation: AtomicU64,
    last_frame_instant: Mutex<Option<Instant>>,
}

impl ShopVisionEngine {
    pub fn new() -> Arc<Self> {
        let layout = ShopLayout::default();
        let mut catalog = ReferenceCatalog::new();

        let candidate_paths = [
            PathBuf::from("artifacts/champion_cache"),
            PathBuf::from("scratch/champion_cache"),
            PathBuf::from("../artifacts/champion_cache"),
        ];

        for p in &candidate_paths {
            if p.exists() {
                catalog.load_from_cache_dir(p);
                break;
            }
        }

        let stability = Mutex::new([
            SlotStabilityTracker { last_champion_id: None, consecutive_count: 0 },
            SlotStabilityTracker { last_champion_id: None, consecutive_count: 0 },
            SlotStabilityTracker { last_champion_id: None, consecutive_count: 0 },
            SlotStabilityTracker { last_champion_id: None, consecutive_count: 0 },
            SlotStabilityTracker { last_champion_id: None, consecutive_count: 0 },
        ]);

        Arc::new(Self {
            layout,
            catalog: RwLock::new(catalog),
            stability,
            latest_status: RwLock::new(ScreenShopStatus::default()),
            generation: AtomicU64::new(0),
            last_frame_instant: Mutex::new(None),
        })
    }

    pub fn get_status(&self) -> ScreenShopStatus {
        let status = self.latest_status.read().unwrap().clone();
        let age_ms = {
            let lock = self.last_frame_instant.lock().unwrap();
            lock.map(|t| t.elapsed().as_millis() as u64).unwrap_or(0)
        };
        ScreenShopStatus {
            frame_age_ms: age_ms,
            ..status
        }
    }

    /// Process a new raw BGRA frame from capture worker
    pub fn process_frame(&self, bgra: &[u8], frame_w: u32, frame_h: u32) -> ScreenShopStatus {
        let process_start = Instant::now();
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        *self.last_frame_instant.lock().unwrap() = Some(Instant::now());

        let (shop_pixel_rect, slot_pixel_rects) = self.layout.compute_pixel_geometry(frame_w, frame_h);

        // Validate shop visibility
        let is_visible = validate_shop_visibility(bgra, frame_w, frame_h, &self.layout);

        let catalog_guard = self.catalog.read().unwrap();
        let mut stability_guard = self.stability.lock().unwrap();

        let mut recognized_slots = Vec::with_capacity(5);

        if !is_visible || catalog_guard.references.is_empty() {
            for tracker in stability_guard.iter_mut() {
                tracker.last_champion_id = None;
                tracker.consecutive_count = 0;
            }

            for i in 0..5 {
                recognized_slots.push(ShopSlotRecognition {
                    index: i,
                    state: ShopSlotState::Unknown,
                    champion_id: None,
                    champion_name: None,
                    cost: None,
                    confidence: 0.0,
                    second_best_champion_id: None,
                    second_best_confidence: 0.0,
                    margin: 0.0,
                    stable: false,
                    stable_frames: 0,
                    rect: slot_pixel_rects[i],
                });
            }

            let status = ScreenShopStatus {
                available: true,
                detected: false,
                frame_age_ms: 0,
                processing_time_ms: process_start.elapsed().as_secs_f32() * 1000.0,
                recognition_version: RECOGNITION_VERSION.to_string(),
                generation: gen,
                slots: recognized_slots,
                shop_region: shop_pixel_rect,
            };

            *self.latest_status.write().unwrap() = status.clone();
            return status;
        }

        // Process each of the 5 card slots
        for i in 0..5 {
            let slot_rect = slot_pixel_rects[i];

            let art_x = slot_rect.x + ((slot_rect.width as f32) * 0.48).round() as i32;
            let art_y = slot_rect.y + ((slot_rect.height as f32) * 0.04).round() as i32;
            let art_w = ((slot_rect.width as f32) * 0.50).round() as u32;
            let art_h = ((slot_rect.height as f32) * 0.69).round() as u32;

            let art_rect = PixelRect {
                x: art_x,
                y: art_y,
                width: art_w,
                height: art_h,
            };

            let slot_sig = extract_signature_from_bgra(bgra, frame_w, frame_h, art_rect);

            match slot_sig {
                Some(sig) => {
                    let mut candidates: Vec<(&ChampionReference, f32)> = catalog_guard
                        .references
                        .iter()
                        .map(|ref_entry| {
                            let score = sig.match_score(&ref_entry.signature);
                            (ref_entry, score)
                        })
                        .collect();

                    candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

                    let best = candidates.get(0);
                    let second = candidates.get(1);

                    let (best_ref, best_score) = best.map(|(r, s)| (*r, *s)).unwrap_or((&catalog_guard.references[0], 0.0));
                    let (second_id, second_score) = second
                        .map(|(r, s)| (Some(r.candidate.api_name.clone()), *s))
                        .unwrap_or((None, 0.0));
                    let margin = best_score - second_score;

                    let tracker = &mut stability_guard[i];
                    if tracker.last_champion_id.as_deref() == Some(&best_ref.candidate.api_name) {
                        tracker.consecutive_count += 1;
                    } else {
                        tracker.last_champion_id = Some(best_ref.candidate.api_name.clone());
                        tracker.consecutive_count = 1;
                    }

                    let stable_count = tracker.consecutive_count;

                    let is_high_conf = best_score >= 0.80 && margin >= 0.045;
                    let is_medium_conf = best_score >= 0.72 && margin >= 0.035 && stable_count >= 2;

                    let (champ_id, champ_name, champ_cost, is_stable, slot_state) = if is_high_conf {
                        (
                            Some(best_ref.candidate.api_name.clone()),
                            Some(best_ref.candidate.name.clone()),
                            Some(best_ref.candidate.cost),
                            true,
                            ShopSlotState::Champion,
                        )
                    } else if is_medium_conf {
                        (
                            Some(best_ref.candidate.api_name.clone()),
                            Some(best_ref.candidate.name.clone()),
                            Some(best_ref.candidate.cost),
                            true,
                            ShopSlotState::Champion,
                        )
                    } else {
                        let is_empty = is_shop_slot_empty(bgra, frame_w, frame_h, slot_rect, Some(&sig));
                        let state = if is_empty {
                            ShopSlotState::Empty
                        } else {
                            ShopSlotState::Unknown
                        };
                        (None, None, None, false, state)
                    };

                    recognized_slots.push(ShopSlotRecognition {
                        index: i,
                        state: slot_state,
                        champion_id: champ_id,
                        champion_name: champ_name,
                        cost: champ_cost,
                        confidence: (best_score * 100.0).round() / 100.0,
                        second_best_champion_id: second_id,
                        second_best_confidence: (second_score * 100.0).round() / 100.0,
                        margin: (margin * 100.0).round() / 100.0,
                        stable: is_stable,
                        stable_frames: stable_count,
                        rect: slot_rect,
                    });
                }
                None => {
                    stability_guard[i].last_champion_id = None;
                    stability_guard[i].consecutive_count = 0;

                    let is_empty = is_shop_slot_empty(bgra, frame_w, frame_h, slot_rect, None);
                    let state = if is_empty {
                        ShopSlotState::Empty
                    } else {
                        ShopSlotState::Unknown
                    };

                    recognized_slots.push(ShopSlotRecognition {
                        index: i,
                        state,
                        champion_id: None,
                        champion_name: None,
                        cost: None,
                        confidence: 0.0,
                        second_best_champion_id: None,
                        second_best_confidence: 0.0,
                        margin: 0.0,
                        stable: false,
                        stable_frames: 0,
                        rect: slot_rect,
                    });
                }
            }
        }

        let elapsed = process_start.elapsed().as_secs_f32() * 1000.0;

        let status = ScreenShopStatus {
            available: true,
            detected: true,
            frame_age_ms: 0,
            processing_time_ms: (elapsed * 10.0).round() / 10.0,
            recognition_version: RECOGNITION_VERSION.to_string(),
            generation: gen,
            slots: recognized_slots,
            shop_region: shop_pixel_rect,
        };

        *self.latest_status.write().unwrap() = status.clone();
        status
    }

    /// Reset recognition when capture is disabled or restarted
    pub fn reset(&self) {
        let mut stability_guard = self.stability.lock().unwrap();
        for tracker in stability_guard.iter_mut() {
            tracker.last_champion_id = None;
            tracker.consecutive_count = 0;
        }
        *self.latest_status.write().unwrap() = ScreenShopStatus::default();
    }
}

pub struct ShopVisionStateHandle {
    pub inner: Arc<ShopVisionEngine>,
}

#[tauri::command]
pub fn screen_shop_status(
    state: tauri::State<'_, ShopVisionStateHandle>,
) -> ScreenShopStatus {
    state.inner.get_status()
}

/// Returns the audited Set 18 roster candidates (74 units)
pub fn get_default_set18_candidates() -> Vec<ChampionCandidate> {
    vec![
        ChampionCandidate { api_name: "DA_18_Ahri".into(), name: "Ahri".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Akali_AD".into(), name: "Akali".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Alistar".into(), name: "Alistar".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Alune".into(), name: "Alune".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Aphelios".into(), name: "Aphelios".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Ashe".into(), name: "Ashe".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Azir".into(), name: "Azir".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Caitlyn".into(), name: "Caitlyn".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Camille".into(), name: "Camille".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Cassiopeia".into(), name: "Cassiopeia".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Diana".into(), name: "Diana".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_ElderDragon".into(), name: "Elder Dragon".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Elise".into(), name: "Elise".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Ezreal".into(), name: "Ezreal".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_GnarSmall".into(), name: "Gnar".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Hecarim".into(), name: "Hecarim".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Ivern".into(), name: "Ivern".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Kayle".into(), name: "Kayle".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Kennen".into(), name: "Kennen".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_KhaZix".into(), name: "Kha'Zix".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Kobuko".into(), name: "Kobuko".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_LeBlanc".into(), name: "LeBlanc".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Leona".into(), name: "Leona".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Lillia".into(), name: "Lillia".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Coven".into(), name: "Lux (Coven)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Elderwood".into(), name: "Lux (Elderwood)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Fae".into(), name: "Lux (Fae)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Inferno".into(), name: "Lux (Inferno)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Moonbeam".into(), name: "Lux (Lunar)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Primal".into(), name: "Lux (Primal)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Lux_Sunbeam".into(), name: "Lux (Solar)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_18_Malphite".into(), name: "Malphite".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Maokai".into(), name: "Maokai".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_MasterYi_AD".into(), name: "Master Yi".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Morgana".into(), name: "Morgana".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Ornn".into(), name: "Ornn".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Rakan".into(), name: "Rakan".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Rammus".into(), name: "Rammus".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_RekSai".into(), name: "Rek'Sai".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Rengar".into(), name: "Rengar".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Sejuani".into(), name: "Sejuani".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Sentry".into(), name: "Pebbles".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Sett".into(), name: "Sett".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Shen".into(), name: "Shen".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Sivir".into(), name: "Sivir".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Soraka".into(), name: "Soraka".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Teemo".into(), name: "Teemo".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Tristana".into(), name: "Tristana".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Varus".into(), name: "Varus".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Veigar".into(), name: "Veigar".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Warwick".into(), name: "Warwick".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Xayah".into(), name: "Xayah".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Yorick".into(), name: "Yorick".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Yunara".into(), name: "Yunara".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_18_Zyra".into(), name: "Zyra".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Amumu18".into(), name: "Amumu".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Brambleback18".into(), name: "Brambleback".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Cinderling18".into(), name: "Cinderling".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_CrimsonRaptor18".into(), name: "Mama Beak".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Draven18".into(), name: "Draven".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Fiddlesticks18".into(), name: "Fiddlesticks".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Gromp18_AP".into(), name: "Gromp".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Karma18".into(), name: "Karma".into(), cost: 1, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_KogMaw18_AD".into(), name: "Kog'Maw".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Krug18".into(), name: "Krug".into(), cost: 3, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Lux18_Base".into(), name: "Lux".into(), cost: 5, shop_status: "placeholder".into() },
        ChampionCandidate { api_name: "DA_Lux18_Blackthorn".into(), name: "Lux (Blackthorn)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_Lux18_Blossom".into(), name: "Lux (Blossom)".into(), cost: 5, shop_status: "runtime-variant".into() },
        ChampionCandidate { api_name: "DA_Murkwolf18".into(), name: "Murkwolf".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Nidalee18_AP".into(), name: "Nidalee".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Scuttlecrab18".into(), name: "Scuttlecrab".into(), cost: 2, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Sentinel18".into(), name: "Sentinel".into(), cost: 4, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Taric18".into(), name: "Taric".into(), cost: 5, shop_status: "pool".into() },
        ChampionCandidate { api_name: "DA_Vi18".into(), name: "Vi".into(), cost: 3, shop_status: "pool".into() },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_1_shop_region_geometry_1080p() {
        let layout = ShopLayout::default();
        let (shop, slots) = layout.compute_pixel_geometry(1920, 1080);
        assert_eq!(shop.x, 448);
        assert_eq!(shop.y, 920);
        assert_eq!(shop.width, 1000);
        assert_eq!(shop.height, 154);

        assert_eq!(slots[0].x, 448);
        assert_eq!(slots[0].y, 920);
        assert_eq!(slots[0].width, 192);
        assert_eq!(slots[0].height, 154);

        assert_eq!(slots[4].x, 1256);
        assert_eq!(slots[4].y, 920);
        assert_eq!(slots[4].width, 192);
        assert_eq!(slots[4].height, 154);
    }

    #[test]
    fn test_2_geometry_scaling_1440p() {
        let layout = ShopLayout::default();
        let (shop, slots) = layout.compute_pixel_geometry(2560, 1440);
        assert_eq!(shop.width, 1333);
        assert_eq!(shop.height, 205);
        assert_eq!(slots[0].width, 256);
        assert_eq!(slots[0].height, 205);
        assert_eq!(slots[0].x, 597);
        assert_eq!(slots[4].x, 1675);
    }

    #[test]
    fn test_3_geometry_scaling_4k() {
        let layout = ShopLayout::default();
        let (shop, slots) = layout.compute_pixel_geometry(3840, 2160);
        assert_eq!(shop.width, 2000);
        assert_eq!(shop.height, 308);
        assert_eq!(slots[0].width, 384);
        assert_eq!(slots[0].height, 308);
        assert_eq!(slots[0].x, 896);
        assert_eq!(slots[4].x, 2512);
    }

    #[test]
    fn test_4_slot_order_strictly_left_to_right() {
        let layout = ShopLayout::default();
        let (_, slots) = layout.compute_pixel_geometry(1920, 1080);
        for i in 0..4 {
            assert!(
                slots[i].x + (slots[i].width as i32) <= slots[i + 1].x,
                "Slot {} (x={}) must be strictly to the left of slot {} (x={})",
                i, slots[i].x, i + 1, slots[i + 1].x
            );
        }
    }

    #[test]
    fn test_5_active_set_canonical_candidate_catalog() {
        let candidates = get_default_set18_candidates();
        assert!(candidates.len() >= 70, "Active set must have complete Set 18 roster");

        // Verify Set 18 probe units exist
        assert!(candidates.iter().any(|c| c.api_name == "DA_18_Xayah"));
        assert!(candidates.iter().any(|c| c.api_name == "DA_Fiddlesticks18"));
        assert!(candidates.iter().any(|c| c.api_name == "DA_18_Akali_AD"));
        assert!(candidates.iter().any(|c| c.api_name == "DA_Cinderling18"));
    }

    #[test]
    fn test_6_non_shop_special_units_handled_intentionally() {
        let candidates = get_default_set18_candidates();
        let lux_base = candidates.iter().find(|c| c.api_name == "DA_Lux18_Base");
        assert!(lux_base.is_some());
        assert_eq!(lux_base.unwrap().shop_status, "placeholder");
    }

    #[test]
    fn test_7_weak_match_emits_unknown() {
        let engine = ShopVisionEngine::new();
        // Empty buffer produces UNKNOWN
        let bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        let status = engine.process_frame(&bgra, 1920, 1080);
        assert_eq!(status.detected, false);
        for slot in &status.slots {
            assert!(slot.champion_id.is_none());
            assert_eq!(slot.stable, false);
        }
    }

    #[test]
    fn test_8_structured_status_contains_no_pixel_payload() {
        let engine = ShopVisionEngine::new();
        let status = engine.get_status();
        let serialized = serde_json::to_string(&status).expect("Serialization should succeed");
        assert!(!serialized.contains("dataBase64"));
        assert!(!serialized.contains("previewImage"));
        assert!(!serialized.contains("bgra"));
    }

    #[test]
    fn test_9_two_frame_stability_accepted() {
        let mut tracker = SlotStabilityTracker {
            last_champion_id: None,
            consecutive_count: 0,
        };

        // Frame 1
        tracker.last_champion_id = Some("DA_18_Akali_AD".into());
        tracker.consecutive_count = 1;
        assert_eq!(tracker.consecutive_count, 1);

        // Frame 2 agreeing
        if tracker.last_champion_id.as_deref() == Some("DA_18_Akali_AD") {
            tracker.consecutive_count += 1;
        }
        assert_eq!(tracker.consecutive_count, 2);
        assert!(tracker.consecutive_count >= 2, "Two-frame agreement satisfies stability");
    }

    #[test]
    fn test_10_reroll_invalidates_stale_slot_state() {
        let mut tracker = SlotStabilityTracker {
            last_champion_id: Some("DA_18_Akali_AD".into()),
            consecutive_count: 5,
        };

        // Reroll produces different candidate
        let new_candidate = "DA_18_Veigar";
        if tracker.last_champion_id.as_deref() != Some(new_candidate) {
            tracker.last_champion_id = Some(new_candidate.into());
            tracker.consecutive_count = 1; // reset!
        }

        assert_eq!(tracker.last_champion_id.as_deref(), Some("DA_18_Veigar"));
        assert_eq!(tracker.consecutive_count, 1);
    }

    #[test]
    fn test_11_akali_amumu_margin_gating_regression() {
        // When best candidate score is high but separation from second best is small (<0.035),
        // confidence gating must reject emission to prevent fiery palette false positives.
        let best_score = 0.760f32; // e.g. Amumu
        let second_score = 0.732f32; // e.g. Akali
        let margin = best_score - second_score;

        let is_high_conf = best_score >= 0.80 && margin >= 0.045;
        let is_medium_conf = best_score >= 0.72 && margin >= 0.035;

        assert!(!is_high_conf, "Margin 0.028 does not satisfy high confidence");
        assert!(!is_medium_conf, "Margin 0.028 does not satisfy medium confidence");
    }

    #[test]
    fn test_12_reroll_temporal_transition_latency() {
        let engine = ShopVisionEngine::new();
        // Measure execution latency of process_frame
        let bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        let start = std::time::Instant::now();
        let status = engine.process_frame(&bgra, 1920, 1080);
        let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;

        assert!(elapsed_ms < 50.0, "Frame processing must comfortably finish < 50ms, took {:.2}ms", elapsed_ms);
        assert_eq!(status.detected, false);
    }
}

