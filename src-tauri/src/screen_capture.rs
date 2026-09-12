use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex, RwLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const DEFAULT_CAPTURE_FPS: u32 = 2;
const MIN_CAPTURE_FPS: u32 = 1;
const MAX_CAPTURE_FPS: u32 = 5;
const MAX_SAVED_DEBUG_FRAMES: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureState {
    pub state: String, // "disabled" | "waiting-for-tft" | "capturing" | "capture-unavailable" | "error"
    pub window_title: Option<String>,
    pub process_name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub capture_source: String,
    pub capture_fps: f32,
    pub last_frame_timestamp: Option<String>,
    pub processing_time_ms: Option<f32>,
    pub debug_saving: bool,
    pub error_message: Option<String>,
}

impl Default for ScreenCaptureState {
    fn default() -> Self {
        Self {
            state: "disabled".to_string(),
            window_title: None,
            process_name: None,
            width: 0,
            height: 0,
            capture_source: "none".to_string(),
            capture_fps: 0.0,
            last_frame_timestamp: None,
            processing_time_ms: None,
            debug_saving: false,
            error_message: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureTelemetry {
    pub state: String,
    pub window_title: Option<String>,
    pub process_name: Option<String>,
    pub source: String,
    pub source_width: u32,
    pub source_height: u32,
    pub fps: f32,
    pub processing_ms: f32,
    pub preview_width: u32,
    pub preview_height: u32,
    pub last_frame_timestamp: Option<String>,
    pub preview_image: Option<String>,
    pub debug_saving: bool,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureConfig {
    pub enabled: bool,
    pub save_debug_frames: bool,
    pub capture_fps: Option<u32>,
    pub mock_source: Option<bool>,
}

impl Default for ScreenCaptureConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            save_debug_frames: false,
            capture_fps: Some(DEFAULT_CAPTURE_FPS),
            mock_source: Some(false),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedFramePreview {
    pub width: u32,
    pub height: u32,
    pub timestamp: String,
    pub processing_time_ms: f32,
    pub data_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureStatus {
    pub enabled: bool,
    pub detected: bool,
    pub process_name: Option<String>,
    pub window_title: Option<String>,
    pub source_width: u32,
    pub source_height: u32,
    pub capture_fps: f32,
    pub processing_time_ms: f32,
    pub last_frame_age_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct RawFrameBuffer {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    pub captured_at: Instant,
    pub timestamp: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WindowCandidateMeta {
    pub pid: u32,
    pub process_name: String,
    pub title: String,
    pub class_name: String,
    pub is_visible: bool,
    pub is_iconic: bool,
    pub is_cloaked: bool,
    pub width: u32,
    pub height: u32,
    pub is_own_process: bool,
}

pub fn is_explicitly_excluded_process(process_name: &str) -> bool {
    let lower = process_name.to_ascii_lowercase();
    let clean = lower.strip_suffix(".exe").unwrap_or(&lower);
    clean == "leagueclientux"
        || clean == "leagueclientuxrender"
        || clean == "riot client"
        || clean == "riotclient"
        || clean == "riotclientservices"
        || clean == "tft-strategist"
        || clean == "tft_strategist"
        || clean == "crashpad_handler"
}

pub fn score_window_candidate(candidate: &WindowCandidateMeta) -> Option<u32> {
    if candidate.is_own_process {
        return None;
    }
    if !candidate.is_visible || candidate.is_iconic || candidate.is_cloaked {
        return None;
    }
    // Meaningful client dimensions: width >= 800 and height >= 600
    if candidate.width < 800 || candidate.height < 600 {
        return None;
    }
    if is_explicitly_excluded_process(&candidate.process_name) {
        return None;
    }

    let proc_lower = candidate.process_name.to_ascii_lowercase();
    let proc_clean = proc_lower.strip_suffix(".exe").unwrap_or(&proc_lower);
    let title_lower = candidate.title.to_ascii_lowercase();
    let class_lower = candidate.class_name.to_ascii_lowercase();

    let mut score = 0u32;

    // 1. Process identity is the strongest signal
    if proc_clean == "tftclient-win64-shipping" || proc_clean.contains("tftclient") {
        score += 1000;
    } else if proc_clean == "league of legends" || proc_clean == "league of legends (tm) client" {
        score += 500;
    } else if class_lower == "riotwindowclass" {
        score += 300;
    } else {
        return None;
    }

    // 2. Supporting evidence: title "TFT"
    if candidate.title == "TFT" || title_lower.starts_with("tft") {
        score += 200;
    } else if title_lower.contains("tft") {
        score += 100;
    } else if title_lower.contains("league of legends") {
        score += 50;
    }

    // 3. Meaningful size bonus
    if candidate.width >= 1280 && candidate.height >= 720 {
        score += 50;
    }

    Some(score)
}

#[allow(dead_code)]
pub fn choose_best_candidate<'a>(
    candidates: &'a [WindowCandidateMeta],
) -> Option<&'a WindowCandidateMeta> {
    candidates
        .iter()
        .filter_map(|c| score_window_candidate(c).map(|score| (score, c)))
        .max_by_key(|&(score, _)| score)
        .map(|(_, c)| c)
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct DiscoveredWindow {
    #[cfg(target_os = "windows")]
    pub hwnd: windows_sys::Win32::Foundation::HWND,
    pub title: String,
    pub class_name: String,
    pub process_name: String,
    pub pid: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

unsafe impl Send for DiscoveredWindow {}
unsafe impl Sync for DiscoveredWindow {}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows_sys::core::BOOL;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{
                BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC,
                DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
            },
        },
        System::Threading::{
            GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetClientRect, GetClassNameW, GetWindowRect,
            GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        },
    };

    const DWMWA_CLOAKED: u32 = 14;

    fn get_process_name(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }

            let mut buffer = [0u16; 1024];
            let mut size = buffer.len() as u32;
            let success = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
            CloseHandle(handle);

            if success != 0 && size > 0 {
                let full_path = String::from_utf16_lossy(&buffer[..size as usize]);
                let file_name = std::path::Path::new(&full_path)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or(&full_path);
                let stem = file_name.strip_suffix(".exe").unwrap_or(file_name);
                Some(stem.to_string())
            } else {
                None
            }
        }
    }

    struct CandidateEntry {
        score: u32,
        window: DiscoveredWindow,
    }

    struct SearchContext {
        candidates: Vec<CandidateEntry>,
        own_pid: u32,
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = &mut *(lparam as *mut SearchContext);

        if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
            return 1; // continue enumeration
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return 1;
        }

        let is_own_process = pid == context.own_pid;
        if is_own_process {
            return 1;
        }

        let process_name = match get_process_name(pid) {
            Some(name) => name,
            None => return 1,
        };

        if is_explicitly_excluded_process(&process_name) {
            return 1;
        }

        let mut cloaked: u32 = 0;
        let hr_cloak = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        let is_cloaked = hr_cloak == 0 && cloaked != 0;
        if is_cloaked {
            return 1;
        }

        let mut class_buffer = [0u16; 256];
        let class_len = GetClassNameW(hwnd, class_buffer.as_mut_ptr(), 256);
        let class_name = if class_len > 0 {
            String::from_utf16_lossy(&class_buffer[..class_len as usize])
        } else {
            String::new()
        };

        let mut title_buffer = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), 512);
        let title = if title_len > 0 {
            String::from_utf16_lossy(&title_buffer[..title_len as usize])
                .trim()
                .to_string()
        } else {
            String::new()
        };

