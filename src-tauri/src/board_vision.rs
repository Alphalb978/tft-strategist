use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Instant,
};

pub const RECOGNITION_VERSION: &str = "board-vision-v1";
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

/// Normalized coordinate point [0.0..1.0]
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct PointNormalized {
    pub x: f32,
    pub y: f32,
}

impl PointNormalized {
    pub fn to_pixel_point(&self, frame_w: u32, frame_h: u32) -> (i32, i32) {
        (
            (self.x * frame_w as f32).round() as i32,
            (self.y * frame_h as f32).round() as i32,
        )
    }
}

/// Bench slot definition with normalized center and ROI
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BenchSlotGeometry {
    pub slot: usize,
    pub center_x: f32,
    pub center_y: f32,
    pub roi: RectNormalized,
}

/// Full bench geometry (9 slots)
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BenchLayout {
    pub outer_region_normalized: RectNormalized,
    pub slots: Vec<BenchSlotGeometry>,
    pub baseline_aspect_ratio: f32,
    pub geometry_version: String,
}

impl Default for BenchLayout {
    fn default() -> Self {
        // Measured baseline 1920x1080:
        // Bench span: x=355 to 1435 (width=1080, exactly 9 slots * 120 pitch)
        // Center Y = 752.5, Platform Y: 740..830
        // Full ROI with model headroom & healthbar: Y=670 to 835 (height=165)
        let outer_region = RectNormalized {
            x: 355.0 / 1920.0,
            y: 670.0 / 1080.0,
            width: 1080.0 / 1920.0,
            height: 165.0 / 1080.0,
        };

        let mut slots = Vec::with_capacity(9);
        for i in 0..9 {
            let cx = 355.0 + 60.0 + (i as f32) * 120.0;
            let cy = 752.5;
            let sx = 355.0 + (i as f32) * 120.0;
            slots.push(BenchSlotGeometry {
                slot: i,
                center_x: cx / 1920.0,
                center_y: cy / 1080.0,
                roi: RectNormalized {
                    x: sx / 1920.0,
                    y: 670.0 / 1080.0,
                    width: 120.0 / 1920.0,
                    height: 165.0 / 1080.0,
                },
            });
        }

        Self {
            outer_region_normalized: outer_region,
            slots,
            baseline_aspect_ratio: 16.0 / 9.0,
            geometry_version: "tft-bench-1080p-v1".to_string(),
        }
    }
}

impl BenchLayout {
    /// Computes pixel geometry for any resolution, preserving aspect ratio and bottom-center anchoring
    pub fn compute_pixel_geometry(&self, frame_w: u32, frame_h: u32) -> (PixelRect, Vec<PixelRect>) {
        if frame_w == 0 || frame_h == 0 {
            let zero = PixelRect { x: 0, y: 0, width: 0, height: 0 };
            return (zero, vec![zero; 9]);
        }

        let aspect = frame_w as f32 / frame_h as f32;
        let is_standard_16_9 = (aspect - (16.0 / 9.0)).abs() < 0.05;

        if is_standard_16_9 {
            let outer = self.outer_region_normalized.to_pixel_rect(frame_w, frame_h);
            let slot_rects = self
                .slots
                .iter()
                .map(|s| s.roi.to_pixel_rect(frame_w, frame_h))
                .collect();
            (outer, slot_rects)
        } else {
            // Anchor to bottom-center with height scale relative to 1080p
            let scale = frame_h as f32 / 1080.0;
            let total_w = (1080.0 * scale).round() as u32;
            let total_h = (165.0 * scale).round() as u32;
            let start_x = ((frame_w as f32 - total_w as f32) / 2.0).round() as i32;
            let start_y = (frame_h as f32 - (1080.0 - 670.0) * scale).round() as i32;

            let outer = PixelRect {
                x: start_x,
                y: start_y,
                width: total_w,
                height: total_h,
            };

            let slot_w = (120.0 * scale).round() as u32;
            let mut slot_rects = Vec::with_capacity(9);
            for i in 0..9 {
                let sx = start_x + (i as f32 * 120.0 * scale).round() as i32;
                slot_rects.push(PixelRect {
                    x: sx,
                    y: start_y,
                    width: slot_w,
                    height: total_h,
                });
            }
            (outer, slot_rects)
        }
    }
}

/// Board cell geometry (1 hex)
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardHexGeometry {
    pub hex: usize,
    pub row: usize,
    pub col: usize,
    pub normalized_center_x: f32,
    pub normalized_center_y: f32,
    pub roi: RectNormalized,
}

/// Full playable board geometry (4 rows × 7 columns = 28 hexes)
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardLayout {
    pub outer_region_normalized: RectNormalized,
    pub hexes: Vec<BoardHexGeometry>,
    pub baseline_aspect_ratio: f32,
    pub geometry_version: String,
}

impl Default for BoardLayout {
    fn default() -> Self {
        // Measured baseline 1920x1080:
        // 4 rows (0..3) x 7 columns (0..6)
        // Row 0 (frontline, closest to enemy): Y=440, pitch=120px, un-staggered (col 3 center at X=960)
        // Row 1: Y=520, pitch=130px, staggered by +0.5 pitch (+65px)
        // Row 2: Y=605, pitch=140px, un-staggered (col 3 center at X=960)
        // Row 3 (backline, closest to bench): Y=690, pitch=150px, staggered by +0.5 pitch (+75px)
        // Hex indexing: hex = row * 7 + col (0..27)
        let mut hexes = Vec::with_capacity(28);

        let row_configs: [(f32, f32, bool, f32); 4] = [
            (440.0, 120.0, false, 95.0),  // Row 0: y=440, pitch=120, not staggered, roi_h=95
            (520.0, 130.0, true, 105.0),  // Row 1: y=520, pitch=130, staggered, roi_h=105
            (605.0, 140.0, false, 115.0), // Row 2: y=605, pitch=140, not staggered, roi_h=115
            (690.0, 150.0, true, 125.0),  // Row 3: y=690, pitch=150, staggered, roi_h=125
        ];

        let mut min_x = f32::MAX;
        let mut max_x = f32::MIN;
        let mut min_y = f32::MAX;
        let mut max_y = f32::MIN;

        for r in 0..4 {
            let (cy, pitch, is_staggered, roi_h) = row_configs[r];
            let roi_w = pitch * 1.05;

            for c in 0..7 {
                let offset_cols = if is_staggered {
                    (c as f32) - 3.0 + 0.5
                } else {
                    (c as f32) - 3.0
                };
                let cx = 960.0 + offset_cols * pitch;
                let rx = cx - roi_w / 2.0;
                let ry = cy - roi_h * 0.65; // Headroom for standing unit

                if rx < min_x { min_x = rx; }
                if rx + roi_w > max_x { max_x = rx + roi_w; }
                if ry < min_y { min_y = ry; }
                if ry + roi_h > max_y { max_y = ry + roi_h; }

                let hex_idx = r * 7 + c;
                hexes.push(BoardHexGeometry {
                    hex: hex_idx,
                    row: r,
                    col: c,
                    normalized_center_x: cx / 1920.0,
                    normalized_center_y: cy / 1080.0,
                    roi: RectNormalized {
                        x: rx / 1920.0,
                        y: ry / 1080.0,
                        width: roi_w / 1920.0,
                        height: roi_h / 1080.0,
                    },
                });
            }
        }

        Self {
            outer_region_normalized: RectNormalized {
                x: min_x / 1920.0,
                y: min_y / 1080.0,
                width: (max_x - min_x) / 1920.0,
                height: (max_y - min_y) / 1080.0,
            },
            hexes,
            baseline_aspect_ratio: 16.0 / 9.0,
            geometry_version: "tft-board-1080p-v1".to_string(),
        }
    }
}

impl BoardLayout {
    /// Computes pixel geometry for any resolution
    pub fn compute_pixel_geometry(&self, frame_w: u32, frame_h: u32) -> (PixelRect, Vec<PixelRect>) {
        if frame_w == 0 || frame_h == 0 {
            let zero = PixelRect { x: 0, y: 0, width: 0, height: 0 };
            return (zero, vec![zero; 28]);
        }

        let aspect = frame_w as f32 / frame_h as f32;
        let is_standard_16_9 = (aspect - (16.0 / 9.0)).abs() < 0.05;

        if is_standard_16_9 {
            let outer = self.outer_region_normalized.to_pixel_rect(frame_w, frame_h);
            let hex_rects = self
                .hexes
                .iter()
                .map(|h| h.roi.to_pixel_rect(frame_w, frame_h))
                .collect();
            (outer, hex_rects)
        } else {
            // Anchor to center with height scale relative to 1080p
            let scale = frame_h as f32 / 1080.0;
            let center_offset_x = (frame_w as f32 - 1920.0 * scale) / 2.0;

            let outer = PixelRect {
                x: ((self.outer_region_normalized.x * 1920.0 * scale) + center_offset_x).round() as i32,
                y: (self.outer_region_normalized.y * frame_h as f32).round() as i32,
                width: (self.outer_region_normalized.width * 1920.0 * scale).round() as u32,
                height: (self.outer_region_normalized.height * frame_h as f32).round() as u32,
            };

            let hex_rects = self
                .hexes
                .iter()
                .map(|h| {
                    let rx = ((h.roi.x * 1920.0 * scale) + center_offset_x).round() as i32;
                    let ry = (h.roi.y * frame_h as f32).round() as i32;
                    let rw = (h.roi.width * 1920.0 * scale).round() as u32;
                    let rh = (h.roi.height * frame_h as f32).round() as u32;
                    PixelRect { x: rx, y: ry, width: rw, height: rh }
                })
                .collect();

            (outer, hex_rects)
        }
    }
}

/// Occupancy classification
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OccupancyState {
    Empty,
    Occupied,
    Unknown,
}

/// Overall provenance identity state of a unit slot/hex
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OwnedUnitState {
    Known,
    Ambiguous,
    Unknown,
    Empty,
}

impl Default for OwnedUnitState {
    fn default() -> Self {
        OwnedUnitState::Empty
    }
}

/// Physical location reference (Bench slot 0..8 or Board hex 0..27)
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum LocationRef {
    Bench(usize),
    Board(usize),
}

impl LocationRef {
    pub fn to_display_string(&self) -> String {
        match self {
            LocationRef::Bench(s) => format!("B{}", s + 1),
            LocationRef::Board(h) => format!("H{}", h + 1),
        }
    }
}

/// Diagnostic recent tracker event for UI and review
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerRecentEvent {
    pub text: String,
    pub generation: u64,
}

/// In-memory Purchase Candidate emitted by the purchase detector
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseCandidate {
    pub event_id: String,
    pub champion_id: String,
    pub champion_name: String,
    pub shop_slot: usize,
    pub source_frame_generation: u64,
    pub detected_frame_generation: u64,
    pub confidence: f32,
    pub expires_at_generation: u64,
}

/// In-memory combine event emitted when units merge
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CombineEvent {
    pub champion_id: String,
    pub consumed_track_ids: Vec<String>,
    pub resulting_track_id: String,
    pub resulting_star_level: Option<u32>,
    pub confidence: f32,
    pub generation: u64,
}

/// Lightweight appearance signature for occupied ROIs (for movement track matching only)
#[derive(Clone, Debug, PartialEq)]
pub struct RoiAppearanceSignature {
    pub color_hist: [f32; 32],
    pub luminance_grid: [f32; 64],
    pub avg_gradient: f32,
    pub avg_luminance: f32,
}

impl RoiAppearanceSignature {
    pub fn similarity(&self, other: &Self) -> f32 {
        let mut color_sim = 0.0f32;
        for i in 0..32 {
            color_sim += (self.color_hist[i] * other.color_hist[i]).sqrt();
        }
        color_sim = color_sim.clamp(0.0, 1.0);

        let mut mean1 = 0.0f32;
        let mut mean2 = 0.0f32;
        for i in 0..64 {
            mean1 += self.luminance_grid[i];
            mean2 += other.luminance_grid[i];
        }
        mean1 /= 64.0;
        mean2 /= 64.0;

        let mut nom = 0.0f32;
        let mut var1 = 0.0f32;
        let mut var2 = 0.0f32;
        for i in 0..64 {
            let d1 = self.luminance_grid[i] - mean1;
            let d2 = other.luminance_grid[i] - mean2;
            nom += d1 * d2;
            var1 += d1 * d1;
            var2 += d2 * d2;
        }
        let denom = (var1 * var2).sqrt();
        let spatial_sim = if denom > 0.0001 {
            (nom / denom).clamp(0.0, 1.0)
        } else {
            0.5
        };

        let grad_diff = (self.avg_gradient - other.avg_gradient).abs().min(50.0) / 50.0;
        let grad_sim = 1.0 - grad_diff;

        let score = 0.60 * color_sim + 0.30 * spatial_sim + 0.10 * grad_sim;
        score.clamp(0.0, 1.0)
    }
}

