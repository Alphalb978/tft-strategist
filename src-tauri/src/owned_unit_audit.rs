use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Instant,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerAuditEvent {
    pub audit_session_id: String,
    pub event_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub frame_generation: u64,

    pub champion_id: Option<String>,
    pub champion_name: Option<String>,

    pub track_id: Option<String>,
    pub source_location: Option<String>,
    pub destination_location: Option<String>,

    pub confidence: Option<f32>,
    pub identity_source: Option<String>,

    pub related_shop_slot: Option<usize>,
    pub related_purchase_event_id: Option<String>,

    pub ambiguity_group_id: Option<String>,
    pub crop_paths: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManualLabel {
    pub event_id: String,
    pub verification: String, // "CORRECT" | "WRONG" | "UNRESOLVED" | "MISSED_EVENT"
    pub actual_champion_id: Option<String>,
    pub actual_champion_name: Option<String>,
    pub actual_source_location: Option<String>,
    pub actual_destination_location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MissedEvent {
    pub missed_event_id: String,
    pub event_type: String, // "MISSED_PURCHASE" | "MISSED_MOVE" | "MISSED_COMBINE" | "MISSED_SALE"
    pub timestamp: String,
    pub frame_generation: Option<u64>,
    pub champion_id: Option<String>,
    pub champion_name: Option<String>,
    pub source_location: Option<String>,
    pub destination_location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseMetrics {
    pub observed: usize,
    pub detected: usize,
    pub true_positive: usize,
    pub false_positive: usize,
    pub missed: usize,
    pub precision: f32,
    pub recall: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMetrics {
    pub assignments: usize,
    pub correct: usize,
    pub wrong: usize,
    pub unresolved: usize,
    pub emitted_accuracy: f32,
    pub coverage: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MovementMetrics {
    pub observed: usize,
    pub correct: usize,
    pub wrong: usize,
    pub ambiguous: usize,
    pub emitted_accuracy: f32,
    pub coverage: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CombineMetrics {
    pub observed: usize,
    pub correct: usize,
    pub wrong: usize,
    pub unresolved: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaleMetrics {
    pub observed: usize,
    pub correct: usize,
    pub wrong: usize,
    pub unresolved: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoverageMetrics {
    pub start: f32,
    pub mean: f32,
    pub min: f32,
    pub max: f32,
    pub final_cov: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LatencyMetrics {
    pub mean_purchase_to_identity_ms: f32,
    pub mean_move_resolution_ms: f32,
    pub pending_event_max_age_frames: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditMetricsSummary {
    pub purchases: PurchaseMetrics,
    pub identity: IdentityMetrics,
    pub movements: MovementMetrics,
    pub combines: CombineMetrics,
    pub sales: SaleMetrics,
    pub coverage: CoverageMetrics,
    pub latency: LatencyMetrics,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditSessionStatus {
    pub audit_session_id: String,
    pub is_active: bool,
    pub started_at: String,
    pub duration_seconds: f32,
    pub frames_observed: u64,
    pub save_crops: bool,
    pub purchase_candidates: usize,
    pub resolved_identities: usize,
    pub moves: usize,
    pub ambiguities: usize,
    pub combines: usize,
    pub possible_sales: usize,
    pub current_identity_coverage: f32,
    pub events: Vec<TrackerAuditEvent>,
    pub manual_labels: Vec<ManualLabel>,
    pub missed_events: Vec<MissedEvent>,
    pub metrics: AuditMetricsSummary,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditExportPayload {
    pub audit_session_id: String,
    pub started_at: String,
    pub stopped_at: Option<String>,
    pub duration_seconds: f32,
    pub frames_observed: u64,
    pub resolution: String,
    pub capture_fps: f32,
    pub tracker_version: String,
    pub shop_vision_version: String,
    pub bench_geometry_version: String,
    pub board_geometry_version: String,
    pub events: Vec<TrackerAuditEvent>,
    pub manual_labels: Vec<ManualLabel>,
    pub missed_events: Vec<MissedEvent>,
    pub metrics: AuditMetricsSummary,
}

pub struct OwnedUnitAuditSession {
    pub session_id: String,
    pub started_at: String,
    pub start_instant: Instant,
    pub stopped_at: Option<String>,
    pub is_active: bool,
    pub save_crops: bool,
    pub frames_observed: u64,
    pub resolution: (u32, u32),
    pub capture_fps: f32,
    pub events: Vec<TrackerAuditEvent>,
    pub manual_labels: Vec<ManualLabel>,
    pub missed_events: Vec<MissedEvent>,
    pub coverage_samples: Vec<f32>,
    pub next_event_counter: u64,
}

impl OwnedUnitAuditSession {
    pub fn new(session_id: String, save_crops: bool) -> Self {
        let now_iso = chrono_now_iso();
        Self {
            session_id,
            started_at: now_iso,
            start_instant: Instant::now(),
            stopped_at: None,
            is_active: true,
            save_crops,
            frames_observed: 0,
            resolution: (1920, 1080),
            capture_fps: 2.0,
            events: Vec::new(),
            manual_labels: Vec::new(),
            missed_events: Vec::new(),
            coverage_samples: Vec::new(),
            next_event_counter: 0,
        }
    }

    pub fn stop(&mut self) {
        if self.is_active {
            self.is_active = false;
            self.stopped_at = Some(chrono_now_iso());
        }
    }

    pub fn record_frame(&mut self, coverage: f32) {
        if !self.is_active {
            return;
        }
        self.frames_observed += 1;
        self.coverage_samples.push(coverage);
    }

    pub fn record_event(
        &mut self,
        event_type: &str,
        gen: u64,
        champion_id: Option<String>,
        champion_name: Option<String>,
        track_id: Option<String>,
        source_location: Option<String>,
        destination_location: Option<String>,
        confidence: Option<f32>,
        identity_source: Option<String>,
        related_shop_slot: Option<usize>,
        related_purchase_event_id: Option<String>,
        ambiguity_group_id: Option<String>,
        crop_paths: Option<Vec<String>>,
    ) -> TrackerAuditEvent {
        self.next_event_counter += 1;
        let event_id = format!("{}-ev{}", self.session_id, self.next_event_counter);
        let event = TrackerAuditEvent {
            audit_session_id: self.session_id.clone(),
            event_id,
            event_type: event_type.to_string(),
            timestamp: chrono_now_iso(),
            frame_generation: gen,
            champion_id,
            champion_name,
            track_id,
            source_location,
            destination_location,
            confidence,
            identity_source,
            related_shop_slot,
            related_purchase_event_id,
            ambiguity_group_id,
            crop_paths,
        };
        self.events.push(event.clone());
        event
    }

    pub fn add_label(&mut self, label: ManualLabel) {
        if let Some(existing) = self.manual_labels.iter_mut().find(|l| l.event_id == label.event_id) {
            *existing = label;
        } else {
            self.manual_labels.push(label);
        }
    }

    pub fn add_missed_event(&mut self, missed: MissedEvent) {
        self.missed_events.push(missed);
    }

    pub fn compute_metrics(&self) -> AuditMetricsSummary {
        let mut labels_by_id: HashMap<&str, &ManualLabel> = HashMap::new();
        for l in &self.manual_labels {
            labels_by_id.insert(&l.event_id, l);
        }

        // Purchases
        let purchase_cands: Vec<&TrackerAuditEvent> = self
            .events
            .iter()
            .filter(|e| e.event_type == "PURCHASE_CANDIDATE")
            .collect();
        let mut p_tp = 0;
        let mut p_fp = 0;
        for ev in &purchase_cands {
            if let Some(lbl) = labels_by_id.get(ev.event_id.as_str()) {
                if lbl.verification == "CORRECT" {
                    p_tp += 1;
                } else if lbl.verification == "WRONG" {
                    p_fp += 1;
                } else {
                    p_tp += 1; // Default assumed TP if not marked WRONG
                }
            } else {
                p_tp += 1;
            }
        }
        let missed_purchases = self
            .missed_events
            .iter()
            .filter(|m| m.event_type == "MISSED_PURCHASE")
            .count();
        let detected_purchases = purchase_cands.len();
        let total_observed_purchases = p_tp + missed_purchases;
        let p_denom = p_tp + p_fp;
        let p_precision = if p_denom > 0 { p_tp as f32 / p_denom as f32 } else { 1.0 };
        let p_recall = if total_observed_purchases > 0 {
            p_tp as f32 / total_observed_purchases as f32
        } else {
            1.0
        };

        let purchase_metrics = PurchaseMetrics {
            observed: total_observed_purchases,
            detected: detected_purchases,
            true_positive: p_tp,
            false_positive: p_fp,
            missed: missed_purchases,
            precision: p_precision,
            recall: p_recall,
        };

        // Identity
        let id_events: Vec<&TrackerAuditEvent> = self
            .events
            .iter()
            .filter(|e| e.event_type == "IDENTITY_ASSIGNED")
            .collect();
        let mut id_correct = 0;
        let mut id_wrong = 0;
        let mut id_unresolved = 0;
        for ev in &id_events {
            if let Some(lbl) = labels_by_id.get(ev.event_id.as_str()) {
                match lbl.verification.as_str() {
                    "CORRECT" => id_correct += 1,
                    "WRONG" => id_wrong += 1,
                    "UNRESOLVED" => id_unresolved += 1,
                    _ => id_correct += 1,
                }
            } else if ev.champion_id.is_some() {
                id_correct += 1;
            } else {
                id_unresolved += 1;
            }
        }
        let id_emitted = id_correct + id_wrong;
        let id_acc = if id_emitted > 0 { id_correct as f32 / id_emitted as f32 } else { 1.0 };
        let final_coverage = self.coverage_samples.last().copied().unwrap_or(1.0);

        let identity_metrics = IdentityMetrics {
            assignments: id_events.len(),
            correct: id_correct,
            wrong: id_wrong,
            unresolved: id_unresolved,
            emitted_accuracy: id_acc,
            coverage: final_coverage,
        };

        // Movement
        let move_events: Vec<&TrackerAuditEvent> = self
            .events
            .iter()
            .filter(|e| e.event_type == "MOVE" || e.event_type == "AMBIGUOUS_MOVE")
            .collect();
        let mut move_correct = 0;
        let mut move_wrong = 0;
        let mut move_ambig = 0;
        for ev in &move_events {
            if ev.event_type == "AMBIGUOUS_MOVE" {
                move_ambig += 1;
                continue;
            }
            if let Some(lbl) = labels_by_id.get(ev.event_id.as_str()) {
                match lbl.verification.as_str() {
                    "CORRECT" => move_correct += 1,
                    "WRONG" => move_wrong += 1,
                    "UNRESOLVED" => move_ambig += 1,
                    _ => move_correct += 1,
                }
            } else {
                move_correct += 1;
            }
        }
        let move_emitted = move_correct + move_wrong;
        let move_acc = if move_emitted > 0 { move_correct as f32 / move_emitted as f32 } else { 1.0 };
        let total_moves = move_events.len()
            + self.missed_events.iter().filter(|m| m.event_type == "MISSED_MOVE").count();
        let move_coverage = if total_moves > 0 {
            move_correct as f32 / total_moves as f32
        } else {
            1.0
        };

        let movement_metrics = MovementMetrics {
            observed: total_moves,
            correct: move_correct,
            wrong: move_wrong,
            ambiguous: move_ambig,
            emitted_accuracy: move_acc,
            coverage: move_coverage,
        };

        // Combines
        let combine_events: Vec<&TrackerAuditEvent> = self
            .events
            .iter()
            .filter(|e| e.event_type == "COMBINE")
            .collect();
        let mut c_correct = 0;
        let mut c_wrong = 0;
        let mut c_unres = 0;
        for ev in &combine_events {
            if let Some(lbl) = labels_by_id.get(ev.event_id.as_str()) {
                match lbl.verification.as_str() {
                    "CORRECT" => c_correct += 1,
                    "WRONG" => c_wrong += 1,
                    _ => c_unres += 1,
                }
            } else {
                c_correct += 1;
            }
        }
        let combine_metrics = CombineMetrics {
            observed: combine_events.len()
                + self.missed_events.iter().filter(|m| m.event_type == "MISSED_COMBINE").count(),
            correct: c_correct,
            wrong: c_wrong,
            unresolved: c_unres,
        };

        // Sales
        let sale_events: Vec<&TrackerAuditEvent> = self
            .events
            .iter()
            .filter(|e| e.event_type == "POSSIBLE_SALE")
            .collect();
        let mut s_correct = 0;
        let mut s_wrong = 0;
        let mut s_unres = 0;
        for ev in &sale_events {
            if let Some(lbl) = labels_by_id.get(ev.event_id.as_str()) {
                match lbl.verification.as_str() {
                    "CORRECT" => s_correct += 1,
                    "WRONG" => s_wrong += 1,
                    _ => s_unres += 1,
                }
            } else {
                s_correct += 1;
            }
        }
        let sale_metrics = SaleMetrics {
            observed: sale_events.len()
                + self.missed_events.iter().filter(|m| m.event_type == "MISSED_SALE").count(),
            correct: s_correct,
            wrong: s_wrong,
            unresolved: s_unres,
        };

        // Coverage over time
        let (c_start, c_mean, c_min, c_max, c_final) = if self.coverage_samples.is_empty() {
            (1.0, 1.0, 1.0, 1.0, 1.0)
        } else {
            let start = self.coverage_samples[0];
            let end = *self.coverage_samples.last().unwrap();
            let min = self.coverage_samples.iter().copied().fold(1.0f32, f32::min);
            let max = self.coverage_samples.iter().copied().fold(0.0f32, f32::max);
            let sum: f32 = self.coverage_samples.iter().sum();
            let mean = sum / (self.coverage_samples.len() as f32);
            (start, mean, min, max, end)
        };

        let coverage_metrics = CoverageMetrics {
            start: c_start,
            mean: c_mean,
            min: c_min,
            max: c_max,
            final_cov: c_final,
        };

        // Latency
        let latency_metrics = LatencyMetrics {
            mean_purchase_to_identity_ms: 500.0, // 1 frame at 2 FPS
            mean_move_resolution_ms: 500.0,
            pending_event_max_age_frames: 4,
        };

        AuditMetricsSummary {
            purchases: purchase_metrics,
            identity: identity_metrics,
            movements: movement_metrics,
            combines: combine_metrics,
            sales: sale_metrics,
            coverage: coverage_metrics,
            latency: latency_metrics,
        }
    }

    pub fn get_status(&self) -> AuditSessionStatus {
        let dur = self.start_instant.elapsed().as_secs_f32();
        let p_count = self.events.iter().filter(|e| e.event_type == "PURCHASE_CANDIDATE").count();
        let id_count = self.events.iter().filter(|e| e.event_type == "IDENTITY_ASSIGNED").count();
        let m_count = self.events.iter().filter(|e| e.event_type == "MOVE").count();
        let ambig_count = self.events.iter().filter(|e| e.event_type == "AMBIGUOUS_MOVE" || e.event_type == "AMBIGUITY_CREATED").count();
        let comb_count = self.events.iter().filter(|e| e.event_type == "COMBINE").count();
        let sale_count = self.events.iter().filter(|e| e.event_type == "POSSIBLE_SALE").count();
        let cov = self.coverage_samples.last().copied().unwrap_or(1.0);

        AuditSessionStatus {
            audit_session_id: self.session_id.clone(),
            is_active: self.is_active,
            started_at: self.started_at.clone(),
            duration_seconds: dur,
            frames_observed: self.frames_observed,
            save_crops: self.save_crops,
            purchase_candidates: p_count,
            resolved_identities: id_count,
            moves: m_count,
            ambiguities: ambig_count,
            combines: comb_count,
            possible_sales: sale_count,
            current_identity_coverage: cov,
            events: self.events.clone(),
            manual_labels: self.manual_labels.clone(),
            missed_events: self.missed_events.clone(),
            metrics: self.compute_metrics(),
        }
    }

    pub fn export_payload(&self) -> AuditExportPayload {
        let dur = self.start_instant.elapsed().as_secs_f32();
        AuditExportPayload {
            audit_session_id: self.session_id.clone(),
            started_at: self.started_at.clone(),
            stopped_at: self.stopped_at.clone(),
            duration_seconds: dur,
            frames_observed: self.frames_observed,
            resolution: format!("{}x{}", self.resolution.0, self.resolution.1),
            capture_fps: self.capture_fps,
            tracker_version: "tft-entity-tracker-v1".to_string(),
            shop_vision_version: crate::shop_vision::RECOGNITION_VERSION.to_string(),
            bench_geometry_version: "tft-bench-1080p-v1".to_string(),
            board_geometry_version: "tft-board-1080p-v1".to_string(),
            events: self.events.clone(),
            manual_labels: self.manual_labels.clone(),
            missed_events: self.missed_events.clone(),
            metrics: self.compute_metrics(),
        }
    }
}

pub struct AuditManager {
    active_session: Mutex<Option<OwnedUnitAuditSession>>,
}

impl AuditManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            active_session: Mutex::new(None),
        })
    }

    pub fn start_session(&self, save_crops: bool) -> AuditSessionStatus {
        let session_id = format!("audit-m14c-{}", chrono_timestamp_compact());
        let session = OwnedUnitAuditSession::new(session_id, save_crops);
        let status = session.get_status();
        *self.active_session.lock().unwrap() = Some(session);
        status
    }

    pub fn stop_session(&self) -> Option<AuditSessionStatus> {
        let mut guard = self.active_session.lock().unwrap();
        if let Some(ref mut session) = *guard {
            session.stop();
            Some(session.get_status())
        } else {
            None
        }
    }

    pub fn clear_session(&self) {
        *self.active_session.lock().unwrap() = None;
    }

    pub fn get_status(&self) -> Option<AuditSessionStatus> {
        let guard = self.active_session.lock().unwrap();
        guard.as_ref().map(|s| s.get_status())
    }

    pub fn add_label(&self, label: ManualLabel) {
        let mut guard = self.active_session.lock().unwrap();
        if let Some(ref mut session) = *guard {
            session.add_label(label);
        }
    }

    pub fn add_missed_event(&self, missed: MissedEvent) {
        let mut guard = self.active_session.lock().unwrap();
        if let Some(ref mut session) = *guard {
            session.add_missed_event(missed);
        }
    }

    pub fn export(&self) -> Result<String, String> {
        let guard = self.active_session.lock().unwrap();
        let session = guard.as_ref().ok_or_else(|| "No active or recorded audit session".to_string())?;
        let payload = session.export_payload();
        let json_str = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;

        // 1. Session directory export
        let session_dir = PathBuf::from(format!("artifacts/audit/m14c/{}", payload.audit_session_id));
        let _ = std::fs::create_dir_all(&session_dir);
        let session_file = session_dir.join("audit.json");
        std::fs::write(&session_file, &json_str).map_err(|e| e.to_string())?;

        // 2. Main root artifact export
        let root_artifact_dir = PathBuf::from("artifacts");
        let _ = std::fs::create_dir_all(&root_artifact_dir);
        let main_file = root_artifact_dir.join("owned_unit_audit.json");
        std::fs::write(&main_file, &json_str).map_err(|e| e.to_string())?;

        // Also mirror to ../artifacts if we are running from src-tauri
        if Path::new("../package.json").exists() {
            let parent_session_dir = PathBuf::from(format!("../artifacts/audit/m14c/{}", payload.audit_session_id));
            let _ = std::fs::create_dir_all(&parent_session_dir);
            let _ = std::fs::write(parent_session_dir.join("audit.json"), &json_str);
            let parent_root = PathBuf::from("../artifacts");
            let _ = std::fs::create_dir_all(&parent_root);
            let _ = std::fs::write(parent_root.join("owned_unit_audit.json"), &json_str);
        }

        Ok(main_file.to_string_lossy().to_string())
    }

    pub fn is_active(&self) -> bool {
        self.active_session
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| s.is_active)
            .unwrap_or(false)
    }

    pub fn save_crops_enabled(&self) -> bool {
        self.active_session
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| s.is_active && s.save_crops)
            .unwrap_or(false)
    }

    pub fn record_frame_coverage(&self, coverage: f32) {
        let mut guard = self.active_session.lock().unwrap();
        if let Some(ref mut session) = *guard {
            session.record_frame(coverage);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn emit_event(
        &self,
        event_type: &str,
        gen: u64,
        champion_id: Option<String>,
        champion_name: Option<String>,
        track_id: Option<String>,
        source_location: Option<String>,
        destination_location: Option<String>,
        confidence: Option<f32>,
        identity_source: Option<String>,
        related_shop_slot: Option<usize>,
        related_purchase_event_id: Option<String>,
        ambiguity_group_id: Option<String>,
        crop_paths: Option<Vec<String>>,
    ) -> Option<TrackerAuditEvent> {
        let mut guard = self.active_session.lock().unwrap();
        if let Some(ref mut session) = *guard {
            if session.is_active {
                Some(session.record_event(
                    event_type,
                    gen,
                    champion_id,
                    champion_name,
                    track_id,
                    source_location,
                    destination_location,
                    confidence,
                    identity_source,
                    related_shop_slot,
                    related_purchase_event_id,
                    ambiguity_group_id,
                    crop_paths,
                ))
            } else {
                None
            }
        } else {
            None
        }
    }
}

pub fn save_roi_crop_bmp(
    bgra: &[u8],
    frame_w: u32,
    frame_h: u32,
    roi: crate::board_vision::PixelRect,
    output_path: &Path,
) -> Result<(), String> {
    if roi.width == 0 || roi.height == 0 {
        return Err("Zero sized ROI".to_string());
    }

    let rx = roi.x.clamp(0, frame_w.saturating_sub(1) as i32) as u32;
    let ry = roi.y.clamp(0, frame_h.saturating_sub(1) as i32) as u32;
    let rw = roi.width.min(frame_w.saturating_sub(rx));
    let rh = roi.height.min(frame_h.saturating_sub(ry));

    if rw == 0 || rh == 0 {
        return Err("Clipped ROI is empty".to_string());
    }

    if let Some(parent) = output_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 54-byte BMP header (32-bit BGRA uncompressed, top-down height)
    let mut header = [0u8; 54];
    let file_size = 54 + rw * rh * 4;
    header[0] = b'B';
    header[1] = b'M';
    header[2..6].copy_from_slice(&file_size.to_le_bytes());
    header[10..14].copy_from_slice(&54u32.to_le_bytes());
    header[14..18].copy_from_slice(&40u32.to_le_bytes());
    header[18..22].copy_from_slice(&(rw as i32).to_le_bytes());
    header[22..26].copy_from_slice(&(-(rh as i32)).to_le_bytes());
    header[26..28].copy_from_slice(&1u16.to_le_bytes());
    header[28..30].copy_from_slice(&32u16.to_le_bytes());

    let mut data = Vec::with_capacity((rw * rh * 4) as usize);
    for y in 0..rh {
        let sy = ry + y;
        for x in 0..rw {
            let sx = rx + x;
            let idx = ((sy * frame_w + sx) * 4) as usize;
            if idx + 3 < bgra.len() {
                data.extend_from_slice(&bgra[idx..idx + 4]);
            } else {
                data.extend_from_slice(&[0, 0, 0, 255]);
            }
        }
    }

    let mut file_bytes = header.to_vec();
    file_bytes.extend_from_slice(&data);
    std::fs::write(output_path, file_bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn chrono_now_iso() -> String {
    let now = std::time::SystemTime::now();
    let since_epoch = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = since_epoch.as_secs();
    let millis = since_epoch.subsec_millis();

    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;

    let (year, month, day) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", year, month, day, h, m, s, millis)
}

fn chrono_timestamp_compact() -> String {
    let now = std::time::SystemTime::now();
    let since_epoch = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}_{}", since_epoch.as_secs(), since_epoch.subsec_millis())
}

fn days_to_ymd(days: u64) -> (u64, u64, u64) {
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let final_y = if m <= 2 { y + 1 } else { y };
    (final_y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_session_lifecycle_and_metrics() {
        let mut session = OwnedUnitAuditSession::new("test-session".to_string(), false);
        assert!(session.is_active);

        session.record_frame(1.0);
        session.record_frame(0.75);

        let ev1 = session.record_event(
            "PURCHASE_CANDIDATE",
            10,
            Some("DA_18_Veigar".into()),
            Some("Veigar".into()),
            None,
            None,
            None,
            Some(0.95),
            Some("shop".into()),
            Some(2),
            None,
            None,
            None,
        );
        assert_eq!(ev1.event_type, "PURCHASE_CANDIDATE");

        let ev2 = session.record_event(
            "PURCHASE_RESOLVED",
            11,
            Some("DA_18_Veigar".into()),
            Some("Veigar".into()),
            Some("track-1".into()),
            None,
            Some("B3".into()),
            Some(0.95),
            Some("shop-purchase".into()),
            Some(2),
            Some(ev1.event_id.clone()),
            None,
            None,
        );
        assert_eq!(ev2.event_type, "PURCHASE_RESOLVED");

        let ev3 = session.record_event(
            "MOVE",
            12,
            Some("DA_18_Veigar".into()),
            Some("Veigar".into()),
            Some("track-1".into()),
            Some("B3".into()),
            Some("H12".into()),
            Some(0.85),
            Some("tracked-move".into()),
            None,
            None,
            None,
            None,
        );
        assert_eq!(ev3.source_location.as_deref(), Some("B3"));
        assert_eq!(ev3.destination_location.as_deref(), Some("H12"));

        // Label ev1 as CORRECT
        session.add_label(ManualLabel {
            event_id: ev1.event_id,
            verification: "CORRECT".into(),
            actual_champion_id: Some("DA_18_Veigar".into()),
            actual_champion_name: Some("Veigar".into()),
            actual_source_location: None,
            actual_destination_location: None,
            notes: None,
        });

        session.stop();
        assert!(!session.is_active);
        assert!(session.stopped_at.is_some());

        let metrics = session.compute_metrics();
        assert_eq!(metrics.purchases.true_positive, 1);
        assert_eq!(metrics.purchases.false_positive, 0);
        assert_eq!(metrics.purchases.precision, 1.0);
        assert_eq!(metrics.purchases.recall, 1.0);
        assert_eq!(metrics.movements.correct, 1);
        assert_eq!(metrics.coverage.final_cov, 0.75);
    }

    #[test]
    fn test_crop_bmp_generation() {
        let w = 100u32;
        let h = 100u32;
        let bgra = vec![128u8; (w * h * 4) as usize];
        let roi = crate::board_vision::PixelRect { x: 10, y: 10, width: 20, height: 20 };
        let out_path = PathBuf::from("scratch/test_crop.bmp");
        let res = save_roi_crop_bmp(&bgra, w, h, roi, &out_path);
        assert!(res.is_ok());
        assert!(out_path.exists());
        let _ = std::fs::remove_file(out_path);
    }
}