        // Prefer GetClientRect + ClientToScreen for exact drawing bounds
        let mut client_rect: RECT = std::mem::zeroed();
        let got_client = GetClientRect(hwnd, &mut client_rect) != 0;
        let client_w = (client_rect.right - client_rect.left).max(0) as u32;
        let client_h = (client_rect.bottom - client_rect.top).max(0) as u32;

        let (x, y, width, height) = if got_client && client_w >= 640 && client_h >= 480 {
            let mut pt = POINT {
                x: client_rect.left,
                y: client_rect.top,
            };
            ClientToScreen(hwnd, &mut pt);
            (pt.x, pt.y, client_w, client_h)
        } else {
            let mut rect: RECT = std::mem::zeroed();
            let hr = DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS as u32,
                &mut rect as *mut _ as *mut _,
                std::mem::size_of::<RECT>() as u32,
            );
            if hr == 0 && rect.right > rect.left && rect.bottom > rect.top {
                (
                    rect.left,
                    rect.top,
                    (rect.right - rect.left) as u32,
                    (rect.bottom - rect.top) as u32,
                )
            } else {
                let mut window_rect: RECT = std::mem::zeroed();
                GetWindowRect(hwnd, &mut window_rect);
                let w = (window_rect.right - window_rect.left).max(0) as u32;
                let h = (window_rect.bottom - window_rect.top).max(0) as u32;
                (window_rect.left, window_rect.top, w, h)
            }
        };

        let meta = WindowCandidateMeta {
            pid,
            process_name: process_name.clone(),
            title: title.clone(),
            class_name: class_name.clone(),
            is_visible: true,
            is_iconic: false,
            is_cloaked,
            width,
            height,
            is_own_process: false,
        };

        if let Some(score) = score_window_candidate(&meta) {
            context.candidates.push(CandidateEntry {
                score,
                window: DiscoveredWindow {
                    hwnd,
                    title,
                    class_name,
                    process_name,
                    pid,
                    x,
                    y,
                    width,
                    height,
                },
            });
        }

        1 // continue enumeration
    }

    pub fn discover_tft_window() -> Option<DiscoveredWindow> {
        let own_pid = unsafe { GetCurrentProcessId() };
        let mut context = SearchContext {
            candidates: Vec::new(),
            own_pid,
        };

        unsafe {
            EnumWindows(
                Some(enum_windows_proc),
                &mut context as *mut _ as isize,
            );
        }

        // If no candidate was found on current thread desktop, check OpenInputDesktop
        if context.candidates.is_empty() {
            unsafe {
                extern "system" {
                    fn OpenInputDesktop(dwFlags: u32, fInherit: BOOL, dwDesiredAccess: u32) -> HANDLE;
                    fn CloseDesktop(hDesktop: HANDLE) -> BOOL;
                    fn EnumDesktopWindows(
                        hDesktop: HANDLE,
                        lpfn: Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>,
                        lParam: LPARAM,
                    ) -> BOOL;
                }
                let input_desktop = OpenInputDesktop(0, 0, 0x01FF);
                if !input_desktop.is_null() {
                    EnumDesktopWindows(
                        input_desktop,
                        Some(enum_windows_proc),
                        &mut context as *mut _ as isize,
                    );
                    CloseDesktop(input_desktop);
                }
            }
        }

        context
            .candidates
            .into_iter()
            .max_by_key(|c| c.score)
            .map(|c| c.window)
    }

    pub fn capture_window_raw_bgra(
        window: &DiscoveredWindow,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        let width = window.width;
        let height = window.height;

        if width == 0 || height == 0 {
            return Err("Invalid window dimensions (0x0)".to_string());
        }

        unsafe {
            let screen_dc = GetDC(std::ptr::null_mut());
            if screen_dc.is_null() {
                return Err("Failed to get desktop DC".to_string());
            }

            let mem_dc = CreateCompatibleDC(screen_dc);
            if mem_dc.is_null() {
                ReleaseDC(std::ptr::null_mut(), screen_dc);
                return Err("Failed to create compatible memory DC".to_string());
            }

            let bitmap = CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
            if bitmap.is_null() {
                DeleteDC(mem_dc);
                ReleaseDC(std::ptr::null_mut(), screen_dc);
                return Err("Failed to create compatible bitmap".to_string());
            }

            let old_obj = SelectObject(mem_dc, bitmap);

            let blt_ok = BitBlt(
                mem_dc,
                0,
                0,
                width as i32,
                height as i32,
                screen_dc,
                window.x,
                window.y,
                SRCCOPY,
            ) != 0;

            if !blt_ok {
                let err_code = windows_sys::Win32::Foundation::GetLastError();
                SelectObject(mem_dc, old_obj);
                DeleteObject(bitmap);
                DeleteDC(mem_dc);
                ReleaseDC(std::ptr::null_mut(), screen_dc);
                return Err(format!("BitBlt failed to copy window pixels (error code: {})", err_code));
            }

            let mut bmi: BITMAPINFO = std::mem::zeroed();
            bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = width as i32;
            bmi.bmiHeader.biHeight = -(height as i32); // Top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = BI_RGB;

            let mut buffer = vec![0u8; (width * height * 4) as usize];
            let lines = GetDIBits(
                mem_dc,
                bitmap,
                0,
                height,
                buffer.as_mut_ptr() as *mut _,
                &mut bmi,
                DIB_RGB_COLORS,
            );

            // Cleanup GDI objects immediately
            SelectObject(mem_dc, old_obj);
            DeleteObject(bitmap);
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);

            if lines == 0 {
                return Err("GetDIBits returned 0 lines".to_string());
            }

            Ok((buffer, width, height))
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::*;

    pub fn discover_tft_window() -> Option<DiscoveredWindow> {
        None
    }

    pub fn capture_window_raw_bgra(
        _window: &DiscoveredWindow,
    ) -> Result<(Vec<u8>, u32, u32), String> {
        Err("Native capture unavailable on non-Windows platform".to_string())
    }
}