/// Extracts lightweight appearance signature for an occupied ROI
pub fn extract_roi_appearance_signature(
    bgra: &[u8],
    frame_w: u32,
    frame_h: u32,
    roi: PixelRect,
) -> Option<RoiAppearanceSignature> {
    if roi.width < 10 || roi.height < 10 {
        return None;
    }
    let rx = roi.x.clamp(0, frame_w.saturating_sub(1) as i32) as u32;
    let ry = roi.y.clamp(0, frame_h.saturating_sub(1) as i32) as u32;
    let rw = roi.width.min(frame_w.saturating_sub(rx));
    let rh = roi.height.min(frame_h.saturating_sub(ry));
    if rw < 10 || rh < 10 {
        return None;
    }

    let mut hist = [0.0f32; 32];
    let mut grid_sums = [0.0f32; 64];
    let mut grid_counts = [0u32; 64];
    let mut total_gradient = 0.0f32;
    let mut total_lum = 0.0f32;
    let mut total_pixels = 0u32;
    let step = 2u32;

    for y in (ry..(ry + rh)).step_by(step as usize) {
        let gy = (((y - ry) * 8) / rh).min(7) as usize;
        for x in (rx..(rx + rw)).step_by(step as usize) {
            let idx = ((y * frame_w + x) * 4) as usize;
            if idx + 2 >= bgra.len() {
                continue;
            }
            let b = bgra[idx] as f32;
            let g = bgra[idx + 1] as f32;
            let r = bgra[idx + 2] as f32;

            // 32-bin color histogram (4 bins R, 4 bins G, 2 bins B)
            let r_bin = (r / 64.0).floor().min(3.0) as usize;
            let g_bin = (g / 64.0).floor().min(3.0) as usize;
            let b_bin = (b / 128.0).floor().min(1.0) as usize;
            let bin = r_bin * 8 + g_bin * 2 + b_bin;
            hist[bin] += 1.0;

            let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
            let gx = (((x - rx) * 8) / rw).min(7) as usize;
            let cell = gy * 8 + gx;
            grid_sums[cell] += lum;
            grid_counts[cell] += 1;
            total_lum += lum;
            total_pixels += 1;

            if x + step < rx + rw {
                let r_idx = idx + (step as usize * 4);
                if r_idx + 2 < bgra.len() {
                    let rb = bgra[r_idx] as f32;
                    let rg = bgra[r_idx + 1] as f32;
                    let rr = bgra[r_idx + 2] as f32;
                    total_gradient += (b - rb).abs() + (g - rg).abs() + (r - rr).abs();
                }
            }
        }
    }

    if total_pixels == 0 {
        return None;
    }

    for i in 0..32 {
        hist[i] /= total_pixels as f32;
    }

    let mut grid = [0.0f32; 64];
    for i in 0..64 {
        if grid_counts[i] > 0 {
            grid[i] = grid_sums[i] / (grid_counts[i] as f32);
        }
    }

    Some(RoiAppearanceSignature {
        color_hist: hist,
        luminance_grid: grid,
        avg_gradient: total_gradient / (total_pixels as f32),
        avg_luminance: total_lum / (total_pixels as f32),
    })
}

/// An in-memory unit track
#[derive(Clone, Debug, PartialEq)]
pub struct OwnedUnitTrack {
    pub track_id: String,
    pub champion_id: Option<String>,
    pub champion_name: Option<String>,
    pub location: Option<LocationRef>,
    pub state: OwnedUnitState,
    pub identity_source: String, // "shop-purchase" | "tracked-move" | "tracked-combine" | "initial-unknown"
    pub identity_confidence: f32,
    pub star_level: Option<u32>,
    pub star_confidence: Option<f32>,
    pub appearance_signature: Option<RoiAppearanceSignature>,
    pub created_generation: u64,
    pub last_seen_generation: u64,
    pub departed_generation: Option<u64>,
}

/// Group of tracks whose spatial locations are ambiguous
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AmbiguityGroup {
    pub group_id: String,
    pub track_ids: Vec<String>,
    pub possible_locations: Vec<LocationRef>,
    pub created_generation: u64,
}

/// Diagnostic summary of a known owned champion
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnownOwnedChampion {
    pub champion_id: String,
    pub champion_name: String,
    pub known_track_count: usize,
    pub known_copy_equivalent: Option<u32>,
    pub confidence: f32,
}

/// Status of one bench slot
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BenchSlotStatus {
    pub slot: usize,
    pub occupancy: OccupancyState,
    pub occupied: bool,
    #[serde(default)]
    pub state: OwnedUnitState,
    pub track_id: Option<String>,
    pub champion_id: Option<String>,
    pub champion_name: Option<String>,
    pub identity_source: Option<String>,
    pub identity_confidence: f32,
    pub star_level: Option<u32>,
    pub star_confidence: Option<f32>,
    pub rect: PixelRect,
}

/// Status of one playable board hex
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardCellStatus {
    pub hex: usize,
    pub row: usize,
    pub col: usize,
    pub occupancy: OccupancyState,
    pub occupied: bool,
    #[serde(default)]
    pub state: OwnedUnitState,
    pub track_id: Option<String>,
    pub champion_id: Option<String>,
    pub champion_name: Option<String>,
    pub identity_source: Option<String>,
    pub identity_confidence: f32,
    pub star_level: Option<u32>,
    pub rect: PixelRect,
}

/// Aggregated owned units payload exposed via Tauri IPC
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenOwnedUnitsStatus {
    pub available: bool,
    pub detected: bool,
    pub frame_generation: u64,
    pub frame_age_ms: u64,
    pub processing_time_ms: f32,
    pub identity_coverage: f32,
    pub recognition_version: String,
    pub bench_layout_version: String,
    pub board_layout_version: String,
    pub bench: Vec<BenchSlotStatus>,
    pub board: Vec<BoardCellStatus>,
    pub known_owned: Vec<KnownOwnedChampion>,
    pub pending_purchases: usize,
    pub ambiguity_groups: usize,
    pub recent_events: Vec<TrackerRecentEvent>,
}

impl Default for ScreenOwnedUnitsStatus {
    fn default() -> Self {
        let bench_layout = BenchLayout::default();
        let board_layout = BoardLayout::default();

        let bench = (0..9)
            .map(|i| BenchSlotStatus {
                slot: i,
                occupancy: OccupancyState::Empty,
                occupied: false,
                state: OwnedUnitState::Empty,
                track_id: None,
                champion_id: None,
                champion_name: None,
                identity_source: None,
                identity_confidence: 0.0,
                star_level: None,
                star_confidence: None,
                rect: PixelRect { x: 0, y: 0, width: 0, height: 0 },
            })
            .collect();

        let board = (0..28)
            .map(|h| BoardCellStatus {
                hex: h,
                row: h / 7,
                col: h % 7,
                occupancy: OccupancyState::Empty,
                occupied: false,
                state: OwnedUnitState::Empty,
                track_id: None,
                champion_id: None,
                champion_name: None,
                identity_source: None,
                identity_confidence: 0.0,
                star_level: None,
                rect: PixelRect { x: 0, y: 0, width: 0, height: 0 },
            })
            .collect();

        Self {
            available: false,
            detected: false,
            frame_generation: 0,
            frame_age_ms: 0,
            processing_time_ms: 0.0,
            identity_coverage: 1.0,
            recognition_version: RECOGNITION_VERSION.to_string(),
            bench_layout_version: bench_layout.geometry_version,
            board_layout_version: board_layout.geometry_version,
            bench,
            board,
            known_owned: Vec::new(),
            pending_purchases: 0,
            ambiguity_groups: 0,
            recent_events: Vec::new(),
        }
    }
}

/// Visual features computed for occupancy classification
#[derive(Debug, Clone, Copy)]
pub struct RoiVisualFeatures {
    pub avg_gradient: f32,
    pub variance: f32,
    pub has_health_bar: bool,
    pub is_ui_obscured: bool,
}