/// Downsamples raw BGRA buffer to specified preview dimensions and encodes as RGB JPEG.
pub fn create_preview_jpeg(
    bgra: &[u8],
    src_width: u32,
    src_height: u32,
    target_width: u32,
    target_height: u32,
    quality: u8,
) -> Result<Vec<u8>, String> {
    if src_width == 0 || src_height == 0 || target_width == 0 || target_height == 0 {
        return Err("Dimensions must be greater than 0".to_string());
    }

    let mut rgb = Vec::with_capacity((target_width * target_height * 3) as usize);

    for ty in 0..target_height {
        let sy = (ty * src_height) / target_height;
        let row_offset = (sy * src_width * 4) as usize;
        for tx in 0..target_width {
            let sx = (tx * src_width) / target_width;
            let pixel_offset = row_offset + (sx * 4) as usize;
            if pixel_offset + 3 <= bgra.len() {
                let b = bgra[pixel_offset];
                let g = bgra[pixel_offset + 1];
                let r = bgra[pixel_offset + 2];
                rgb.push(r);
                rgb.push(g);
                rgb.push(b);
            } else {
                rgb.push(0);
                rgb.push(0);
                rgb.push(0);
            }
        }
    }

    let mut jpeg_bytes = Vec::new();
    let encoder = jpeg_encoder::Encoder::new(&mut jpeg_bytes, quality);
    encoder
        .encode(
            &rgb,
            target_width as u16,
            target_height as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|e| format!("JPEG encode error: {}", e))?;

    Ok(jpeg_bytes)
}

/// Generates a deterministic synthetic 1920x1080 TFT game frame fixture
pub fn generate_mock_frame_bgra(
    frame_sequence: u64,
    width: u32,
    height: u32,
) -> Vec<u8> {
    let mut bgra = vec![0u8; (width * height * 4) as usize];

    for y in 0..height {
        let y_ratio = y as f32 / height as f32;
        for x in 0..width {
            let _x_ratio = x as f32 / width as f32;
            let idx = ((y * width + x) * 4) as usize;

            // TFT board background gradient (slate dark teal)
            let mut r = (16.0 + 8.0 * y_ratio) as u8;
            let mut g = (22.0 + 12.0 * y_ratio) as u8;
            let mut b = (32.0 + 20.0 * (1.0 - y_ratio)) as u8;

            // Top HUD bar (Stage info)
            if y < height / 16 {
                r = 12;
                g = 18;
                b = 26;
            }

            // Bottom shop bar (y > 82%)
            if y > (height * 82 / 100) {
                let card_slot = (x * 5) / width;
                let card_x = x - (card_slot * width / 5);
                let card_w = width / 5;

                if card_x < 4 || card_x > card_w - 4 || y < (height * 83 / 100) {
                    // Card border
                    r = 60;
                    g = 70;
                    b = 90;
                } else {
                    // Card slot background (different tints per slot)
                    r = 25 + (card_slot as u8 * 8);
                    g = 30 + (card_slot as u8 * 6);
                    b = 45;
                }
            }

            // Center board hex pattern / frame sequence marker
            if y > height / 4 && y < height * 3 / 4 && x > width / 4 && x < width * 3 / 4 {
                let cell_x = (x / 60) % 2;
                let cell_y = (y / 60) % 2;
                if (cell_x ^ cell_y) == 0 {
                    r = r.saturating_add(6);
                    g = g.saturating_add(8);
                    b = b.saturating_add(10);
                }
            }

            // Frame animation dot based on frame_sequence
            let dot_x = ((frame_sequence * 15) % width as u64) as u32;
            let dot_y = (height / 20) as u32;
            if (x as i32 - dot_x as i32).abs() < 8 && (y as i32 - dot_y as i32).abs() < 8 {
                r = 255;
                g = 215;
                b = 0; // Gold dot moving across stage
            }

            bgra[idx] = b;
            bgra[idx + 1] = g;
            bgra[idx + 2] = r;
            bgra[idx + 3] = 255;
        }
    }

    bgra
}

/// Saves a debug frame to the local debug_frames directory (capped at MAX_SAVED_DEBUG_FRAMES)
fn save_debug_frame_locally(jpeg_data: &[u8], timestamp: &str) {
    let debug_dir = std::path::PathBuf::from("artifacts/debug_frames");
    if let Err(_) = std::fs::create_dir_all(&debug_dir) {
        return;
    }

    let clean_timestamp = timestamp.replace([':', '-', '.'], "_");
    let file_path = debug_dir.join(format!("tft_debug_{}.jpg", clean_timestamp));
    let _ = std::fs::write(&file_path, jpeg_data);

    // Prune oldest files if count exceeds limit
    if let Ok(entries) = std::fs::read_dir(&debug_dir) {
        let mut files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "jpg"))
            .collect();
        if files.len() > MAX_SAVED_DEBUG_FRAMES {
            files.sort_by_key(|f| f.metadata().and_then(|m| m.modified()).ok());
            for old in files.iter().take(files.len() - MAX_SAVED_DEBUG_FRAMES) {
                let _ = std::fs::remove_file(old.path());
            }
        }
    }
}

pub struct ScreenCaptureManager {
    config: RwLock<ScreenCaptureConfig>,
    state: RwLock<ScreenCaptureState>,
    latest_raw_frame: RwLock<Option<Arc<RawFrameBuffer>>>,
    latest_preview: RwLock<Option<CapturedFramePreview>>,
    is_running: AtomicBool,
    worker_running: AtomicBool,
    generation: AtomicU64,
    stop_notify: (Mutex<()>, Condvar),
    sequence_counter: Mutex<u64>,
}