/// Extracts visual evidence for occupancy from an arbitrary ROI in a BGRA frame
pub fn extract_roi_visual_features(
    bgra: &[u8],
    frame_w: u32,
    frame_h: u32,
    roi: PixelRect,
) -> Option<RoiVisualFeatures> {
    if roi.width < 10 || roi.height < 10 {
        return None;
    }

    let rx = roi.x.clamp(0, frame_w.saturating_sub(1) as i32) as u32;
    let ry = roi.y.clamp(0, frame_h.saturating_sub(1) as i32) as u32;
    let rw = roi.width.min(frame_w.saturating_sub(rx));
    let rh = roi.height.min(frame_h.saturating_sub(ry));

    if rw < 10 || rh < 10 {
        return None;
    }

    let mut total_gradient = 0.0f32;
    let mut count = 0u32;
    let mut sum_r = 0.0f32;
    let mut sum_g = 0.0f32;
    let mut sum_b = 0.0f32;

    let step = 2u32; // 2x2 stride for sub-millisecond ROI processing
    let mut dark_box_pixels = 0u32;
    let mut has_health_bar = false;

    // First pass: gradient, mean color, and health bar scan
    for y in (ry..(ry + rh)).step_by(step as usize) {
        let is_upper_headroom = y < (ry + rh / 3);

        for x in (rx..(rx + rw)).step_by(step as usize) {
            let idx = ((y * frame_w + x) * 4) as usize;
            if idx + 7 >= bgra.len() {
                continue;
            }

            let b = bgra[idx] as f32;
            let g = bgra[idx + 1] as f32;
            let r = bgra[idx + 2] as f32;

            sum_b += b;
            sum_g += g;
            sum_r += r;
            count += 1;

            // Gradient with right and bottom neighbors
            let idx_right = idx + (step as usize * 4);
            let idx_down = idx + (step as usize * frame_w as usize * 4);

            let mut gx = 0.0f32;
            if idx_right + 3 < bgra.len() && (x + step) < (rx + rw) {
                let br = bgra[idx_right] as f32;
                let gr = bgra[idx_right + 1] as f32;
                let rr = bgra[idx_right + 2] as f32;
                gx = (b - br).abs() + (g - gr).abs() + (r - rr).abs();
            }

            let mut gy = 0.0f32;
            if idx_down + 3 < bgra.len() && (y + step) < (ry + rh) {
                let bd = bgra[idx_down] as f32;
                let gd = bgra[idx_down + 1] as f32;
                let rd = bgra[idx_down + 2] as f32;
                gy = (b - bd).abs() + (g - gd).abs() + (r - rd).abs();
            }

            total_gradient += gx + gy;

            // Detect UI tooltip dark background [r<15, g<30, b<35]
            if r < 16.0 && g < 32.0 && b < 38.0 {
                dark_box_pixels += 1;
            }

            // Health bar indicator in upper headroom:
            // Standard health colors: bright green (g > 150, r < 100, b < 100) or cyan/blue/shield
            if is_upper_headroom && !has_health_bar {
                let is_green_health = g > 160.0 && r < 110.0 && b < 110.0;
                let is_shield_health = r > 180.0 && g > 150.0 && b < 90.0;
                let is_blue_mana = b > 180.0 && g > 120.0 && r < 90.0;
                if is_green_health || is_shield_health || is_blue_mana {
                    // Confirm adjacent border is dark to avoid confusing arena specular glints with health bar
                    if y > ry + 2 {
                        let top_idx = (( (y - 2) * frame_w + x) * 4) as usize;
                        if top_idx + 3 < bgra.len() {
                            let tb = bgra[top_idx] as f32;
                            let tg = bgra[top_idx + 1] as f32;
                            let tr = bgra[top_idx + 2] as f32;
                            if (tr + tg + tb) < 70.0 {
                                has_health_bar = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if count == 0 {
        return None;
    }

    let avg_gradient = total_gradient / (count as f32);
    let mean_b = sum_b / (count as f32);
    let mean_g = sum_g / (count as f32);
    let mean_r = sum_r / (count as f32);

    // Second pass: variance
    let mut var_sum = 0.0f32;
    for y in (ry..(ry + rh)).step_by(step as usize) {
        for x in (rx..(rx + rw)).step_by(step as usize) {
            let idx = ((y * frame_w + x) * 4) as usize;
            if idx + 3 >= bgra.len() {
                continue;
            }
            let b = bgra[idx] as f32;
            let g = bgra[idx + 1] as f32;
            let r = bgra[idx + 2] as f32;

            let db = b - mean_b;
            let dg = g - mean_g;
            let dr = r - mean_r;
            var_sum += db * db + dg * dg + dr * dr;
        }
    }
    let variance = (var_sum / (count as f32)).sqrt();

    // If >28% of the ROI consists of flat dark tooltip/dialog panel, mark as UI obscured
    let dark_ratio = (dark_box_pixels as f32) / (count as f32);
    let is_ui_obscured = dark_ratio > 0.28;

    Some(RoiVisualFeatures {
        avg_gradient,
        variance,
        has_health_bar,
        is_ui_obscured,
    })
}

/// Classifies occupancy for a bench slot
pub fn classify_bench_slot(features: &RoiVisualFeatures) -> OccupancyState {
    if features.is_ui_obscured {
        return OccupancyState::Unknown;
    }

    if features.has_health_bar {
        return OccupancyState::Occupied;
    }

    // Occupied threshold:
    // Empty flat tile: avg_gradient <= 26.0, variance <= 45.0
    // Occupied 3D model: avg_gradient >= 48.0 or (avg_gradient >= 38.0 && variance >= 55.0)
    if features.avg_gradient >= 48.0 || (features.avg_gradient >= 38.0 && features.variance >= 55.0) {
        OccupancyState::Occupied
    } else if features.avg_gradient <= 28.0 && features.variance <= 48.0 {
        OccupancyState::Empty
    } else {
        // In ambiguous boundary zone, prefer Unknown over false Occupied
        OccupancyState::Unknown
    }
}

/// Classifies occupancy for a board cell
pub fn classify_board_cell(features: &RoiVisualFeatures) -> OccupancyState {
    if features.is_ui_obscured {
        return OccupancyState::Unknown;
    }

    if features.has_health_bar {
        return OccupancyState::Occupied;
    }

    // Board floor has slightly higher natural arena texture energy than flat bench tiles
    if features.avg_gradient >= 52.0 || (features.avg_gradient >= 40.0 && features.variance >= 60.0) {
        OccupancyState::Occupied
    } else if features.avg_gradient <= 30.0 && features.variance <= 50.0 {
        OccupancyState::Empty
    } else {
        OccupancyState::Unknown
    }
}

/// Tracks temporal occupancy across frames
#[derive(Clone, Debug)]
struct TemporalSlotTrack {
    consecutive_state: OccupancyState,
    stable_frames: u32,
}

impl Default for TemporalSlotTrack {
    fn default() -> Self {
        Self {
            consecutive_state: OccupancyState::Empty,
            stable_frames: 0,
        }
    }
}

/// In-memory tracker managing purchase fusion, movement tracking, and provenance ledger
pub struct EntityTracker {
    pub next_track_counter: u64,
    pub tracks: HashMap<String, OwnedUnitTrack>,
    pub pending_purchases: Vec<PurchaseCandidate>,
    pub ambiguity_groups: Vec<AmbiguityGroup>,
    pub combine_events: Vec<CombineEvent>,
    pub last_shop_slots: Option<[crate::shop_vision::ShopSlotRecognition; 5]>,
    pub last_shop_generation: u64,
    pub recent_events: Vec<TrackerRecentEvent>,
}

impl EntityTracker {
    pub fn new() -> Self {
        Self {
            next_track_counter: 0,
            tracks: HashMap::new(),
            pending_purchases: Vec::new(),
            ambiguity_groups: Vec::new(),
            combine_events: Vec::new(),
            last_shop_slots: None,
            last_shop_generation: 0,
            recent_events: Vec::new(),
        }
    }

    pub fn reset(&mut self) {
        self.tracks.clear();
        self.pending_purchases.clear();
        self.ambiguity_groups.clear();
        self.combine_events.clear();
        self.last_shop_slots = None;
        self.last_shop_generation = 0;
        self.recent_events.clear();
    }

    pub fn push_recent_event(&mut self, text: String, gen: u64) {
        if self.recent_events.len() >= 12 {
            self.recent_events.remove(0);
        }
        self.recent_events.push(TrackerRecentEvent { text, generation: gen });
    }

    pub fn update(
        &mut self,
        gen: u64,
        bench_statuses: &mut [BenchSlotStatus],
        board_statuses: &mut [BoardCellStatus],
        bench_signatures: &[Option<RoiAppearanceSignature>],
        board_signatures: &[Option<RoiAppearanceSignature>],
        shop_status: Option<&crate::shop_vision::ScreenShopStatus>,
    ) -> (Vec<KnownOwnedChampion>, f32, usize, usize) {
        self.update_with_audit(
            gen,
            bench_statuses,
            board_statuses,
            bench_signatures,
            board_signatures,
            shop_status,
            None,
            None,
            None,
            None,
            &[],
            &[],
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_with_audit(
        &mut self,
        gen: u64,
        bench_statuses: &mut [BenchSlotStatus],
        board_statuses: &mut [BoardCellStatus],
        bench_signatures: &[Option<RoiAppearanceSignature>],
        board_signatures: &[Option<RoiAppearanceSignature>],
        shop_status: Option<&crate::shop_vision::ScreenShopStatus>,
        audit_manager: Option<&crate::owned_unit_audit::AuditManager>,
        frame_bgra: Option<&[u8]>,
        frame_w: Option<u32>,
        frame_h: Option<u32>,
        bench_rects: &[PixelRect],
        board_rects: &[PixelRect],
    ) -> (Vec<KnownOwnedChampion>, f32, usize, usize) {
        // Step 1: Detect Purchase Candidates from shop state
        if let Some(shop) = shop_status {
            if shop.detected {
                if let Some(ref prev_slots) = self.last_shop_slots {
                    let mut champ_to_different_champ = 0;
                    let mut empty_transitions = Vec::new();

                    let num_slots = prev_slots.len().min(shop.slots.len()).min(5);
                    for i in 0..num_slots {
                        let prev = &prev_slots[i];
                        let curr = &shop.slots[i];

                        if let (Some(ref p_id), Some(ref c_id)) = (&prev.champion_id, &curr.champion_id) {
                            if p_id != c_id {
                                champ_to_different_champ += 1;
                            }
                        }

                        // Strong purchase evidence: Champion -> confidently Empty
                        let was_champ = prev.state == crate::shop_vision::ShopSlotState::Champion || prev.champion_id.is_some();
                        let is_now_empty = curr.state == crate::shop_vision::ShopSlotState::Empty;
                        if was_champ && prev.stable && is_now_empty {
                            empty_transitions.push(i);
                        }
                    }

                    // Reroll safety: 2+ slots changed to different champions or big generation skip
                    let is_reroll = champ_to_different_champ >= 2 || (shop.generation > self.last_shop_generation + 5);
                    if is_reroll {
                        self.pending_purchases.clear();
                    } else if !empty_transitions.is_empty() {
                        for slot_idx in empty_transitions {
                            let prev = &prev_slots[slot_idx];
                            let cand = PurchaseCandidate {
                                event_id: format!("purchase-g{}-s{}", gen, slot_idx),
                                champion_id: prev.champion_id.clone().unwrap_or_default(),
                                champion_name: prev.champion_name.clone().unwrap_or_default(),
                                shop_slot: slot_idx,
                                source_frame_generation: self.last_shop_generation,
                                detected_frame_generation: gen,
                                confidence: prev.confidence,
                                expires_at_generation: gen + 4,
                            };
                            self.pending_purchases.push(cand.clone());

                            if let Some(audit) = audit_manager {
                                let mut crops = None;
                                if audit.save_crops_enabled() {
                                    if let (Some(b), Some(fw), Some(fh)) = (frame_bgra, frame_w, frame_h) {
                                        let shop_layout = crate::shop_vision::ShopLayout::default();
                                        let (_, slot_rects) = shop_layout.compute_pixel_geometry(fw, fh);
                                        let slot_roi = slot_rects[slot_idx];
                                        let board_roi = PixelRect {
                                            x: slot_roi.x,
                                            y: slot_roi.y,
                                            width: slot_roi.width,
                                            height: slot_roi.height,
                                        };
                                        let sid = audit.get_status().map(|s| s.audit_session_id).unwrap_or_else(|| "audit".into());
                                        let cp = format!("artifacts/audit/m14c/{}/crops/{}_shop_s{}.bmp", sid, cand.event_id, slot_idx + 1);
                                        let _ = crate::owned_unit_audit::save_roi_crop_bmp(b, fw, fh, board_roi, std::path::Path::new(&cp));
                                        crops = Some(vec![cp]);
                                    }
                                }
                                audit.emit_event(
                                    "PURCHASE_CANDIDATE",
                                    gen,
                                    Some(cand.champion_id.clone()),
                                    Some(cand.champion_name.clone()),
                                    None,
                                    Some(format!("Shop S{}", slot_idx + 1)),
                                    None,
                                    Some(cand.confidence),
                                    Some("shop".into()),
                                    Some(slot_idx),
                                    Some(cand.event_id.clone()),
                                    None,
                                    crops,
                                );
                            }
                        }
                    }
                }

                if shop.slots.len() == 5 {
                    let arr = std::array::from_fn(|i| shop.slots[i].clone());
                    self.last_shop_slots = Some(arr);
                    self.last_shop_generation = shop.generation;
                }
            } else {
                self.last_shop_slots = None;
            }
        }

        // Step 2: Compute occupancy deltas (Departures, Arrivals, Retained)
        let mut departures: Vec<(LocationRef, String)> = Vec::new();
        let mut arrivals: Vec<(LocationRef, RoiAppearanceSignature)> = Vec::new();

        // Check Bench (9 slots)
        for i in 0..9 {
            let loc = LocationRef::Bench(i);
            let is_occ = bench_statuses[i].occupied;
            let existing_track_id = self.tracks.iter().find_map(|(id, t)| {
                if t.location == Some(loc) && t.departed_generation.is_none() {
                    Some(id.clone())
                } else {
                    None
                }
            });

            match (is_occ, existing_track_id) {
                (true, Some(tid)) => {
                    if let Some(t) = self.tracks.get_mut(&tid) {
                        t.last_seen_generation = gen;
                        if let Some(ref sig) = bench_signatures[i] {
                            t.appearance_signature = Some(sig.clone());
                        }
                    }
                }
                (true, None) => {
                    if let Some(ref sig) = bench_signatures[i] {
                        arrivals.push((loc, sig.clone()));
                    }
                }
                (false, Some(tid)) => {
                    departures.push((loc, tid));
                }
                (false, None) => {}
            }
        }

        // Check Board (28 hexes)
        for h in 0..28 {
            let loc = LocationRef::Board(h);
            let is_occ = board_statuses[h].occupied;
            let existing_track_id = self.tracks.iter().find_map(|(id, t)| {
                if t.location == Some(loc) && t.departed_generation.is_none() {
                    Some(id.clone())
                } else {
                    None
                }
            });

            match (is_occ, existing_track_id) {
                (true, Some(tid)) => {
                    if let Some(t) = self.tracks.get_mut(&tid) {
                        t.last_seen_generation = gen;
                        if let Some(ref sig) = board_signatures[h] {
                            t.appearance_signature = Some(sig.clone());
                        }
                    }
                }
                (true, None) => {
                    if let Some(ref sig) = board_signatures[h] {
                        arrivals.push((loc, sig.clone()));
                    }
                }
                (false, Some(tid)) => {
                    departures.push((loc, tid));
                }
                (false, None) => {}
            }
        }

        // Step 3: Resolve Movements (Movement evidence takes precedence over purchase!)
        if departures.len() == 1 && arrivals.len() == 1 {
            let (dep_loc, tid) = departures.pop().unwrap();
            let (arr_loc, arr_sig) = arrivals.pop().unwrap();
            let mut champ_name = "Unknown".to_string();
            let mut champ_id = None;
            let mut conf = 0.0f32;
            if let Some(track) = self.tracks.get_mut(&tid) {
                track.location = Some(arr_loc);
                track.identity_source = "tracked-move".to_string();
                track.appearance_signature = Some(arr_sig);
                track.last_seen_generation = gen;
                track.departed_generation = None;
                if let Some(ref name) = track.champion_name {
                    champ_name = name.clone();
                }
                champ_id = track.champion_id.clone();
                conf = track.identity_confidence;
            }

            let dep_str = dep_loc.to_display_string();
            let arr_str = arr_loc.to_display_string();
            self.push_recent_event(format!("MOVE {} {} → {}", champ_name, dep_str, arr_str), gen);

            if let Some(audit) = audit_manager {
                let mut crops = None;
                if audit.save_crops_enabled() {
                    if let (Some(b), Some(fw), Some(fh)) = (frame_bgra, frame_w, frame_h) {
                        let sid = audit.get_status().map(|s| s.audit_session_id).unwrap_or_else(|| "audit".into());
                        let mut paths = Vec::new();
                        if let Some(src_r) = get_location_rect(dep_loc, bench_rects, board_rects) {
                            let p = format!("artifacts/audit/m14c/{}/crops/g{}_move_src_{}.bmp", sid, gen, dep_str);
                            let _ = crate::owned_unit_audit::save_roi_crop_bmp(b, fw, fh, src_r, std::path::Path::new(&p));
                            paths.push(p);
                        }
                        if let Some(dst_r) = get_location_rect(arr_loc, bench_rects, board_rects) {
                            let p = format!("artifacts/audit/m14c/{}/crops/g{}_move_dst_{}.bmp", sid, gen, arr_str);
                            let _ = crate::owned_unit_audit::save_roi_crop_bmp(b, fw, fh, dst_r, std::path::Path::new(&p));
                            paths.push(p);
                        }
                        if !paths.is_empty() {
                            crops = Some(paths);
                        }
                    }
                }

                audit.emit_event(
                    "MOVE",
                    gen,
                    champ_id.clone(),
                    Some(champ_name.clone()),
                    Some(tid.clone()),
                    Some(dep_str.clone()),
                    Some(arr_str.clone()),
                    Some(conf),
                    Some("tracked-move".into()),
                    None,
                    None,
                    None,
                    crops,
                );
                if champ_id.is_some() {
                    audit.emit_event(
                        "IDENTITY_ASSIGNED",
                        gen,
                        champ_id,
                        Some(champ_name),
                        Some(tid),
                        Some(dep_str),
                        Some(arr_str),
                        Some(conf),
                        Some("tracked-move".into()),
                        None,
                        None,
                        None,
                        None,
                    );
                }
            }
        } else if departures.len() == 2 && arrivals.len() == 2 {
            let d0_sig = self.tracks.get(&departures[0].1).and_then(|t| t.appearance_signature.clone());
            let d1_sig = self.tracks.get(&departures[1].1).and_then(|t| t.appearance_signature.clone());

            let mut paired = false;
            if let (Some(ref s0), Some(ref s1)) = (d0_sig, d1_sig) {
                let sim00 = s0.similarity(&arrivals[0].1);
                let sim01 = s0.similarity(&arrivals[1].1);
                let sim10 = s1.similarity(&arrivals[0].1);
                let sim11 = s1.similarity(&arrivals[1].1);

                let diag0 = sim00 + sim11;
                let diag1 = sim01 + sim10;

                if (diag0 - diag1) >= 0.12 && sim00 >= 0.70 && sim11 >= 0.70 {
                    let dep0_str = departures[0].0.to_display_string();
                    let dep1_str = departures[1].0.to_display_string();
                    let arr0_str = arrivals[0].0.to_display_string();
                    let arr1_str = arrivals[1].0.to_display_string();

                    let mut p0_info = None;
                    if let Some(t) = self.tracks.get_mut(&departures[0].1) {
                        t.location = Some(arrivals[0].0);
                        t.identity_source = "tracked-move".to_string();
                        t.appearance_signature = Some(arrivals[0].1.clone());
                        t.last_seen_generation = gen;
                        t.departed_generation = None;
                        let name = t.champion_name.clone().unwrap_or_else(|| "Unit".into());
                        p0_info = Some((name, t.champion_id.clone(), t.champion_name.clone(), t.track_id.clone(), t.identity_confidence));
                    }
                    if let Some((name, cid, cname, tid, conf)) = p0_info {
                        self.push_recent_event(format!("MOVE {} {} → {}", name, dep0_str, arr0_str), gen);
                        if let Some(audit) = audit_manager {
                            audit.emit_event(
                                "MOVE",
                                gen,
                                cid,
                                cname,
                                Some(tid),
                                Some(dep0_str),
                                Some(arr0_str),
                                Some(conf),
                                Some("tracked-move".into()),
                                None,
                                None,
                                None,
                                None,
                            );
                        }
                    }

                    let mut p1_info = None;
                    if let Some(t) = self.tracks.get_mut(&departures[1].1) {
                        t.location = Some(arrivals[1].0);
                        t.identity_source = "tracked-move".to_string();
                        t.appearance_signature = Some(arrivals[1].1.clone());
                        t.last_seen_generation = gen;
                        t.departed_generation = None;
                        let name = t.champion_name.clone().unwrap_or_else(|| "Unit".into());
                        p1_info = Some((name, t.champion_id.clone(), t.champion_name.clone(), t.track_id.clone(), t.identity_confidence));
                    }
                    if let Some((name, cid, cname, tid, conf)) = p1_info {
                        self.push_recent_event(format!("MOVE {} {} → {}", name, dep1_str, arr1_str), gen);
                        if let Some(audit) = audit_manager {
                            audit.emit_event(
                                "MOVE",
                                gen,
                                cid,
                                cname,
                                Some(tid),
                                Some(dep1_str),
                                Some(arr1_str),
                                Some(conf),
                                Some("tracked-move".into()),
                                None,
                                None,
                                None,
                                None,
                            );
                        }
                    }
                    departures.clear();
                    arrivals.clear();
                    paired = true;
                } else if (diag1 - diag0) >= 0.12 && sim01 >= 0.70 && sim10 >= 0.70 {
                    let dep0_str = departures[0].0.to_display_string();
                    let dep1_str = departures[1].0.to_display_string();
                    let arr0_str = arrivals[0].0.to_display_string();
                    let arr1_str = arrivals[1].0.to_display_string();

                    let mut p0_info = None;
                    if let Some(t) = self.tracks.get_mut(&departures[0].1) {
                        t.location = Some(arrivals[1].0);
                        t.identity_source = "tracked-move".to_string();
                        t.appearance_signature = Some(arrivals[1].1.clone());
                        t.last_seen_generation = gen;
                        t.departed_generation = None;
                        let name = t.champion_name.clone().unwrap_or_else(|| "Unit".into());
                        p0_info = Some((name, t.champion_id.clone(), t.champion_name.clone(), t.track_id.clone(), t.identity_confidence));
                    }
                    if let Some((name, cid, cname, tid, conf)) = p0_info {
                        self.push_recent_event(format!("MOVE {} {} → {}", name, dep0_str, arr1_str), gen);
                        if let Some(audit) = audit_manager {
                            audit.emit_event(
                                "MOVE",
                                gen,
                                cid,
                                cname,
                                Some(tid),
                                Some(dep0_str),
                                Some(arr1_str),
                                Some(conf),
                                Some("tracked-move".into()),
                                None,
                                None,
                                None,
                                None,
                            );
                        }
                    }

                    let mut p1_info = None;
                    if let Some(t) = self.tracks.get_mut(&departures[1].1) {
                        t.location = Some(arrivals[0].0);
                        t.identity_source = "tracked-move".to_string();
                        t.appearance_signature = Some(arrivals[0].1.clone());
                        t.last_seen_generation = gen;
                        t.departed_generation = None;
                        let name = t.champion_name.clone().unwrap_or_else(|| "Unit".into());
                        p1_info = Some((name, t.champion_id.clone(), t.champion_name.clone(), t.track_id.clone(), t.identity_confidence));
                    }
                    if let Some((name, cid, cname, tid, conf)) = p1_info {
                        self.push_recent_event(format!("MOVE {} {} → {}", name, dep1_str, arr0_str), gen);
                        if let Some(audit) = audit_manager {
                            audit.emit_event(
                                "MOVE",
                                gen,
                                cid,
                                cname,
                                Some(tid),
                                Some(dep1_str),
                                Some(arr0_str),
                                Some(conf),
                                Some("tracked-move".into()),
                                None,
                                None,
                                None,
                                None,
                            );
                        }
                    }
                    departures.clear();
                    arrivals.clear();
                    paired = true;
                }
            }

            if !paired {
                // Ambiguous multi-move: Do NOT guess! Form AmbiguityGroup
                let ambig_id = format!("ambig-g{}", gen);
                let tids = vec![departures[0].1.clone(), departures[1].1.clone()];
                let locs = vec![arrivals[0].0, arrivals[1].0];

                for tid in &tids {
                    if let Some(t) = self.tracks.get_mut(tid) {
                        t.state = OwnedUnitState::Ambiguous;
                        t.last_seen_generation = gen;
                        t.departed_generation = None;
                    }
                }

                if let Some(audit) = audit_manager {
                    audit.emit_event(
                        "AMBIGUOUS_MOVE",
                        gen,
                        None,
                        None,
                        None,
                        Some(format!("{}, {}", departures[0].0.to_display_string(), departures[1].0.to_display_string())),
                        Some(format!("{}, {}", arrivals[0].0.to_display_string(), arrivals[1].0.to_display_string())),
                        Some(0.5),
                        Some("ambiguity-group".into()),
                        None,
                        None,
                        Some(ambig_id.clone()),
                        None,
                    );
                    audit.emit_event(
                        "AMBIGUITY_CREATED",
                        gen,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        Some(ambig_id.clone()),
                        None,
                    );
                }

                self.ambiguity_groups.push(AmbiguityGroup {
                    group_id: ambig_id,
                    track_ids: tids,
                    possible_locations: locs,
                    created_generation: gen,
                });
                departures.clear();
                arrivals.clear();
            }
        }

        // Departures remaining without matching arrival: mark departed_generation
        for (_dep_loc, tid) in departures {
            if let Some(track) = self.tracks.get_mut(&tid) {
                if track.departed_generation.is_none() {
                    track.departed_generation = Some(gen);
                }
            }
        }

        // Step 4: Purchase Arrival Fusion
        // Match remaining Bench arrivals against active PurchaseCandidates
        let mut unconsumed_bench_arrivals = Vec::new();
        for (arr_loc, arr_sig) in arrivals {
            match arr_loc {
                LocationRef::Bench(slot) => {
                    if !self.pending_purchases.is_empty() {
                        let cand = self.pending_purchases.remove(0);
                        self.next_track_counter += 1;
                        let track_id = format!("track-{}", self.next_track_counter);
                        let new_track = OwnedUnitTrack {
                            track_id: track_id.clone(),
                            champion_id: Some(cand.champion_id.clone()),
                            champion_name: Some(cand.champion_name.clone()),
                            location: Some(LocationRef::Bench(slot)),
                            state: OwnedUnitState::Known,
                            identity_source: "shop-purchase".to_string(),
                            identity_confidence: cand.confidence,
                            star_level: Some(1),
                            star_confidence: Some(1.0),
                            appearance_signature: Some(arr_sig),
                            created_generation: gen,
                            last_seen_generation: gen,
                            departed_generation: None,
                        };
                        self.tracks.insert(track_id.clone(), new_track);

                        let b_str = format!("B{}", slot + 1);
                        self.push_recent_event(format!("BUY {} ({})", cand.champion_name, b_str), gen);

                        if let Some(audit) = audit_manager {
                            audit.emit_event(
                                "PURCHASE_RESOLVED",
                                gen,
                                Some(cand.champion_id.clone()),
                                Some(cand.champion_name.clone()),
                                Some(track_id.clone()),
                                Some(format!("Shop S{}", cand.shop_slot + 1)),
                                Some(b_str.clone()),
                                Some(cand.confidence),
                                Some("shop-purchase".into()),
                                Some(cand.shop_slot),
                                Some(cand.event_id.clone()),
                                None,
                                None,
                            );
                            audit.emit_event(
                                "TRACK_CREATED",
                                gen,
                                Some(cand.champion_id.clone()),
                                Some(cand.champion_name.clone()),
                                Some(track_id.clone()),
                                None,
                                Some(b_str.clone()),
                                Some(cand.confidence),
                                Some("shop-purchase".into()),
                                None,
                                None,
                                None,
                                None,
                            );
                            audit.emit_event(
                                "IDENTITY_ASSIGNED",
                                gen,
                                Some(cand.champion_id.clone()),
                                Some(cand.champion_name.clone()),
                                Some(track_id.clone()),
                                None,
                                Some(b_str),
                                Some(cand.confidence),
                                Some("shop-purchase".into()),
                                None,
                                None,
                                None,
                                None,
                            );
                        }
                    } else {
                        unconsumed_bench_arrivals.push((arr_loc, arr_sig));
                    }
                }
                LocationRef::Board(hex) => {
                    // Unexplained board arrival (e.g. mid-game start)
                    self.next_track_counter += 1;
                    let track_id = format!("track-{}", self.next_track_counter);
                    let unknown_track = OwnedUnitTrack {
                        track_id: track_id.clone(),
                        champion_id: None,
                        champion_name: None,
                        location: Some(arr_loc),
                        state: OwnedUnitState::Unknown,
                        identity_source: "initial-unknown".to_string(),
                        identity_confidence: 0.0,
                        star_level: None,
                        star_confidence: None,
                        appearance_signature: Some(arr_sig),
                        created_generation: gen,
                        last_seen_generation: gen,
                        departed_generation: None,
                    };
                    self.tracks.insert(track_id.clone(), unknown_track);

                    let h_str = format!("H{}", hex + 1);
                    if let Some(audit) = audit_manager {
                        audit.emit_event(
                            "TRACK_CREATED",
                            gen,
                            None,
                            None,
                            Some(track_id),
                            None,
                            Some(h_str),
                            Some(0.0),
                            Some("initial-unknown".into()),
                            None,
                            None,
                            None,
                            None,
                        );
                    }
                }
            }
        }

        // Unconsumed bench arrivals without purchase
        for (arr_loc, arr_sig) in unconsumed_bench_arrivals {
            self.next_track_counter += 1;
            let track_id = format!("track-{}", self.next_track_counter);
            let unknown_track = OwnedUnitTrack {
                track_id: track_id.clone(),
                champion_id: None,
                champion_name: None,
                location: Some(arr_loc),
                state: OwnedUnitState::Unknown,
                identity_source: "initial-unknown".to_string(),
                identity_confidence: 0.0,
                star_level: None,
                star_confidence: None,
                appearance_signature: Some(arr_sig),
                created_generation: gen,
                last_seen_generation: gen,
                departed_generation: None,
            };
            self.tracks.insert(track_id.clone(), unknown_track);

            if let Some(audit) = audit_manager {
                audit.emit_event(
                    "TRACK_CREATED",
                    gen,
                    None,
                    None,
                    Some(track_id),
                    None,
                    Some(arr_loc.to_display_string()),
                    Some(0.0),
                    Some("initial-unknown".into()),
                    None,
                    None,
                    None,
                    None,
                );
            }
        }

        // Step 5: Check Auto-Combine for any active purchase candidates
        let mut p_idx = 0;
        while p_idx < self.pending_purchases.len() {
            let (cand_champ_id, cand_champ_name, cand_conf) = {
                let cand = &self.pending_purchases[p_idx];
                (cand.champion_id.clone(), cand.champion_name.clone(), cand.confidence)
            };
            let same_champ_1stars: Vec<String> = self.tracks.iter()
                .filter(|(_, t)| {
                    t.champion_id.as_deref() == Some(&cand_champ_id)
                        && t.star_level == Some(1)
                })
                .map(|(id, _)| id.clone())
                .collect();

            if same_champ_1stars.len() >= 2 {
                let t0_departed = self.tracks.get(&same_champ_1stars[0]).and_then(|t| t.departed_generation).is_some();
                let t1_departed = self.tracks.get(&same_champ_1stars[1]).and_then(|t| t.departed_generation).is_some();

                if t0_departed || t1_departed {
                    let (retained_id, consumed_id) = if t0_departed {
                        (same_champ_1stars[1].clone(), same_champ_1stars[0].clone())
                    } else {
                        (same_champ_1stars[0].clone(), same_champ_1stars[1].clone())
                    };

                    let conf = cand_conf;
                    if let Some(ret) = self.tracks.get_mut(&retained_id) {
                        ret.star_level = Some(2);
                        ret.star_confidence = Some(1.0);
                        ret.identity_source = "tracked-combine".to_string();
                        ret.identity_confidence = ret.identity_confidence.min(conf);
                    }

                    self.combine_events.push(CombineEvent {
                        champion_id: cand_champ_id.clone(),
                        consumed_track_ids: vec![consumed_id.clone(), retained_id.clone()],
                        resulting_track_id: retained_id.clone(),
                        resulting_star_level: Some(2),
                        confidence: conf,
                        generation: gen,
                    });

                    self.push_recent_event(format!("COMBINE {} → 2★", cand_champ_name), gen);

                    if let Some(audit) = audit_manager {
                        audit.emit_event(
                            "COMBINE",
                            gen,
                            Some(cand_champ_id.clone()),
                            Some(cand_champ_name.clone()),
                            Some(retained_id.clone()),
                            None,
                            None,
                            Some(conf),
                            Some("tracked-combine".into()),
                            None,
                            None,
                            None,
                            None,
                        );
                        audit.emit_event(
                            "TRACK_REMOVED",
                            gen,
                            Some(cand_champ_id.clone()),
                            Some(cand_champ_name.clone()),
                            Some(consumed_id.clone()),
                            None,
                            None,
                            Some(conf),
                            Some("tracked-combine".into()),
                            None,
                            None,
                            None,
                            None,
                        );
                        audit.emit_event(
                            "IDENTITY_ASSIGNED",
                            gen,
                            Some(cand_champ_id.clone()),
                            Some(cand_champ_name.clone()),
                            Some(retained_id),
                            None,
                            None,
                            Some(conf),
                            Some("tracked-combine".into()),
                            None,
                            None,
                            None,
                            None,
                        );
                    }

                    self.tracks.remove(&consumed_id);
                    self.pending_purchases.remove(p_idx);
                    continue;
                }
            }
            p_idx += 1;
        }

        // Step 6: Expirations & Sales
        self.pending_purchases.retain(|c| gen < c.expires_at_generation);

        // Prune departed tracks past resolution window (2 frames)
        let mut pruned_tracks = Vec::new();
        for (id, t) in &self.tracks {
            if let Some(dep_gen) = t.departed_generation {
                if gen >= dep_gen + 2 {
                    pruned_tracks.push((
                        id.clone(),
                        t.champion_id.clone(),
                        t.champion_name.clone(),
                        t.location.map(|l| l.to_display_string()),
                    ));
                }
            }
        }

        for (tid, cid, cname, loc_str) in pruned_tracks {
            let name_str = cname.clone().unwrap_or_else(|| "Unit".into());
            self.push_recent_event(format!("SALE {}", name_str), gen);

            if let Some(audit) = audit_manager {
                audit.emit_event(
                    "POSSIBLE_SALE",
                    gen,
                    cid.clone(),
                    cname.clone(),
                    Some(tid.clone()),
                    loc_str,
                    None,
                    Some(0.8),
                    Some("sale-resolution".into()),
                    None,
                    None,
                    None,
                    None,
                );
                audit.emit_event(
                    "TRACK_REMOVED",
                    gen,
                    cid.clone(),
                    cname.clone(),
                    Some(tid.clone()),
                    None,
                    None,
                    None,
                    Some("sale-resolution".into()),
                    None,
                    None,
                    None,
                    None,
                );
                if cid.is_some() {
                    audit.emit_event(
                        "IDENTITY_LOST",
                        gen,
                        cid,
                        cname,
                        Some(tid.clone()),
                        None,
                        None,
                        None,
                        Some("sale-resolution".into()),
                        None,
                        None,
                        None,
                        None,
                    );
                }
            }
            self.tracks.remove(&tid);
        }

        // Step 7: Populate Output Statuses & Compute Ledger
        let mut total_occupied = 0usize;
        let mut known_occupied = 0usize;

        // Bench statuses
        for i in 0..9 {
            let loc = LocationRef::Bench(i);
            let s = &mut bench_statuses[i];
            if s.occupied {
                total_occupied += 1;
                let track_opt = self.tracks.values().find(|t| t.location == Some(loc) && t.departed_generation.is_none());
                if let Some(t) = track_opt {
                    s.state = t.state;
                    s.track_id = Some(t.track_id.clone());
                    s.champion_id = t.champion_id.clone();
                    s.champion_name = t.champion_name.clone();
                    s.identity_source = Some(t.identity_source.clone());
                    s.identity_confidence = t.identity_confidence;
                    s.star_level = t.star_level;
                    s.star_confidence = t.star_confidence;
                    if t.state == OwnedUnitState::Known {
                        known_occupied += 1;
                    }
                } else {
                    let in_ambig = self.ambiguity_groups.iter().any(|g| g.possible_locations.contains(&loc));
                    if in_ambig {
                        s.state = OwnedUnitState::Ambiguous;
                    } else {
                        s.state = OwnedUnitState::Unknown;
                    }
                }
            } else {
                s.state = OwnedUnitState::Empty;
                s.track_id = None;
                s.champion_id = None;
                s.champion_name = None;
                s.identity_source = None;
                s.identity_confidence = 0.0;
                s.star_level = None;
            }
        }

        // Board statuses
        for h in 0..28 {
            let loc = LocationRef::Board(h);
            let c = &mut board_statuses[h];
            if c.occupied {
                total_occupied += 1;
                let track_opt = self.tracks.values().find(|t| t.location == Some(loc) && t.departed_generation.is_none());
                if let Some(t) = track_opt {
                    c.state = t.state;
                    c.track_id = Some(t.track_id.clone());
                    c.champion_id = t.champion_id.clone();
                    c.champion_name = t.champion_name.clone();
                    c.identity_source = Some(t.identity_source.clone());
                    c.identity_confidence = t.identity_confidence;
                    c.star_level = t.star_level;
                    if t.state == OwnedUnitState::Known {
                        known_occupied += 1;
                    }
                } else {
                    let in_ambig = self.ambiguity_groups.iter().any(|g| g.possible_locations.contains(&loc));
                    if in_ambig {
                        c.state = OwnedUnitState::Ambiguous;
                    } else {
                        c.state = OwnedUnitState::Unknown;
                    }
                }
            } else {
                c.state = OwnedUnitState::Empty;
                c.track_id = None;
                c.champion_id = None;
                c.champion_name = None;
                c.identity_source = None;
                c.identity_confidence = 0.0;
                c.star_level = None;
            }
        }

        let coverage = if total_occupied > 0 {
            known_occupied as f32 / total_occupied as f32
        } else {
            1.0
        };

        // Aggregate knownOwned ledger
        let mut groups: HashMap<String, Vec<&OwnedUnitTrack>> = HashMap::new();
        for t in self.tracks.values() {
            if let Some(ref cid) = t.champion_id {
                groups.entry(cid.clone()).or_default().push(t);
            }
        }

        let mut known_owned: Vec<KnownOwnedChampion> = groups
            .into_iter()
            .map(|(cid, trs)| {
                let name = trs[0].champion_name.clone().unwrap_or_default();
                let count = trs.len();
                let all_known_stars = trs.iter().all(|t| t.star_level.is_some());
                let copy_equiv = if all_known_stars {
                    let sum = trs.iter().map(|t| match t.star_level {
                        Some(1) => 1,
                        Some(2) => 3,
                        Some(3) => 9,
                        _ => 1,
                    }).sum();
                    Some(sum)
                } else {
                    None
                };
                let min_conf = trs.iter().map(|t| t.identity_confidence).fold(1.0f32, f32::min);

                KnownOwnedChampion {
                    champion_id: cid,
                    champion_name: name,
                    known_track_count: count,
                    known_copy_equivalent: copy_equiv,
                    confidence: min_conf,
                }
            })
            .collect();
        known_owned.sort_by(|a, b| a.champion_name.cmp(&b.champion_name));

        if let Some(audit) = audit_manager {
            audit.record_frame_coverage(coverage);
        }

        (known_owned, coverage, self.pending_purchases.len(), self.ambiguity_groups.len())
    }
}

fn get_location_rect(loc: LocationRef, bench_rects: &[PixelRect], board_rects: &[PixelRect]) -> Option<PixelRect> {
    match loc {
        LocationRef::Bench(s) => bench_rects.get(s).copied(),
        LocationRef::Board(h) => board_rects.get(h).copied(),
    }
}

/// The Core Board and Bench Vision Engine
pub struct BoardVisionEngine {
    bench_layout: BenchLayout,
    board_layout: BoardLayout,
    latest_status: RwLock<ScreenOwnedUnitsStatus>,
    frame_counter: AtomicU64,
    last_process_time: Mutex<Instant>,
    bench_tracks: Mutex<[TemporalSlotTrack; 9]>,
    board_tracks: Mutex<[TemporalSlotTrack; 28]>,
    pub tracker: Mutex<EntityTracker>,
    pub audit_manager: Arc<crate::owned_unit_audit::AuditManager>,
}

impl BoardVisionEngine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            bench_layout: BenchLayout::default(),
            board_layout: BoardLayout::default(),
            latest_status: RwLock::new(ScreenOwnedUnitsStatus::default()),
            frame_counter: AtomicU64::new(0),
            last_process_time: Mutex::new(Instant::now()),
            bench_tracks: Mutex::new(std::array::from_fn(|_| TemporalSlotTrack::default())),
            board_tracks: Mutex::new(std::array::from_fn(|_| TemporalSlotTrack::default())),
            tracker: Mutex::new(EntityTracker::new()),
            audit_manager: crate::owned_unit_audit::AuditManager::new(),
        })
    }

    pub fn reset(&self) {
        *self.latest_status.write().unwrap() = ScreenOwnedUnitsStatus::default();
        let mut b_tracks = self.bench_tracks.lock().unwrap();
        for t in b_tracks.iter_mut() {
            *t = TemporalSlotTrack::default();
        }
        let mut bd_tracks = self.board_tracks.lock().unwrap();
        for t in bd_tracks.iter_mut() {
            *t = TemporalSlotTrack::default();
        }
        self.tracker.lock().unwrap().reset();
    }

    pub fn get_status(&self) -> ScreenOwnedUnitsStatus {
        let mut st = self.latest_status.read().unwrap().clone();
        let last_time = *self.last_process_time.lock().unwrap();
        st.frame_age_ms = last_time.elapsed().as_millis() as u64;
        st
    }

    pub fn start_audit(&self, save_crops: bool) -> crate::owned_unit_audit::AuditSessionStatus {
        self.audit_manager.start_session(save_crops)
    }

    pub fn stop_audit(&self) -> Option<crate::owned_unit_audit::AuditSessionStatus> {
        self.audit_manager.stop_session()
    }

    pub fn clear_audit(&self) {
        self.audit_manager.clear_session();
    }

    pub fn get_audit_status(&self) -> Option<crate::owned_unit_audit::AuditSessionStatus> {
        self.audit_manager.get_status()
    }

    pub fn export_audit(&self) -> Result<String, String> {
        self.audit_manager.export()
    }

    pub fn add_manual_label(&self, label: crate::owned_unit_audit::ManualLabel) {
        self.audit_manager.add_label(label);
    }

    pub fn add_missed_event(&self, missed: crate::owned_unit_audit::MissedEvent) {
        self.audit_manager.add_missed_event(missed);
    }

    /// Processes a captured frame buffer and updates bench and board state
    pub fn process_frame(&self, bgra: &[u8], frame_w: u32, frame_h: u32) -> ScreenOwnedUnitsStatus {
        self.process_frame_with_shop(bgra, frame_w, frame_h, None)
    }

    /// Processes a captured frame buffer with shop fusion and temporal tracking
    pub fn process_frame_with_shop(
        &self,
        bgra: &[u8],
        frame_w: u32,
        frame_h: u32,
        shop_status: Option<&crate::shop_vision::ScreenShopStatus>,
    ) -> ScreenOwnedUnitsStatus {
        let start = Instant::now();
        let gen = self.frame_counter.fetch_add(1, Ordering::SeqCst) + 1;

        let (_bench_outer, bench_rects) = self.bench_layout.compute_pixel_geometry(frame_w, frame_h);
        let (_board_outer, board_rects) = self.board_layout.compute_pixel_geometry(frame_w, frame_h);

        let mut b_tracks = self.bench_tracks.lock().unwrap();
        let mut bd_tracks = self.board_tracks.lock().unwrap();

        // 1. Classify Bench Slots & extract signatures
        let mut bench_statuses = Vec::with_capacity(9);
        let mut bench_signatures = Vec::with_capacity(9);
        for i in 0..9 {
            let rect = bench_rects[i];
            let raw_state = if let Some(feat) = extract_roi_visual_features(bgra, frame_w, frame_h, rect) {
                classify_bench_slot(&feat)
            } else {
                OccupancyState::Unknown
            };

            // Temporal filtering
            let track = &mut b_tracks[i];
            let stable_state = if track.consecutive_state == raw_state {
                track.stable_frames = track.stable_frames.saturating_add(1);
                raw_state
            } else {
                track.consecutive_state = raw_state;
                track.stable_frames = 1;
                // If transitioning to Occupied, require 2 consecutive frames before emitting Occupied to avoid glitch transitions
                if raw_state == OccupancyState::Occupied {
                    OccupancyState::Unknown
                } else {
                    raw_state
                }
            };

            let sig = if stable_state == OccupancyState::Occupied {
                extract_roi_appearance_signature(bgra, frame_w, frame_h, rect)
            } else {
                None
            };
            bench_signatures.push(sig);

            bench_statuses.push(BenchSlotStatus {
                slot: i,
                occupancy: stable_state,
                occupied: stable_state == OccupancyState::Occupied,
                state: if stable_state == OccupancyState::Empty { OwnedUnitState::Empty } else { OwnedUnitState::Unknown },
                track_id: None,
                champion_id: None,
                champion_name: None,
                identity_source: None,
                identity_confidence: 0.0,
                star_level: None,
                star_confidence: None,
                rect,
            });
        }

        // 2. Classify Board Hexes & extract signatures
        let mut board_statuses = Vec::with_capacity(28);
        let mut board_signatures = Vec::with_capacity(28);
        for h in 0..28 {
            let rect = board_rects[h];
            let raw_state = if let Some(feat) = extract_roi_visual_features(bgra, frame_w, frame_h, rect) {
                classify_board_cell(&feat)
            } else {
                OccupancyState::Unknown
            };

            let track = &mut bd_tracks[h];
            let stable_state = if track.consecutive_state == raw_state {
                track.stable_frames = track.stable_frames.saturating_add(1);
                raw_state
            } else {
                track.consecutive_state = raw_state;
                track.stable_frames = 1;
                if raw_state == OccupancyState::Occupied {
                    OccupancyState::Unknown
                } else {
                    raw_state
                }
            };

            let sig = if stable_state == OccupancyState::Occupied {
                extract_roi_appearance_signature(bgra, frame_w, frame_h, rect)
            } else {
                None
            };
            board_signatures.push(sig);

            board_statuses.push(BoardCellStatus {
                hex: h,
                row: h / 7,
                col: h % 7,
                occupancy: stable_state,
                occupied: stable_state == OccupancyState::Occupied,
                state: if stable_state == OccupancyState::Empty { OwnedUnitState::Empty } else { OwnedUnitState::Unknown },
                track_id: None,
                champion_id: None,
                champion_name: None,
                identity_source: None,
                identity_confidence: 0.0,
                star_level: None,
                rect,
            });
        }

        // 3. Run Entity Tracking & Purchase Fusion
        let (known_owned, coverage, pending_count, ambig_count) = self.tracker.lock().unwrap().update_with_audit(
            gen,
            &mut bench_statuses,
            &mut board_statuses,
            &bench_signatures,
            &board_signatures,
            shop_status,
            Some(&self.audit_manager),
            Some(bgra),
            Some(frame_w),
            Some(frame_h),
            &bench_rects,
            &board_rects,
        );

        self.audit_manager.record_frame_coverage(coverage);
        let recent_events = self.tracker.lock().unwrap().recent_events.clone();

        let elapsed = start.elapsed().as_secs_f32() * 1000.0;
        *self.last_process_time.lock().unwrap() = Instant::now();

        let status = ScreenOwnedUnitsStatus {
            available: true,
            detected: true,
            frame_generation: gen,
            frame_age_ms: 0,
            processing_time_ms: elapsed,
            identity_coverage: coverage,
            recognition_version: RECOGNITION_VERSION.to_string(),
            bench_layout_version: self.bench_layout.geometry_version.clone(),
            board_layout_version: self.board_layout.geometry_version.clone(),
            bench: bench_statuses,
            board: board_statuses,
            known_owned,
            pending_purchases: pending_count,
            ambiguity_groups: ambig_count,
            recent_events,
        };

        // Thread-safe update, preserving monotonicity: older generation never overwrites newer
        let mut latest = self.latest_status.write().unwrap();
        if latest.frame_generation < gen {
            *latest = status.clone();
        }

        status
    }
}

pub struct BoardVisionStateHandle {
    pub inner: Arc<BoardVisionEngine>,
}

#[tauri::command]
pub fn screen_owned_units_status(
    state: tauri::State<BoardVisionStateHandle>,
) -> ScreenOwnedUnitsStatus {
    state.inner.get_status()
}

#[tauri::command]
pub fn start_owned_unit_audit(
    save_crops: Option<bool>,
    state: tauri::State<BoardVisionStateHandle>,
) -> crate::owned_unit_audit::AuditSessionStatus {
    state.inner.start_audit(save_crops.unwrap_or(false))
}

#[tauri::command]
pub fn stop_owned_unit_audit(
    state: tauri::State<BoardVisionStateHandle>,
) -> Option<crate::owned_unit_audit::AuditSessionStatus> {
    state.inner.stop_audit()
}

#[tauri::command]
pub fn get_owned_unit_audit_status(
    state: tauri::State<BoardVisionStateHandle>,
) -> Option<crate::owned_unit_audit::AuditSessionStatus> {
    state.inner.get_audit_status()
}

#[tauri::command]
pub fn clear_owned_unit_audit(
    state: tauri::State<BoardVisionStateHandle>,
) {
    state.inner.clear_audit();
}

#[tauri::command]
pub fn export_owned_unit_audit(
    state: tauri::State<BoardVisionStateHandle>,
) -> Result<String, String> {
    state.inner.export_audit()
}

#[tauri::command]
pub fn add_manual_audit_label(
    label: crate::owned_unit_audit::ManualLabel,
    state: tauri::State<BoardVisionStateHandle>,
) {
    state.inner.add_manual_label(label);
}

#[tauri::command]
pub fn add_missed_audit_event(
    missed: crate::owned_unit_audit::MissedEvent,
    state: tauri::State<BoardVisionStateHandle>,
) {
    state.inner.add_missed_event(missed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_1_bench_geometry_1080p() {
        let layout = BenchLayout::default();
        let (outer, slots) = layout.compute_pixel_geometry(1920, 1080);

        assert_eq!(slots.len(), 9);
        assert_eq!(outer.x, 355);
        assert_eq!(outer.width, 1080);
        assert_eq!(outer.y, 670);
        assert_eq!(outer.height, 165);

        // Pitch between slot centers is exactly 120 pixels
        for i in 0..8 {
            let cx1 = slots[i].x + (slots[i].width as i32) / 2;
            let cx2 = slots[i + 1].x + (slots[i + 1].width as i32) / 2;
            assert_eq!(cx2 - cx1, 120, "Slot {} to {} pitch should be 120px", i, i + 1);
        }
    }

    #[test]
    fn test_2_bench_geometry_scaling() {
        let layout = BenchLayout::default();

        // 1440p standard 16:9
        let (outer_1440, slots_1440) = layout.compute_pixel_geometry(2560, 1440);
        assert_eq!(slots_1440.len(), 9);
        assert_eq!(outer_1440.width, (1080.0f32 * 2560.0 / 1920.0).round() as u32); // 1440

        // 4K standard 16:9
        let (outer_4k, slots_4k) = layout.compute_pixel_geometry(3840, 2160);
        assert_eq!(slots_4k.len(), 9);
        assert_eq!(outer_4k.width, 2160);

        // 900p standard 16:9
        let (outer_900, slots_900) = layout.compute_pixel_geometry(1600, 900);
        assert_eq!(slots_900.len(), 9);
        assert_eq!(outer_900.width, 900);
    }

    #[test]
    fn test_3_board_geometry_1080p() {
        let layout = BoardLayout::default();
        let (_outer, hexes) = layout.compute_pixel_geometry(1920, 1080);

        assert_eq!(hexes.len(), 28);

        // Verify rows
        for _r in 0..4 {
            let row_hexes: Vec<_> = hexes.iter().filter(|h| h.y > 0).collect();
            assert_eq!(row_hexes.len(), 28);
        }

        // Row 0 hex 3 (center hex, index 3) should be centered at X=960
        let h3 = &layout.hexes[3];
        assert_eq!(h3.row, 0);
        assert_eq!(h3.col, 3);
        assert!((h3.normalized_center_x * 1920.0 - 960.0).abs() < 1.0);

        // Row 2 hex 17 (center hex, index 2*7 + 3 = 17) should be centered at X=960
        let h17 = &layout.hexes[17];
        assert_eq!(h17.row, 2);
        assert_eq!(h17.col, 3);
        assert!((h17.normalized_center_x * 1920.0 - 960.0).abs() < 1.0);
    }

    #[test]
    fn test_4_board_perspective_scaling() {
        let layout = BoardLayout::default();

        // Row 3 (backline) hex ROI width should be wider than Row 0 (frontline) due to perspective
        let h_row0 = &layout.hexes[3];
        let h_row3 = &layout.hexes[24];

        assert!(
            h_row3.roi.width > h_row0.roi.width,
            "Perspective requires backline hexes to be wider on screen than frontline hexes"
        );
    }

    #[test]
    fn test_5_bench_slot_ordering() {
        let layout = BenchLayout::default();
        for i in 0..8 {
            assert!(layout.slots[i].center_x < layout.slots[i + 1].center_x);
            assert!(layout.slots[i].roi.x < layout.slots[i + 1].roi.x);
        }
    }

    #[test]
    fn test_6_board_hex_indexing_stable() {
        let layout = BoardLayout::default();
        for i in 0..28 {
            assert_eq!(layout.hexes[i].hex, i);
            assert_eq!(layout.hexes[i].row, i / 7);
            assert_eq!(layout.hexes[i].col, i % 7);
        }
    }

    #[test]
    fn test_7_empty_bench_detection() {
        let engine = BoardVisionEngine::new();
        // Flat blue slate buffer (empty arena tile)
        let mut bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        for i in (0..bgra.len()).step_by(4) {
            bgra[i] = 135;     // B
            bgra[i + 1] = 75;  // G
            bgra[i + 2] = 45;  // R
            bgra[i + 3] = 255;
        }

        let status = engine.process_frame(&bgra, 1920, 1080);
        for slot in &status.bench {
            assert_eq!(slot.occupancy, OccupancyState::Empty);
            assert!(!slot.occupied);
        }
    }

    #[test]
    fn test_8_occupied_bench_detection_with_health_bar() {
        let engine = BoardVisionEngine::new();
        let mut bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        // Flat background
        for i in (0..bgra.len()).step_by(4) {
            bgra[i] = 135;
            bgra[i + 1] = 75;
            bgra[i + 2] = 45;
            bgra[i + 3] = 255;
        }

        // Draw a unit model with edge gradient on slot 0
        let (_outer, slots) = engine.bench_layout.compute_pixel_geometry(1920, 1080);
        let s0 = slots[0];

        // Draw complex texture in slot 0
        for y in s0.y..(s0.y + s0.height as i32) {
            for x in s0.x..(s0.x + s0.width as i32) {
                let idx = ((y as u32 * 1920 + x as u32) * 4) as usize;
                if idx + 3 < bgra.len() {
                    let noise = ((x * 17) ^ (y * 31)) as u8;
                    bgra[idx] = noise;
                    bgra[idx + 1] = noise.wrapping_mul(3);
                    bgra[idx + 2] = noise.wrapping_mul(5);
                }
            }
        }

        // Frame 1
        let _ = engine.process_frame(&bgra, 1920, 1080);
        // Frame 2 (temporal stability)
        let status = engine.process_frame(&bgra, 1920, 1080);

        assert_eq!(status.bench[0].occupancy, OccupancyState::Occupied);
        assert!(status.bench[0].occupied);
        assert_eq!(status.bench[1].occupancy, OccupancyState::Empty);
    }

    #[test]
    fn test_9_empty_board_cell() {
        let engine = BoardVisionEngine::new();
        let mut bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        for i in (0..bgra.len()).step_by(4) {
            bgra[i] = 120;
            bgra[i + 1] = 60;
            bgra[i + 2] = 40;
            bgra[i + 3] = 255;
        }

        let status = engine.process_frame(&bgra, 1920, 1080);
        for hex in &status.board {
            assert_eq!(hex.occupancy, OccupancyState::Empty);
        }
    }

    #[test]
    fn test_10_occupied_board_cell() {
        let engine = BoardVisionEngine::new();
        let mut bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        for i in (0..bgra.len()).step_by(4) {
            bgra[i] = 120;
            bgra[i + 1] = 60;
            bgra[i + 2] = 40;
            bgra[i + 3] = 255;
        }

        let (_outer, hex_rects) = engine.board_layout.compute_pixel_geometry(1920, 1080);
        let target_hex = hex_rects[10]; // Row 1, Col 3

        for y in target_hex.y..(target_hex.y + target_hex.height as i32) {
            for x in target_hex.x..(target_hex.x + target_hex.width as i32) {
                let idx = ((y as u32 * 1920 + x as u32) * 4) as usize;
                if idx + 3 < bgra.len() {
                    let pattern = ((x * 23) ^ (y * 41)) as u8;
                    bgra[idx] = pattern;
                    bgra[idx + 1] = pattern.wrapping_add(80);
                    bgra[idx + 2] = pattern.wrapping_add(160);
                }
            }
        }

        // Frame 1
        let _ = engine.process_frame(&bgra, 1920, 1080);
        // Frame 2
        let status = engine.process_frame(&bgra, 1920, 1080);

        assert_eq!(status.board[10].occupancy, OccupancyState::Occupied);
        assert!(status.board[10].occupied);
        assert_eq!(status.board[0].occupancy, OccupancyState::Empty);
    }

    #[test]
    fn test_11_ui_obscuration_becomes_unknown() {
        let engine = BoardVisionEngine::new();
        let mut bgra = vec![0u8; (1920 * 1080 * 4) as usize];
        // Flat background
        for i in (0..bgra.len()).step_by(4) {
            bgra[i] = 135;
            bgra[i + 1] = 75;
            bgra[i + 2] = 45;
            bgra[i + 3] = 255;
        }

        // Fill slot 3 with dark UI tooltip box
        let (_outer, slots) = engine.bench_layout.compute_pixel_geometry(1920, 1080);
        let s3 = slots[3];
        for y in s3.y..(s3.y + s3.height as i32) {
            for x in s3.x..(s3.x + s3.width as i32) {
                let idx = ((y as u32 * 1920 + x as u32) * 4) as usize;
                if idx + 3 < bgra.len() {
                    bgra[idx] = 20;     // B
                    bgra[idx + 1] = 15; // G
                    bgra[idx + 2] = 8;  // R
                }
            }
        }

        let status = engine.process_frame(&bgra, 1920, 1080);
        assert_eq!(status.bench[3].occupancy, OccupancyState::Unknown);
        assert!(!status.bench[3].occupied);
    }

    #[test]
    fn test_12_stale_frame_cannot_overwrite_newer_state() {
        let engine = BoardVisionEngine::new();
        let bgra = vec![0u8; (1920 * 1080 * 4) as usize];

        let s1 = engine.process_frame(&bgra, 1920, 1080);
        let s2 = engine.process_frame(&bgra, 1920, 1080);
        assert!(s2.frame_generation > s1.frame_generation);

        // Manually attempt to overwrite with older generation
        {
            let mut latest = engine.latest_status.write().unwrap();
            if latest.frame_generation < s1.frame_generation {
                *latest = s1.clone();
            }
        }
        let current = engine.get_status();
        assert_eq!(current.frame_generation, s2.frame_generation);
    }

    #[test]
    fn test_13_temporal_stability() {
        let engine = BoardVisionEngine::new();
        let mut bgra = vec![0u8; (1920 * 1080 * 4) as usize];

        let (_outer, slots) = engine.bench_layout.compute_pixel_geometry(1920, 1080);
        let s2 = slots[2];

        for y in s2.y..(s2.y + s2.height as i32) {
            for x in s2.x..(s2.x + s2.width as i32) {
                let idx = ((y as u32 * 1920 + x as u32) * 4) as usize;
                if idx + 3 < bgra.len() {
                    let v = ((x * 19) ^ (y * 29)) as u8;
                    bgra[idx] = v;
                    bgra[idx + 1] = v.wrapping_mul(2);
                    bgra[idx + 2] = v.wrapping_mul(4);
                }
            }
        }

        // Single frame of occupied texture requires 2 consecutive frames
        let f1 = engine.process_frame(&bgra, 1920, 1080);
        assert_eq!(f1.bench[2].occupancy, OccupancyState::Unknown);

        // Second confirming frame stabilizes as Occupied
        let f2 = engine.process_frame(&bgra, 1920, 1080);
        assert_eq!(f2.bench[2].occupancy, OccupancyState::Occupied);
    }

    // =====================================================================
    //  C4/C5 — EntityTracker unit tests
    // =====================================================================

    /// Helper: Create a mock ShopSlotRecognition with a champion
    fn mock_shop_slot(index: usize, champ_id: &str, champ_name: &str, stable: bool) -> crate::shop_vision::ShopSlotRecognition {
        crate::shop_vision::ShopSlotRecognition {
            index,
            state: crate::shop_vision::ShopSlotState::Champion,
            champion_id: Some(champ_id.to_string()),
            champion_name: Some(champ_name.to_string()),
            cost: Some(1),
            confidence: 0.92,
            second_best_champion_id: None,
            second_best_confidence: 0.0,
            margin: 0.50,
            stable,
            stable_frames: if stable { 3 } else { 1 },
            rect: crate::shop_vision::PixelRect { x: 0, y: 0, width: 100, height: 100 },
        }
    }

    /// Helper: Create an empty shop slot
    fn mock_empty_shop_slot(index: usize) -> crate::shop_vision::ShopSlotRecognition {
        crate::shop_vision::ShopSlotRecognition {
            index,
            state: crate::shop_vision::ShopSlotState::Empty,
            champion_id: None,
            champion_name: None,
            cost: None,
            confidence: 0.0,
            second_best_champion_id: None,
            second_best_confidence: 0.0,
            margin: 0.0,
            stable: true,
            stable_frames: 3,
            rect: crate::shop_vision::PixelRect { x: 0, y: 0, width: 100, height: 100 },
        }
    }

    /// Helper: Create a mock ScreenShopStatus with 5 slots
    fn mock_shop_status(gen: u64, slots: Vec<crate::shop_vision::ShopSlotRecognition>) -> crate::shop_vision::ScreenShopStatus {
        crate::shop_vision::ScreenShopStatus {
            available: true,
            detected: true,
            frame_age_ms: 0,
            processing_time_ms: 1.0,
            recognition_version: "test".to_string(),
            generation: gen,
            slots,
            shop_region: crate::shop_vision::PixelRect { x: 0, y: 0, width: 1920, height: 200 },
        }
    }

    /// Helper: Create a distinct RoiAppearanceSignature seeded by an integer
    fn make_sig(seed: u8) -> RoiAppearanceSignature {
        let base = seed as f32 / 255.0;
        let mut hist = [0.0f32; 32];
        hist[(seed as usize) % 32] = 1.0;
        let mut grid = [base; 64];
        grid[0] = base * 0.5;
        grid[63] = base * 1.5;
        RoiAppearanceSignature {
            color_hist: hist,
            luminance_grid: grid,
            avg_gradient: 60.0 + seed as f32,
            avg_luminance: base,
        }
    }

    /// Helper: Create empty bench/board statuses and signatures for EntityTracker::update
    fn make_empty_bench() -> (Vec<BenchSlotStatus>, Vec<Option<RoiAppearanceSignature>>) {
        let statuses: Vec<BenchSlotStatus> = (0..9).map(|i| BenchSlotStatus {
            slot: i,
            occupancy: OccupancyState::Empty,
            occupied: false,
            state: OwnedUnitState::Empty,
            track_id: None,
            champion_id: None,
            champion_name: None,
            identity_source: None,
            identity_confidence: 0.0,
            star_level: None,
            star_confidence: None,
            rect: PixelRect { x: 0, y: 0, width: 120, height: 165 },
        }).collect();
        let sigs = vec![None; 9];
        (statuses, sigs)
    }

    fn make_empty_board() -> (Vec<BoardCellStatus>, Vec<Option<RoiAppearanceSignature>>) {
        let statuses: Vec<BoardCellStatus> = (0..28).map(|h| BoardCellStatus {
            hex: h,
            row: h / 7,
            col: h % 7,
            occupancy: OccupancyState::Empty,
            occupied: false,
            state: OwnedUnitState::Empty,
            track_id: None,
            champion_id: None,
            champion_name: None,
            identity_source: None,
            identity_confidence: 0.0,
            star_level: None,
            rect: PixelRect { x: 0, y: 0, width: 120, height: 100 },
        }).collect();
        let sigs = vec![None; 28];
        (statuses, sigs)
    }

    // --- C4 tests ---

    #[test]
    fn test_c4_14_purchase_candidate_detection() {
        // Shop frame 1: all 5 champions visible
        // Shop frame 2: slot 2 goes Empty → purchase candidate emitted
        let mut tracker = EntityTracker::new();
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, board_sigs) = make_empty_board();

        let shop1 = mock_shop_status(1, (0..5).map(|i| mock_shop_slot(i, &format!("champ{}", i), &format!("Champ{}", i), true)).collect());
        tracker.update(1, &mut bench, &mut board, &bench_sigs, &board_sigs, Some(&shop1));
        assert!(tracker.pending_purchases.is_empty(), "No purchase yet after first shop frame");

        // Second frame: slot 2 becomes empty
        let mut slots2: Vec<_> = (0..5).map(|i| mock_shop_slot(i, &format!("champ{}", i), &format!("Champ{}", i), true)).collect();
        slots2[2] = mock_empty_shop_slot(2);
        let shop2 = mock_shop_status(2, slots2);

        let (mut bench2, bench_sigs2) = make_empty_bench();
        let (mut board2, board_sigs2) = make_empty_board();
        tracker.update(2, &mut bench2, &mut board2, &bench_sigs2, &board_sigs2, Some(&shop2));

        assert_eq!(tracker.pending_purchases.len(), 1);
        assert_eq!(tracker.pending_purchases[0].champion_id, "champ2");
        assert_eq!(tracker.pending_purchases[0].champion_name, "Champ2");
        assert_eq!(tracker.pending_purchases[0].shop_slot, 2);
    }

    #[test]
    fn test_c4_15_reroll_invalidates_pending_purchases() {
        // If 2+ shop slots change to different champions simultaneously → reroll detected
        let mut tracker = EntityTracker::new();
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, board_sigs) = make_empty_board();

        let shop1 = mock_shop_status(1, (0..5).map(|i| mock_shop_slot(i, &format!("a{}", i), &format!("A{}", i), true)).collect());
        tracker.update(1, &mut bench, &mut board, &bench_sigs, &board_sigs, Some(&shop1));

        // Insert a pre-existing purchase candidate to prove reroll clears it
        tracker.pending_purchases.push(PurchaseCandidate {
            event_id: "fake".to_string(),
            champion_id: "stale".to_string(),
            champion_name: "Stale".to_string(),
            shop_slot: 0,
            source_frame_generation: 1,
            detected_frame_generation: 1,
            confidence: 0.9,
            expires_at_generation: 10,
        });
        assert_eq!(tracker.pending_purchases.len(), 1);

        // All 5 slots change to different champions → reroll
        let shop2 = mock_shop_status(2, (0..5).map(|i| mock_shop_slot(i, &format!("b{}", i), &format!("B{}", i), true)).collect());
        let (mut bench2, bench_sigs2) = make_empty_bench();
        let (mut board2, board_sigs2) = make_empty_board();
        tracker.update(2, &mut bench2, &mut board2, &bench_sigs2, &board_sigs2, Some(&shop2));

        assert!(tracker.pending_purchases.is_empty(), "Reroll should clear all pending purchases");
    }

    #[test]
    fn test_c4_16_unstable_slot_does_not_emit_purchase() {
        // Only stable shop slots should emit purchase candidates
        let mut tracker = EntityTracker::new();
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, board_sigs) = make_empty_board();

        // Frame 1: unstable champion in slot 3
        let shop1 = mock_shop_status(1, (0..5).map(|i| {
            if i == 3 { mock_shop_slot(i, "champ3", "Champ3", false) } // not stable
            else { mock_shop_slot(i, &format!("c{}", i), &format!("C{}", i), true) }
        }).collect());
        tracker.update(1, &mut bench, &mut board, &bench_sigs, &board_sigs, Some(&shop1));

        // Frame 2: slot 3 goes empty
        let mut slots2: Vec<_> = (0..5).map(|i| mock_shop_slot(i, &format!("c{}", i), &format!("C{}", i), true)).collect();
        slots2[3] = mock_empty_shop_slot(3);
        let shop2 = mock_shop_status(2, slots2);
        let (mut bench2, bench_sigs2) = make_empty_bench();
        let (mut board2, board_sigs2) = make_empty_board();
        tracker.update(2, &mut bench2, &mut board2, &bench_sigs2, &board_sigs2, Some(&shop2));

        // Should NOT emit purchase because slot 3 was unstable in the previous frame
        assert!(tracker.pending_purchases.is_empty(), "Unstable slot should not generate purchase candidate");
    }

    #[test]
    fn test_c4_17_purchase_fusion_with_bench_arrival() {
        // Purchase candidate + bench arrival in same frame → fused known track
        let mut tracker = EntityTracker::new();

        // Set up shop frame 1 with champions
        let shop1 = mock_shop_status(1, (0..5).map(|i| mock_shop_slot(i, &format!("champ{}", i), &format!("Champ{}", i), true)).collect());
        let (mut bench1, bench_sigs1) = make_empty_bench();
        let (mut board1, board_sigs1) = make_empty_board();
        tracker.update(1, &mut bench1, &mut board1, &bench_sigs1, &board_sigs1, Some(&shop1));

        // Shop frame 2: slot 0 becomes empty → purchase candidate for champ0
        // Bench: slot 4 becomes occupied → arrival
        let mut slots2: Vec<_> = (0..5).map(|i| mock_shop_slot(i, &format!("champ{}", i), &format!("Champ{}", i), true)).collect();
        slots2[0] = mock_empty_shop_slot(0);
        let shop2 = mock_shop_status(2, slots2);

        let (mut bench2, mut bench_sigs2) = make_empty_bench();
        bench2[4].occupancy = OccupancyState::Occupied;
        bench2[4].occupied = true;
        bench_sigs2[4] = Some(make_sig(42));
        let (mut board2, board_sigs2) = make_empty_board();

        let (known_owned, coverage, pending, _ambig) = tracker.update(2, &mut bench2, &mut board2, &bench_sigs2, &board_sigs2, Some(&shop2));

        // Verify: purchase was consumed → no pending left
        assert_eq!(pending, 0, "Purchase should be consumed by bench arrival");

        // The bench slot 4 should now be Known with champion identity
        assert_eq!(bench2[4].state, OwnedUnitState::Known);
        assert_eq!(bench2[4].champion_id.as_deref(), Some("champ0"));
        assert_eq!(bench2[4].champion_name.as_deref(), Some("Champ0"));
        assert_eq!(bench2[4].identity_source.as_deref(), Some("shop-purchase"));
        assert!(bench2[4].track_id.is_some());

        // Known-owned ledger should have champ0
        assert_eq!(known_owned.len(), 1);
        assert_eq!(known_owned[0].champion_id, "champ0");
        assert_eq!(known_owned[0].known_track_count, 1);
        assert!((coverage - 1.0).abs() < 0.01, "Coverage should be 1.0 with 1 known / 1 occupied");
    }

    // --- C5 tests ---

    #[test]
    fn test_c5_18_single_bench_to_board_movement() {
        // Unit moves from bench slot 2 → board hex 10
        let mut tracker = EntityTracker::new();

        // Frame 1: bench slot 2 occupied with a known track
        let (mut bench1, mut bench_sigs1) = make_empty_bench();
        bench1[2].occupancy = OccupancyState::Occupied;
        bench1[2].occupied = true;
        bench_sigs1[2] = Some(make_sig(99));
        let (mut board1, board_sigs1) = make_empty_board();

        // Inject a pre-existing Known track at bench 2 (simulating prior purchase fusion)
        tracker.next_track_counter += 1;
        let tid = format!("track-{}", tracker.next_track_counter);
        tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
            track_id: tid.clone(),
            champion_id: Some("reksai".to_string()),
            champion_name: Some("Rek'Sai".to_string()),
            location: Some(LocationRef::Bench(2)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.92,
            star_level: Some(1),
            star_confidence: Some(1.0),
            appearance_signature: Some(make_sig(99)),
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });

        // Confirm the track exists at bench 2
        tracker.update(1, &mut bench1, &mut board1, &bench_sigs1, &board_sigs1, None);

        // Frame 2: bench slot 2 empty, board hex 10 occupied → movement
        let (mut bench2, bench_sigs2) = make_empty_bench();
        let (mut board2, mut board_sigs2) = make_empty_board();
        board2[10].occupancy = OccupancyState::Occupied;
        board2[10].occupied = true;
        board_sigs2[10] = Some(make_sig(99)); // same signature

        tracker.update(2, &mut bench2, &mut board2, &bench_sigs2, &board_sigs2, None);

        // Board hex 10 should have the track with Rek'Sai identity preserved
        assert_eq!(board2[10].state, OwnedUnitState::Known);
        assert_eq!(board2[10].champion_name.as_deref(), Some("Rek'Sai"));
        assert_eq!(board2[10].identity_source.as_deref(), Some("tracked-move"));
        // Bench slot 2 should be empty
        assert_eq!(bench2[2].state, OwnedUnitState::Empty);
    }

    #[test]
    fn test_c5_19_movement_takes_precedence_over_purchase() {
        // When both a departure and an arrival happen, movement resolution
        // must occur before purchase fusion
        let mut tracker = EntityTracker::new();

        // Inject a tracked unit at bench slot 5
        tracker.next_track_counter += 1;
        let tid = format!("track-{}", tracker.next_track_counter);
        tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
            track_id: tid.clone(),
            champion_id: Some("jinx".to_string()),
            champion_name: Some("Jinx".to_string()),
            location: Some(LocationRef::Bench(5)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.9,
            star_level: Some(1),
            star_confidence: Some(1.0),
            appearance_signature: Some(make_sig(77)),
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });

        // Also inject a pending purchase for "Vi"
        tracker.pending_purchases.push(PurchaseCandidate {
            event_id: "purchase-vi".to_string(),
            champion_id: "vi".to_string(),
            champion_name: "Vi".to_string(),
            shop_slot: 0,
            source_frame_generation: 0,
            detected_frame_generation: 0,
            confidence: 0.9,
            expires_at_generation: 10,
        });

        // Frame: bench 5 departs, bench 3 arrives → movement, NOT purchase consumption
        let (mut bench, mut bench_sigs) = make_empty_bench();
        bench[3].occupancy = OccupancyState::Occupied;
        bench[3].occupied = true;
        bench_sigs[3] = Some(make_sig(77)); // same as Jinx's signature
        // bench 5 stays empty (Jinx departed)

        let (mut board, board_sigs) = make_empty_board();
        tracker.update(2, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        // Bench 3 should have Jinx (tracked-move), NOT Vi (purchase)
        assert_eq!(bench[3].champion_name.as_deref(), Some("Jinx"));
        assert_eq!(bench[3].identity_source.as_deref(), Some("tracked-move"));
        // Vi purchase should still be pending (unconsumed)
        assert_eq!(tracker.pending_purchases.len(), 1);
        assert_eq!(tracker.pending_purchases[0].champion_id, "vi");
    }

    #[test]
    fn test_c5_20_board_to_board_movement() {
        // Unit moves from board hex 3 → board hex 17
        let mut tracker = EntityTracker::new();

        tracker.next_track_counter += 1;
        let tid = format!("track-{}", tracker.next_track_counter);
        tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
            track_id: tid.clone(),
            champion_id: Some("zed".to_string()),
            champion_name: Some("Zed".to_string()),
            location: Some(LocationRef::Board(3)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.9,
            star_level: Some(1),
            star_confidence: Some(1.0),
            appearance_signature: Some(make_sig(55)),
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });

        // Frame: board hex 3 empty, board hex 17 occupied
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, mut board_sigs) = make_empty_board();
        board[17].occupancy = OccupancyState::Occupied;
        board[17].occupied = true;
        board_sigs[17] = Some(make_sig(55));

        tracker.update(2, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        assert_eq!(board[17].champion_name.as_deref(), Some("Zed"));
        assert_eq!(board[17].identity_source.as_deref(), Some("tracked-move"));
        assert_eq!(board[3].state, OwnedUnitState::Empty);
    }

    #[test]
    fn test_c5_21_ambiguity_group_on_unpaired_multi_move() {
        // 2 departures + 2 arrivals with identical signatures → cannot pair → AmbiguityGroup
        let mut tracker = EntityTracker::new();

        // Two units with identical appearance
        let same_sig = make_sig(100);
        for slot in [2, 5] {
            tracker.next_track_counter += 1;
            let tid = format!("track-{}", tracker.next_track_counter);
            tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
                track_id: tid.clone(),
                champion_id: Some(format!("unit{}", slot)),
                champion_name: Some(format!("Unit{}", slot)),
                location: Some(LocationRef::Bench(slot)),
                state: OwnedUnitState::Known,
                identity_source: "shop-purchase".to_string(),
                identity_confidence: 0.9,
                star_level: Some(1),
                star_confidence: Some(1.0),
                appearance_signature: Some(same_sig.clone()),
                created_generation: 0,
                last_seen_generation: 0,
                departed_generation: None,
            });
        }

        // Frame: both bench 2 and 5 depart, board 0 and 7 arrive (identical sigs → ambiguous)
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, mut board_sigs) = make_empty_board();
        board[0].occupancy = OccupancyState::Occupied;
        board[0].occupied = true;
        board_sigs[0] = Some(same_sig.clone());
        board[7].occupancy = OccupancyState::Occupied;
        board[7].occupied = true;
        board_sigs[7] = Some(same_sig.clone());

        tracker.update(2, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        // Should have an ambiguity group
        assert!(!tracker.ambiguity_groups.is_empty(), "Identical sigs must produce AmbiguityGroup");
        let grp = &tracker.ambiguity_groups[0];
        assert_eq!(grp.possible_locations.len(), 2);
        assert_eq!(grp.track_ids.len(), 2);
    }

    #[test]
    fn test_c5_22_paired_multi_move_with_distinct_signatures() {
        // 2 departures + 2 arrivals with distinct signatures → matched pair
        let mut tracker = EntityTracker::new();

        let sig_a = make_sig(10);
        let sig_b = make_sig(200);

        tracker.next_track_counter += 1;
        let tid_a = format!("track-{}", tracker.next_track_counter);
        tracker.tracks.insert(tid_a.clone(), OwnedUnitTrack {
            track_id: tid_a.clone(),
            champion_id: Some("ahri".to_string()),
            champion_name: Some("Ahri".to_string()),
            location: Some(LocationRef::Bench(0)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.9,
            star_level: Some(1),
            star_confidence: Some(1.0),
            appearance_signature: Some(sig_a.clone()),
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });

        tracker.next_track_counter += 1;
        let tid_b = format!("track-{}", tracker.next_track_counter);
        tracker.tracks.insert(tid_b.clone(), OwnedUnitTrack {
            track_id: tid_b.clone(),
            champion_id: Some("brand".to_string()),
            champion_name: Some("Brand".to_string()),
            location: Some(LocationRef::Bench(1)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.9,
            star_level: Some(1),
            star_confidence: Some(1.0),
            appearance_signature: Some(sig_b.clone()),
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });

        // Frame: both bench 0 and 1 depart, board 14 gets sig_a, board 21 gets sig_b
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, mut board_sigs) = make_empty_board();
        board[14].occupancy = OccupancyState::Occupied;
        board[14].occupied = true;
        board_sigs[14] = Some(sig_a.clone());
        board[21].occupancy = OccupancyState::Occupied;
        board[21].occupied = true;
        board_sigs[21] = Some(sig_b.clone());

        tracker.update(2, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        // Should be paired, no ambiguity
        assert!(tracker.ambiguity_groups.is_empty(), "Distinct sigs should pair without ambiguity");
        assert_eq!(board[14].champion_name.as_deref(), Some("Ahri"));
        assert_eq!(board[21].champion_name.as_deref(), Some("Brand"));
    }

    #[test]
    fn test_c5_23_mid_game_start_board_units_are_unknown() {
        // Units appearing on board without any prior shop history → Unknown
        let mut tracker = EntityTracker::new();

        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, mut board_sigs) = make_empty_board();

        // 3 board hexes occupied from the start with no prior state
        for h in [5, 12, 20] {
            board[h].occupancy = OccupancyState::Occupied;
            board[h].occupied = true;
            board_sigs[h] = Some(make_sig(h as u8));
        }

        let (_known, coverage, _pending, _ambig) = tracker.update(1, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        for h in [5, 12, 20] {
            assert_eq!(board[h].state, OwnedUnitState::Unknown, "Mid-game board unit h={} must be Unknown", h);
            assert!(board[h].champion_id.is_none(), "No identity for mid-game unit");
            assert_eq!(board[h].identity_source.as_deref(), Some("initial-unknown"));
        }
        assert!((coverage - 0.0).abs() < 0.01, "Coverage should be 0% with 3 unknown / 3 occupied");
    }

    #[test]
    fn test_c5_24_auto_combine_3x_1star_to_2star() {
        // 2 existing 1-star tracks + purchase of same champion → auto-combine to 2-star
        let mut tracker = EntityTracker::new();

        // Two existing 1-star Jinx tracks on bench
        for slot in [0, 1] {
            tracker.next_track_counter += 1;
            let tid = format!("track-{}", tracker.next_track_counter);
            tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
                track_id: tid.clone(),
                champion_id: Some("jinx".to_string()),
                champion_name: Some("Jinx".to_string()),
                location: Some(LocationRef::Bench(slot)),
                state: OwnedUnitState::Known,
                identity_source: "shop-purchase".to_string(),
                identity_confidence: 0.9,
                star_level: Some(1),
                star_confidence: Some(1.0),
                appearance_signature: Some(make_sig(slot as u8 + 30)),
                created_generation: 0,
                last_seen_generation: 0,
                departed_generation: None,
            });
        }

        // One of them "departs" (will be consumed in combine)
        if let Some(t) = tracker.tracks.get_mut("track-1") {
            t.departed_generation = Some(1);
        }

        // Add a pending purchase for Jinx
        tracker.pending_purchases.push(PurchaseCandidate {
            event_id: "purchase-jinx-3".to_string(),
            champion_id: "jinx".to_string(),
            champion_name: "Jinx".to_string(),
            shop_slot: 0,
            source_frame_generation: 1,
            detected_frame_generation: 2,
            confidence: 0.9,
            expires_at_generation: 10,
        });

        let (mut bench, bench_sigs) = make_empty_bench();
        bench[1].occupancy = OccupancyState::Occupied;
        bench[1].occupied = true;
        let (mut board, board_sigs) = make_empty_board();

        tracker.update(2, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        // Should have a combine event
        assert_eq!(tracker.combine_events.len(), 1);
        assert_eq!(tracker.combine_events[0].champion_id, "jinx");
        assert_eq!(tracker.combine_events[0].resulting_star_level, Some(2));

        // Remaining track should be 2-star
        let remaining: Vec<_> = tracker.tracks.values()
            .filter(|t| t.champion_id.as_deref() == Some("jinx"))
            .collect();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].star_level, Some(2));
        assert_eq!(remaining[0].identity_source, "tracked-combine");
    }

    #[test]
    fn test_c5_25_sale_resolution_window_2_frames() {
        // A unit departing should persist for 2 frames before being pruned (sale resolution)
        let mut tracker = EntityTracker::new();

        tracker.next_track_counter += 1;
        let tid = "track-1".to_string();
        tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
            track_id: tid.clone(),
            champion_id: Some("lux".to_string()),
            champion_name: Some("Lux".to_string()),
            location: Some(LocationRef::Bench(3)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.9,
            star_level: Some(1),
            star_confidence: Some(1.0),
            appearance_signature: Some(make_sig(44)),
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });

        // Frame 5: bench 3 becomes empty → departure marked
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, board_sigs) = make_empty_board();
        tracker.update(5, &mut bench, &mut board, &bench_sigs, &board_sigs, None);
        assert!(tracker.tracks.contains_key(&tid), "Track should still exist after departure frame");

        // Frame 6: still departed
        let (mut bench6, bench_sigs6) = make_empty_bench();
        let (mut board6, board_sigs6) = make_empty_board();
        tracker.update(6, &mut bench6, &mut board6, &bench_sigs6, &board_sigs6, None);
        assert!(tracker.tracks.contains_key(&tid), "Track should survive 1 frame past departure");

        // Frame 7: past 2-frame window → pruned
        let (mut bench7, bench_sigs7) = make_empty_bench();
        let (mut board7, board_sigs7) = make_empty_board();
        tracker.update(7, &mut bench7, &mut board7, &bench_sigs7, &board_sigs7, None);
        assert!(!tracker.tracks.contains_key(&tid), "Track should be pruned after 2-frame resolution window");
    }

    #[test]
    fn test_c5_26_purchase_candidate_expires_after_4_frames() {
        // Purchase candidates expire after gen + 4
        let mut tracker = EntityTracker::new();

        tracker.pending_purchases.push(PurchaseCandidate {
            event_id: "pc-1".to_string(),
            champion_id: "test".to_string(),
            champion_name: "Test".to_string(),
            shop_slot: 0,
            source_frame_generation: 1,
            detected_frame_generation: 2,
            confidence: 0.9,
            expires_at_generation: 6, // gen 2 + 4
        });

        // Frames 3, 4, 5: still alive
        for gen in 3..=5 {
            let (mut bench, bench_sigs) = make_empty_bench();
            let (mut board, board_sigs) = make_empty_board();
            tracker.update(gen, &mut bench, &mut board, &bench_sigs, &board_sigs, None);
            assert_eq!(tracker.pending_purchases.len(), 1, "Purchase candidate should survive at gen={}", gen);
        }

        // Frame 6: expires
        let (mut bench, bench_sigs) = make_empty_bench();
        let (mut board, board_sigs) = make_empty_board();
        tracker.update(6, &mut bench, &mut board, &bench_sigs, &board_sigs, None);
        assert!(tracker.pending_purchases.is_empty(), "Purchase candidate should expire at gen=6");
    }

    #[test]
    fn test_c5_27_identity_coverage_calculation() {
        // Coverage = known / total_occupied
        let mut tracker = EntityTracker::new();

        // Set up 2 known tracks and 1 unknown
        for (slot, known) in [(0, true), (1, true), (2, false)] {
            tracker.next_track_counter += 1;
            let tid = format!("track-{}", tracker.next_track_counter);
            tracker.tracks.insert(tid.clone(), OwnedUnitTrack {
                track_id: tid.clone(),
                champion_id: if known { Some(format!("c{}", slot)) } else { None },
                champion_name: if known { Some(format!("C{}", slot)) } else { None },
                location: Some(LocationRef::Bench(slot)),
                state: if known { OwnedUnitState::Known } else { OwnedUnitState::Unknown },
                identity_source: if known { "shop-purchase".to_string() } else { "initial-unknown".to_string() },
                identity_confidence: if known { 0.9 } else { 0.0 },
                star_level: if known { Some(1) } else { None },
                star_confidence: None,
                appearance_signature: Some(make_sig(slot as u8)),
                created_generation: 0,
                last_seen_generation: 0,
                departed_generation: None,
            });
        }

        let (mut bench, mut bench_sigs) = make_empty_bench();
        for slot in 0..3 {
            bench[slot].occupancy = OccupancyState::Occupied;
            bench[slot].occupied = true;
            bench_sigs[slot] = Some(make_sig(slot as u8));
        }
        let (mut board, board_sigs) = make_empty_board();

        let (known_owned, coverage, _pending, _ambig) = tracker.update(1, &mut bench, &mut board, &bench_sigs, &board_sigs, None);

        // 2 known out of 3 occupied
        assert!((coverage - 2.0/3.0).abs() < 0.02, "Coverage should be ~66.7%, got {}", coverage);
        assert_eq!(known_owned.len(), 2, "Should have 2 known-owned entries");
    }

    #[test]
    fn test_c5_28_reset_clears_all_tracker_state() {
        let mut tracker = EntityTracker::new();

        tracker.next_track_counter = 5;
        tracker.tracks.insert("t1".to_string(), OwnedUnitTrack {
            track_id: "t1".to_string(),
            champion_id: Some("x".to_string()),
            champion_name: Some("X".to_string()),
            location: Some(LocationRef::Bench(0)),
            state: OwnedUnitState::Known,
            identity_source: "shop-purchase".to_string(),
            identity_confidence: 0.9,
            star_level: Some(1),
            star_confidence: None,
            appearance_signature: None,
            created_generation: 0,
            last_seen_generation: 0,
            departed_generation: None,
        });
        tracker.pending_purchases.push(PurchaseCandidate {
            event_id: "x".to_string(),
            champion_id: "x".to_string(),
            champion_name: "X".to_string(),
            shop_slot: 0,
            source_frame_generation: 0,
            detected_frame_generation: 0,
            confidence: 0.0,
            expires_at_generation: 99,
        });
        tracker.ambiguity_groups.push(AmbiguityGroup {
            group_id: "g1".to_string(),
            track_ids: vec!["t1".to_string()],
            possible_locations: vec![LocationRef::Bench(0)],
            created_generation: 0,
        });

        tracker.reset();

        assert!(tracker.tracks.is_empty());
        assert!(tracker.pending_purchases.is_empty());
        assert!(tracker.ambiguity_groups.is_empty());
        assert!(tracker.combine_events.is_empty());
        assert!(tracker.last_shop_slots.is_none());
    }
}