impl ScreenCaptureManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            config: RwLock::new(ScreenCaptureConfig::default()),
            state: RwLock::new(ScreenCaptureState::default()),
            latest_raw_frame: RwLock::new(None),
            latest_preview: RwLock::new(None),
            is_running: AtomicBool::new(false),
            worker_running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            stop_notify: (Mutex::new(()), Condvar::new()),
            sequence_counter: Mutex::new(0),
        })
    }

    pub fn get_state(&self) -> ScreenCaptureState {
        self.state.read().unwrap().clone()
    }

    pub fn get_status(&self) -> ScreenCaptureStatus {
        let state = self.state.read().unwrap();
        let cfg = self.config.read().unwrap();
        let raw = self.latest_raw_frame.read().unwrap();
        let age_ms = raw.as_ref().map(|f| f.captured_at.elapsed().as_millis() as u64);
        let is_detected = state.state == "capturing";

        ScreenCaptureStatus {
            enabled: cfg.enabled,
            detected: is_detected,
            process_name: state.process_name.clone(),
            window_title: state.window_title.clone(),
            source_width: state.width,
            source_height: state.height,
            capture_fps: state.capture_fps,
            processing_time_ms: state.processing_time_ms.unwrap_or(0.0),
            last_frame_age_ms: age_ms,
        }
    }

    pub fn get_preview(&self) -> Option<CapturedFramePreview> {
        let raw_opt = self.latest_raw_frame.read().unwrap().clone();
        let raw = raw_opt?;

        let preview_width = 640.min(raw.width);
        let preview_height = ((preview_width as f32 / raw.width as f32) * raw.height as f32).round() as u32;

        let process_start = Instant::now();
        let jpeg = create_preview_jpeg(
            &raw.bgra,
            raw.width,
            raw.height,
            preview_width,
            preview_height,
            70,
        ).ok()?;
        let process_elapsed = process_start.elapsed().as_secs_f32() * 1000.0;

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
        let data_url = format!("data:image/jpeg;base64,{}", b64);

        let preview = CapturedFramePreview {
            width: preview_width,
            height: preview_height,
            timestamp: raw.timestamp.clone(),
            processing_time_ms: process_elapsed,
            data_base64: data_url,
        };

        *self.latest_preview.write().unwrap() = Some(preview.clone());
        Some(preview)
    }

    pub fn poll(&self, include_preview: bool) -> ScreenCaptureTelemetry {
        let state = self.state.read().unwrap();
        let preview = if include_preview {
            self.get_preview()
        } else {
            None
        };

        ScreenCaptureTelemetry {
            state: state.state.clone(),
            window_title: state.window_title.clone(),
            process_name: state.process_name.clone(),
            source: state.capture_source.clone(),
            source_width: state.width,
            source_height: state.height,
            fps: state.capture_fps,
            processing_ms: state.processing_time_ms.unwrap_or(0.0),
            preview_width: preview.as_ref().map_or(0, |p| p.width),
            preview_height: preview.as_ref().map_or(0, |p| p.height),
            last_frame_timestamp: state.last_frame_timestamp.clone(),
            preview_image: preview.map(|p| p.data_base64),
            debug_saving: state.debug_saving,
            error_message: state.error_message.clone(),
        }
    }

    pub fn configure(self: &Arc<Self>, new_config: ScreenCaptureConfig) -> ScreenCaptureState {
        let mut cfg = self.config.write().unwrap();
        *cfg = new_config.clone();

        let fps = cfg.capture_fps.unwrap_or(DEFAULT_CAPTURE_FPS).clamp(MIN_CAPTURE_FPS, MAX_CAPTURE_FPS);

        if !cfg.enabled {
            self.is_running.store(false, Ordering::SeqCst);
            self.generation.fetch_add(1, Ordering::SeqCst);
            let mut state = self.state.write().unwrap();
            *state = ScreenCaptureState {
                state: "disabled".to_string(),
                window_title: None,
                process_name: None,
                width: 0,
                height: 0,
                capture_source: "none".to_string(),
                capture_fps: 0.0,
                last_frame_timestamp: None,
                processing_time_ms: None,
                debug_saving: cfg.save_debug_frames,
                error_message: None,
            };
            *self.latest_raw_frame.write().unwrap() = None;
            *self.latest_preview.write().unwrap() = None;
            // Interrupt sleeping worker thread immediately (<10ms perceived stop)
            self.stop_notify.1.notify_all();
            return state.clone();
        }

        // When enabled
        self.is_running.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        let mut state = self.state.write().unwrap();
        state.state = "waiting-for-tft".to_string();
        state.window_title = None;
        state.process_name = None;
        state.width = 0;
        state.height = 0;
        state.capture_source = if cfg.mock_source.unwrap_or(false) {
            "mock-fixture".to_string()
        } else {
            "none".to_string()
        };
        state.debug_saving = cfg.save_debug_frames;
        state.capture_fps = fps as f32;

        // Ensure exactly ONE worker thread is active
        if !self.worker_running.swap(true, Ordering::SeqCst) {
            let manager_clone = Arc::clone(self);
            if let Err(e) = std::thread::Builder::new()
                .name("screen-capture-worker".to_string())
                .spawn(move || {
                    manager_clone.capture_worker_loop();
                })
            {
                eprintln!("Failed to spawn screen capture worker: {}", e);
                self.worker_running.store(false, Ordering::SeqCst);
            }
        } else {
            // Worker already running; wake it up immediately for next frame/rate
            self.stop_notify.1.notify_all();
        }

        state.clone()
    }

    fn capture_worker_loop(self: Arc<Self>) {
        #[cfg(target_os = "windows")]
        unsafe {
            extern "system" {
                fn OpenInputDesktop(dwFlags: u32, fInherit: i32, dwDesiredAccess: u32) -> windows_sys::Win32::Foundation::HANDLE;
                fn CloseDesktop(hDesktop: windows_sys::Win32::Foundation::HANDLE) -> i32;
                fn SetThreadDesktop(hDesktop: windows_sys::Win32::Foundation::HANDLE) -> i32;
            }
            let input_desktop = OpenInputDesktop(0, 0, 0x01FF);
            if !input_desktop.is_null() {
                let _ = SetThreadDesktop(input_desktop);
                CloseDesktop(input_desktop);
            }
        }

        let mut last_capture_time = Instant::now();
        let mut fps_tracker = 0.0f32;

        while self.is_running.load(Ordering::SeqCst) {
            let (enabled, save_debug, target_fps, mock_source) = {
                let cfg = self.config.read().unwrap();
                (
                    cfg.enabled,
                    cfg.save_debug_frames,
                    cfg.capture_fps.unwrap_or(DEFAULT_CAPTURE_FPS).clamp(MIN_CAPTURE_FPS, MAX_CAPTURE_FPS),
                    cfg.mock_source.unwrap_or(false),
                )
            };

            if !enabled {
                break;
            }

            let thread_gen = self.generation.load(Ordering::SeqCst);
            let loop_start = Instant::now();
            let timestamp_now = current_iso_timestamp();

            if mock_source {
                // Mock source execution
                let seq = {
                    let mut s = self.sequence_counter.lock().unwrap();
                    *s += 1;
                    *s
                };

                let mock_width = 1920u32;
                let mock_height = 1080u32;

                let process_start = Instant::now();
                let bgra = generate_mock_frame_bgra(seq, mock_width, mock_height);
                let process_elapsed = process_start.elapsed().as_secs_f32() * 1000.0;

                let raw_buffer = Arc::new(RawFrameBuffer {
                    width: mock_width,
                    height: mock_height,
                    bgra,
                    captured_at: Instant::now(),
                    timestamp: timestamp_now.clone(),
                });

                if save_debug {
                    let preview_width = 640u32;
                    let preview_height = 360u32;
                    if let Ok(jpeg) = create_preview_jpeg(
                        &raw_buffer.bgra,
                        mock_width,
                        mock_height,
                        preview_width,
                        preview_height,
                        70,
                    ) {
                        save_debug_frame_locally(&jpeg, &timestamp_now);
                    }
                }

                if self.is_running.load(Ordering::SeqCst)
                    && self.generation.load(Ordering::SeqCst) == thread_gen
                {
                    *self.latest_raw_frame.write().unwrap() = Some(raw_buffer);

                    let mut st = self.state.write().unwrap();
                    st.state = "capturing".to_string();
                    st.window_title = Some("TFT [MOCK]".to_string());
                    st.process_name = Some("TFTClient-Win64-Shipping".to_string());
                    st.width = mock_width;
                    st.height = mock_height;
                    st.capture_source = "mock-fixture".to_string();
                    st.capture_fps = target_fps as f32;
                    st.last_frame_timestamp = Some(timestamp_now);
                    st.processing_time_ms = Some(process_elapsed);
                    st.debug_saving = save_debug;
                    st.error_message = None;
                }
            } else {
                // Windows-native capture execution
                let discovered = platform::discover_tft_window();

                match discovered {
                    Some(window) => {
                        let process_start = Instant::now();
                        let capture_result = platform::capture_window_raw_bgra(&window);
                        let process_elapsed = process_start.elapsed().as_secs_f32() * 1000.0;

                        match capture_result {
                            Ok((bgra, width, height)) => {
                                let raw_buffer = Arc::new(RawFrameBuffer {
                                    width,
                                    height,
                                    bgra,
                                    captured_at: Instant::now(),
                                    timestamp: timestamp_now.clone(),
                                });

                                if save_debug {
                                    let preview_width = 640.min(width);
                                    let preview_height = ((preview_width as f32 / width as f32) * height as f32).round() as u32;
                                    if let Ok(jpeg) = create_preview_jpeg(
                                        &raw_buffer.bgra,
                                        width,
                                        height,
                                        preview_width,
                                        preview_height,
                                        70,
                                    ) {
                                        save_debug_frame_locally(&jpeg, &timestamp_now);
                                    }
                                }

                                if self.is_running.load(Ordering::SeqCst)
                                    && self.generation.load(Ordering::SeqCst) == thread_gen
                                {
                                    *self.latest_raw_frame.write().unwrap() = Some(raw_buffer);

                                    let elapsed_since_last = last_capture_time.elapsed().as_secs_f32();
                                    if elapsed_since_last > 0.05 {
                                        let instant_fps = 1.0 / elapsed_since_last;
                                        fps_tracker = if fps_tracker == 0.0 {
                                            instant_fps
                                        } else {
                                            fps_tracker * 0.7 + instant_fps * 0.3
                                        };
                                    }
                                    last_capture_time = Instant::now();

                                    let mut st = self.state.write().unwrap();
                                    st.state = "capturing".to_string();
                                    st.window_title = Some(window.title);
                                    st.process_name = Some(window.process_name);
                                    st.width = width;
                                    st.height = height;
                                    st.capture_source = "Windows TFT window".to_string();
                                    st.capture_fps = (fps_tracker * 10.0).round() / 10.0;
                                    st.last_frame_timestamp = Some(timestamp_now);
                                    st.processing_time_ms = Some(process_elapsed);
                                    st.debug_saving = save_debug;
                                    st.error_message = None;
                                }
                            }
                            Err(err) => {
                                if self.is_running.load(Ordering::SeqCst)
                                    && self.generation.load(Ordering::SeqCst) == thread_gen
                                {
                                    let mut st = self.state.write().unwrap();
                                    st.state = "error".to_string();
                                    st.error_message = Some(err);
                                }
                            }
                        }
                    }
                    None => {
                        if self.is_running.load(Ordering::SeqCst)
                            && self.generation.load(Ordering::SeqCst) == thread_gen
                        {
                            let mut st = self.state.write().unwrap();
                            st.state = "waiting-for-tft".to_string();
                            st.window_title = None;
                            st.process_name = None;
                            st.width = 0;
                            st.height = 0;
                            st.capture_source = "none".to_string();
                            st.capture_fps = 0.0;
                            st.error_message = None;
                            *self.latest_raw_frame.write().unwrap() = None;
                            *self.latest_preview.write().unwrap() = None;
                        }
                    }
                }
            }

            // Sleep with Condvar interrupt to maintain target FPS without blocking shutdown
            let frame_budget = Duration::from_millis((1000 / target_fps).max(200) as u64);
            let elapsed = loop_start.elapsed();
            if elapsed < frame_budget {
                let wait_dur = frame_budget - elapsed;
                let (lock, cvar) = &self.stop_notify;
                let guard = lock.lock().unwrap();
                let _ = cvar.wait_timeout(guard, wait_dur);
            }
        }

        self.worker_running.store(false, Ordering::SeqCst);
    }
}

pub struct ScreenCaptureStateHandle {
    pub inner: Arc<ScreenCaptureManager>,
}

fn current_iso_timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    format!("{}.{:03}Z", secs, millis)
}

#[tauri::command]
pub fn screen_capture_get_state(
    state: tauri::State<'_, ScreenCaptureStateHandle>,
) -> ScreenCaptureState {
    state.inner.get_state()
}

#[tauri::command]
pub fn screen_capture_status(
    state: tauri::State<'_, ScreenCaptureStateHandle>,
) -> ScreenCaptureStatus {
    state.inner.get_status()
}

#[tauri::command]
pub fn screen_capture_configure(
    config: ScreenCaptureConfig,
    state: tauri::State<'_, ScreenCaptureStateHandle>,
) -> ScreenCaptureState {
    state.inner.configure(config)
}

#[tauri::command]
pub fn screen_capture_get_preview(
    state: tauri::State<'_, ScreenCaptureStateHandle>,
) -> Option<CapturedFramePreview> {
    state.inner.get_preview()
}

#[tauri::command]
pub fn screen_capture_preview(
    state: tauri::State<'_, ScreenCaptureStateHandle>,
) -> Option<CapturedFramePreview> {
    state.inner.get_preview()
}

#[tauri::command]
pub fn screen_capture_poll(
    include_preview: bool,
    state: tauri::State<'_, ScreenCaptureStateHandle>,
) -> ScreenCaptureTelemetry {
    state.inner.poll(include_preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_capture_defaults_to_disabled() {
        let manager = ScreenCaptureManager::new();
        let state = manager.get_state();
        assert_eq!(state.state, "disabled");
        assert_eq!(state.debug_saving, false);
        assert_eq!(state.width, 0);
        assert_eq!(state.height, 0);
        assert!(manager.get_preview().is_none());
    }

    #[test]
    fn mock_frame_generation_produces_correct_buffer_size() {
        let width = 1920;
        let height = 1080;
        let bgra = generate_mock_frame_bgra(1, width, height);
        assert_eq!(bgra.len(), (width * height * 4) as usize);

        // Test JPEG preview downsampling
        let preview = create_preview_jpeg(&bgra, width, height, 640, 360, 75);
        assert!(preview.is_ok());
        let bytes = preview.unwrap();
        assert!(!bytes.is_empty());
        // Verify JPEG magic bytes FF D8
        assert_eq!(bytes[0], 0xFF);
        assert_eq!(bytes[1], 0xD8);
    }

    #[test]
    fn poll_telemetry_with_and_without_preview() {
        let manager = ScreenCaptureManager::new();
        let telemetry_disabled = manager.poll(false);
        assert_eq!(telemetry_disabled.state, "disabled");
        assert!(telemetry_disabled.preview_image.is_none());

        // Configure mock
        manager.configure(ScreenCaptureConfig {
            enabled: true,
            save_debug_frames: false,
            capture_fps: Some(5),
            mock_source: Some(true),
        });

        // Give worker thread a moment to transition to capturing
        let mut ready = false;
        for _ in 0..40 {
            if manager.get_state().state == "capturing" {
                ready = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(ready, "Worker thread should reach capturing state within 1s");

        let telemetry_with_preview = manager.poll(true);
        assert_eq!(telemetry_with_preview.state, "capturing");
        assert!(telemetry_with_preview.preview_image.is_some());

        let telemetry_without_preview = manager.poll(false);
        assert_eq!(telemetry_without_preview.state, "capturing");
        assert!(telemetry_without_preview.preview_image.is_none());

        manager.configure(ScreenCaptureConfig {
            enabled: false,
            save_debug_frames: false,
            capture_fps: Some(2),
            mock_source: Some(true),
        });
    }

    #[tokio::test]
    async fn configure_enabling_and_disabling_lifecycle() {
        let manager = ScreenCaptureManager::new();

        // Enable with mock source
        let state = manager.configure(ScreenCaptureConfig {
            enabled: true,
            save_debug_frames: false,
            capture_fps: Some(5),
            mock_source: Some(true),
        });
        assert_eq!(state.state, "waiting-for-tft");
        assert_eq!(state.capture_fps, 5.0);

        // Wait for background mock capture
        let mut ready = false;
        for _ in 0..40 {
            if manager.get_state().state == "capturing" {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(ready, "Worker thread should reach capturing state within 1s");

        let active_state = manager.get_state();
        assert_eq!(active_state.state, "capturing");
        assert_eq!(active_state.width, 1920);
        assert_eq!(active_state.height, 1080);
        assert_eq!(active_state.capture_source, "mock-fixture");

        let preview = manager.get_preview();
        assert!(preview.is_some());
        let p = preview.unwrap();
        assert_eq!(p.width, 640);
        assert_eq!(p.height, 360);
        assert!(p.data_base64.starts_with("data:image/jpeg;base64,"));

        // Disable capture
        let disabled_state = manager.configure(ScreenCaptureConfig {
            enabled: false,
            save_debug_frames: false,
            capture_fps: Some(2),
            mock_source: Some(true),
        });
        assert_eq!(disabled_state.state, "disabled");
        assert!(manager.get_preview().is_none());
    }

    #[test]
    fn test_case_1_tft_client_shipping_with_title_tft_detected() {
        let candidate = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping.exe".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };

        let score = score_window_candidate(&candidate);
        assert!(score.is_some(), "TFTClient-Win64-Shipping should be scored positively");
        assert!(score.unwrap() >= 1200);

        let list = [candidate.clone()];
        let best = choose_best_candidate(&list);
        assert_eq!(best, Some(&candidate));
    }

    #[test]
    fn test_case_2_league_client_ux_only_not_detected() {
        let candidate = WindowCandidateMeta {
            pid: 27848,
            process_name: "LeagueClientUx.exe".to_string(),
            title: "League of Legends".to_string(),
            class_name: "RCLIENT".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1440,
            height: 759,
            is_own_process: false,
        };

        assert!(is_explicitly_excluded_process(&candidate.process_name));
        assert_eq!(score_window_candidate(&candidate), None);
        assert_eq!(choose_best_candidate(&[candidate]), None);
    }

    #[test]
    fn test_case_3_riot_client_only_not_detected() {
        let candidates = vec![
            WindowCandidateMeta {
                pid: 17324,
                process_name: "Riot Client.exe".to_string(),
                title: "Riot Client".to_string(),
                class_name: "Chrome_WidgetWin_1".to_string(),
                is_visible: true,
                is_iconic: false,
                is_cloaked: false,
                width: 1440,
                height: 759,
                is_own_process: false,
            },
            WindowCandidateMeta {
                pid: 2872,
                process_name: "RiotClientServices.exe".to_string(),
                title: "".to_string(),
                class_name: "HiddenWndClass".to_string(),
                is_visible: true,
                is_iconic: false,
                is_cloaked: false,
                width: 1000,
                height: 800,
                is_own_process: false,
            },
        ];

        for c in &candidates {
            assert!(is_explicitly_excluded_process(&c.process_name));
            assert_eq!(score_window_candidate(c), None);
        }
        assert_eq!(choose_best_candidate(&candidates), None);
    }

    #[test]
    fn test_case_4_tft_plus_league_client_together_chooses_tft() {
        let league = WindowCandidateMeta {
            pid: 27848,
            process_name: "LeagueClientUx.exe".to_string(),
            title: "League of Legends".to_string(),
            class_name: "RCLIENT".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1440,
            height: 759,
            is_own_process: false,
        };
        let tft = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };

        let candidates = [league, tft.clone()];
        let chosen = choose_best_candidate(&candidates);
        assert_eq!(chosen, Some(&tft));
    }

    #[test]
    fn test_case_5_strategist_window_never_selected() {
        let own_proc_candidate = WindowCandidateMeta {
            pid: 9984,
            process_name: "tft-strategist.exe".to_string(),
            title: "TFT Strategist".to_string(),
            class_name: "Tauri Window".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1456,
            height: 979,
            is_own_process: true,
        };
        assert_eq!(score_window_candidate(&own_proc_candidate), None);
        assert_eq!(choose_best_candidate(&[own_proc_candidate]), None);

        // Also if is_own_process is false but process_name is tft-strategist
        let named_candidate = WindowCandidateMeta {
            pid: 9984,
            process_name: "tft-strategist".to_string(),
            title: "TFT Strategist".to_string(),
            class_name: "Tauri Window".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1456,
            height: 979,
            is_own_process: false,
        };
        assert!(is_explicitly_excluded_process(&named_candidate.process_name));
        assert_eq!(score_window_candidate(&named_candidate), None);
    }

    #[test]
    fn test_case_6_hidden_or_cloaked_candidate_ignored() {
        let hidden = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: false,
            is_iconic: false,
            is_cloaked: false,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };
        let cloaked = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: true,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };
        let iconic = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: true,
            is_cloaked: false,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };

        assert_eq!(score_window_candidate(&hidden), None);
        assert_eq!(score_window_candidate(&cloaked), None);
        assert_eq!(score_window_candidate(&iconic), None);
        assert_eq!(choose_best_candidate(&[hidden, cloaked, iconic]), None);
    }

    #[test]
    fn test_case_7_undersized_invalid_window_ignored() {
        // Watchdog window 10x10
        let watchdog = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "DXGIWatchdogThreadWindow".to_string(),
            class_name: "DXGIWatchdogThreadWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 10,
            height: 10,
            is_own_process: false,
        };
        // Below minimum meaningful dimensions (800x600)
        let small = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 799,
            height: 599,
            is_own_process: false,
        };

        assert_eq!(score_window_candidate(&watchdog), None);
        assert_eq!(score_window_candidate(&small), None);
        assert_eq!(choose_best_candidate(&[watchdog, small]), None);
    }

    #[test]
    fn test_case_8_tft_window_closes_transitions_to_waiting() {
        // When active candidates exist, best candidate is selected
        let active_candidate = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };
        assert!(choose_best_candidate(&[active_candidate]).is_some());

        // When window closes, candidate list is empty
        let closed_candidates: [WindowCandidateMeta; 0] = [];
        assert_eq!(choose_best_candidate(&closed_candidates), None);
    }

    #[test]
    fn test_case_9_tft_relaunches_reacquired() {
        let mut candidates = Vec::new();
        assert_eq!(choose_best_candidate(&candidates), None);

        // Process relaunches
        candidates.push(WindowCandidateMeta {
            pid: 99999,
            process_name: "TFTClient-Win64-Shipping.exe".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 2560,
            height: 1440,
            is_own_process: false,
        });

        let reacquired = choose_best_candidate(&candidates);
        assert!(reacquired.is_some());
        assert_eq!(reacquired.unwrap().pid, 99999);
        assert_eq!(reacquired.unwrap().width, 2560);
    }

    #[test]
    fn test_case_10_detection_independent_of_lcu_scouting_mode() {
        // Mode could be Tocker's Trials, Normal, Double Up, or Ranked — discovery is pure window & process based
        let tockers_trials_window = WindowCandidateMeta {
            pid: 28232,
            process_name: "TFTClient-Win64-Shipping".to_string(),
            title: "TFT".to_string(),
            class_name: "UnrealWindow".to_string(),
            is_visible: true,
            is_iconic: false,
            is_cloaked: false,
            width: 1920,
            height: 1080,
            is_own_process: false,
        };

        // Window discovery does not know or depend on any LCU scouting flag or queue ID
        let match_result = score_window_candidate(&tockers_trials_window);
        assert!(match_result.is_some());
        assert!(match_result.unwrap() >= 1200);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_live_window_discovery_if_game_running() {
        if let Some(window) = platform::discover_tft_window() {
            println!(
                "Live window discovered: title='{}', process='{}', size={}x{}",
                window.title, window.process_name, window.width, window.height
            );
            assert!(window.width >= 800);
            assert!(window.height >= 600);
            assert!(window.process_name.contains("TFTClient"));
            assert_eq!(window.title, "TFT");
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_live_window_capture_if_game_running() {
        if let Some(window) = platform::discover_tft_window() {
            let handle = std::thread::spawn(move || {
                unsafe {
                    extern "system" {
                        fn OpenInputDesktop(dwFlags: u32, fInherit: i32, dwDesiredAccess: u32) -> windows_sys::Win32::Foundation::HANDLE;
                        fn CloseDesktop(hDesktop: windows_sys::Win32::Foundation::HANDLE) -> i32;
                        fn SetThreadDesktop(hDesktop: windows_sys::Win32::Foundation::HANDLE) -> i32;
                    }
                    let input_desktop = OpenInputDesktop(0, 0, 0x01FF);
                    if !input_desktop.is_null() {
                        let _ = SetThreadDesktop(input_desktop);
                        CloseDesktop(input_desktop);
                    }
                }

                match platform::capture_window_raw_bgra(&window) {
                    Ok((bgra, width, height)) => {
                        println!("Captured {}x{} frame successfully! (bytes: {})", width, height, bgra.len());
                        assert_eq!(width, window.width);
                        assert_eq!(height, window.height);
                        assert_eq!(bgra.len(), (width * height * 4) as usize);

                        let preview_jpeg = create_preview_jpeg(&bgra, width, height, 640, 360, 70);
                        assert!(preview_jpeg.is_ok(), "JPEG encoding should succeed");
                        let jpeg = preview_jpeg.unwrap();
                        assert!(!jpeg.is_empty());
                        assert_eq!(jpeg[0], 0xFF);
                        assert_eq!(jpeg[1], 0xD8);
                    }
                    Err(err) => {
                        eprintln!("Capture failed with error: {}", err);
                        panic!("Capture error: {}", err);
                    }
                }
            });

            handle.join().unwrap();
        }
    }
}
