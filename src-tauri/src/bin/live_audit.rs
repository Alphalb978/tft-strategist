use std::ptr::null_mut;
use std::thread::sleep;
use std::time::{Duration, Instant};
use tft_strategist_lib::shop_vision::{ShopVisionEngine, ScreenShopStatus};

type HWND = *mut std::ffi::c_void;
type HDC = *mut std::ffi::c_void;
type HBITMAP = *mut std::ffi::c_void;
type HGDIOBJ = *mut std::ffi::c_void;
type BOOL = i32;
type LPARAM = isize;
type HANDLE = *mut std::ffi::c_void;

#[repr(C)]
struct RECT { left: i32, top: i32, right: i32, bottom: i32 }
#[repr(C)]
struct POINT { x: i32, y: i32 }

#[repr(C)]
struct BITMAPINFOHEADER {
    bi_size: u32,
    bi_width: i32,
    bi_height: i32,
    bi_planes: u16,
    bi_bit_count: u16,
    bi_compression: u32,
    bi_size_image: u32,
    bi_x_pels_per_meter: i32,
    bi_y_pels_per_meter: i32,
    bi_clr_used: u32,
    bi_clr_important: u32,
}

#[repr(C)]
struct BITMAPINFO {
    bmi_header: BITMAPINFOHEADER,
    bmi_colors: [u32; 1],
}

extern "system" {
    fn OpenInputDesktop(dw_flags: u32, f_inherit: i32, dw_desired_access: u32) -> HANDLE;
    fn CloseDesktop(h_desktop: HANDLE) -> i32;
    fn SetThreadDesktop(h_desktop: HANDLE) -> i32;
    fn EnumWindows(lp_enum_func: unsafe extern "system" fn(HWND, LPARAM) -> BOOL, l_param: LPARAM) -> BOOL;
    fn GetWindowThreadProcessId(h_wnd: HWND, lpdw_process_id: *mut u32) -> u32;
    fn GetForegroundWindow() -> HWND;
    fn GetCurrentThreadId() -> u32;
    fn AttachThreadInput(id_attach: u32, id_attach_to: u32, f_attach: BOOL) -> BOOL;
    fn IsWindowVisible(h_wnd: HWND) -> BOOL;
    fn IsIconic(h_wnd: HWND) -> BOOL;
    fn GetClientRect(h_wnd: HWND, lp_rect: *mut RECT) -> BOOL;
    fn ClientToScreen(h_wnd: HWND, lp_point: *mut POINT) -> BOOL;
    fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> HANDLE;
    fn CloseHandle(h_object: HANDLE) -> BOOL;
    fn QueryFullProcessImageNameW(h_process: HANDLE, dw_flags: u32, lp_exe_name: *mut u16, lpdw_size: *mut u32) -> BOOL;
    fn SwitchToThisWindow(h_wnd: HWND, f_unknown: BOOL);
    fn SetForegroundWindow(h_wnd: HWND) -> BOOL;
    fn ShowWindow(h_wnd: HWND, n_cmd_show: i32) -> BOOL;
    fn BringWindowToTop(h_wnd: HWND) -> BOOL;
    fn GetDC(h_wnd: HWND) -> HDC;
    fn ReleaseDC(h_wnd: HWND, h_dc: HDC) -> i32;
    fn CreateCompatibleDC(h_dc: HDC) -> HDC;
    fn CreateCompatibleBitmap(h_dc: HDC, cx: i32, cy: i32) -> HBITMAP;
    fn SelectObject(h_dc: HDC, h: HGDIOBJ) -> HGDIOBJ;
    fn DeleteDC(h_dc: HDC) -> BOOL;
    fn DeleteObject(ho: HGDIOBJ) -> BOOL;
    fn BitBlt(hdc: HDC, x: i32, y: i32, cx: i32, cy: i32, hdc_src: HDC, x1: i32, y1: i32, rop: u32) -> BOOL;
    fn GetDIBits(hdc: HDC, hbm: HBITMAP, start: u32, c_lines: u32, lpv_bits: *mut u8, lpbmi: *mut BITMAPINFO, usage: u32) -> i32;
}

struct SearchContext {
    hwnd: HWND,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam as *mut SearchContext);
    if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 { return 1; }
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 { return 1; }
    let handle = OpenProcess(0x1000, 0, pid);
    if handle.is_null() { return 1; }
    let mut buf = [0u16; 1024];
    let mut size = 1024u32;
    let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
    CloseHandle(handle);
    if ok != 0 && size > 0 {
        let name = String::from_utf16_lossy(&buf[..size as usize]);
        if name.to_ascii_lowercase().contains("tftclient-win64-shipping") {
            let mut r: RECT = std::mem::zeroed();
            GetClientRect(hwnd, &mut r);
            let w = (r.right - r.left) as u32;
            let h = (r.bottom - r.top) as u32;
            if w >= 1280 && h >= 720 {
                let mut pt: POINT = std::mem::zeroed();
                ClientToScreen(hwnd, &mut pt);
                ctx.hwnd = hwnd;
                ctx.x = pt.x;
                ctx.y = pt.y;
                ctx.w = w;
                ctx.h = h;
                return 0; // Found target
            }
        }
    }
    1
}

fn capture_frame(ctx: &SearchContext) -> Result<Vec<u8>, String> {
    unsafe {
        let s_dc = GetDC(null_mut());
        let m_dc = CreateCompatibleDC(s_dc);
        let bmp = CreateCompatibleBitmap(s_dc, ctx.w as i32, ctx.h as i32);
        let old = SelectObject(m_dc, bmp);
        let blt_ok = BitBlt(m_dc, 0, 0, ctx.w as i32, ctx.h as i32, s_dc, ctx.x, ctx.y, 0x00CC0020);
        if blt_ok == 0 {
            SelectObject(m_dc, old);
            DeleteObject(bmp);
            DeleteDC(m_dc);
            ReleaseDC(null_mut(), s_dc);
            return Err("BitBlt failed".into());
        }

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmi_header.bi_size = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmi_header.bi_width = ctx.w as i32;
        bmi.bmi_header.bi_height = -(ctx.h as i32);
        bmi.bmi_header.bi_planes = 1;
        bmi.bmi_header.bi_bit_count = 32;
        bmi.bmi_header.bi_compression = 0; // BI_RGB

        let mut raw = vec![0u8; (ctx.w * ctx.h * 4) as usize];
        let lines = GetDIBits(m_dc, bmp, 0, ctx.h, raw.as_mut_ptr(), &mut bmi, 0);
        SelectObject(m_dc, old);
        DeleteObject(bmp);
        DeleteDC(m_dc);
        ReleaseDC(null_mut(), s_dc);

        if lines == 0 {
            return Err("GetDIBits returned 0 lines".into());
        }
        Ok(raw)
    }
}

fn write_bmp(path: &std::path::Path, raw: &[u8], frame_w: u32, frame_h: u32, rect: tft_strategist_lib::shop_vision::PixelRect) {
    let mut header = [0u8; 54];
    let file_size = 54 + rect.width * rect.height * 4;
    header[0] = b'B'; header[1] = b'M';
    header[2..6].copy_from_slice(&(file_size as u32).to_le_bytes());
    header[10..14].copy_from_slice(&54u32.to_le_bytes());
    header[14..18].copy_from_slice(&40u32.to_le_bytes());
    header[18..22].copy_from_slice(&(rect.width as i32).to_le_bytes());
    header[22..26].copy_from_slice(&(-(rect.height as i32)).to_le_bytes()); // top-down
    header[26..28].copy_from_slice(&1u16.to_le_bytes());
    header[28..30].copy_from_slice(&32u16.to_le_bytes());

    let mut data = Vec::with_capacity((rect.width * rect.height * 4) as usize);
    for y in 0..rect.height {
        let sy = rect.y as u32 + y;
        if sy >= frame_h { continue; }
        for x in 0..rect.width {
            let sx = rect.x as u32 + x;
            if sx >= frame_w { continue; }
            let idx = ((sy * frame_w + sx) * 4) as usize;
            if idx + 3 < raw.len() {
                data.extend_from_slice(&raw[idx..idx + 4]);
            } else {
                data.extend_from_slice(&[0, 0, 0, 255]);
            }
        }
    }

    let mut file_bytes = header.to_vec();
    file_bytes.extend_from_slice(&data);
    let _ = std::fs::write(path, file_bytes);
}

fn main() {
    println!("=== TFT STRATEGIST M14B LIVE ACCEPTANCE AUDIT ===");
    let engine = ShopVisionEngine::new();

    unsafe {
        let d = OpenInputDesktop(0, 0, 0x01FF);
        if !d.is_null() {
            SetThreadDesktop(d);
            CloseDesktop(d);
        }

        let mut ctx = SearchContext { hwnd: null_mut(), x: 0, y: 0, w: 0, h: 0 };
        EnumWindows(enum_proc, &mut ctx as *mut _ as isize);
        if ctx.hwnd.is_null() {
            eprintln!("TFT window not found!");
            return;
        }

        println!("Detected TFT window: {}x{} at ({}, {})", ctx.w, ctx.h, ctx.x, ctx.y);

        // Bring TFT window to foreground
        let fg = GetForegroundWindow();
        let mut fg_pid = 0;
        let fg_tid = GetWindowThreadProcessId(fg, &mut fg_pid);
        let cur_tid = GetCurrentThreadId();

        AttachThreadInput(cur_tid, fg_tid, 1);
        ShowWindow(ctx.hwnd, 9); // SW_RESTORE
        BringWindowToTop(ctx.hwnd);
        SetForegroundWindow(ctx.hwnd);
        SwitchToThisWindow(ctx.hwnd, 1);
        AttachThreadInput(cur_tid, fg_tid, 0);

        sleep(Duration::from_millis(600));

        let mut previous_sig = String::new();
        let mut shops_audited = 0;
        let target_shops = 10;
        let mut total_processing_ms = 0.0f32;
        let mut total_frames_processed = 0;

        let max_iterations = 5; // probe run
        println!("\nStarting live recognition audit across up to {} shops (at 2 FPS)...\n", target_shops);

        for _iter in 0..max_iterations {
            if shops_audited >= target_shops {
                break;
            }

            let start = Instant::now();
            let raw = match capture_frame(&ctx) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("Capture error: {}", e);
                    sleep(Duration::from_millis(500));
                    continue;
                }
            };

            if _iter == 0 {
                let full_rect = tft_strategist_lib::shop_vision::PixelRect { x: 0, y: 0, width: ctx.w, height: ctx.h };
                write_bmp(std::path::Path::new("scratch/current_screen.bmp"), &raw, ctx.w, ctx.h, full_rect);
                println!("Saved scratch/current_screen.bmp ({}x{})", ctx.w, ctx.h);
            }

            let status: ScreenShopStatus = engine.process_frame(&raw, ctx.w, ctx.h);
            let elapsed_ms = start.elapsed().as_secs_f32() * 1000.0;
            total_processing_ms += elapsed_ms;
            total_frames_processed += 1;

            if !status.detected {
                // Shop not currently detected
                sleep(Duration::from_millis(500));
                continue;
            }

            // Build signature of current shop
            let mut current_sig = String::new();
            for slot in &status.slots {
                if let Some(ref name) = slot.champion_name {
                    current_sig.push_str(name);
                    current_sig.push('_');
                } else {
                    current_sig.push_str("UNK_");
                }
            }

            if current_sig != previous_sig && !current_sig.is_empty() {
                previous_sig = current_sig;
                shops_audited += 1;

                println!("Shop generation {}", shops_audited);
                for slot in &status.slots {
                    let champ_str = slot.champion_name.as_deref().unwrap_or("UNKNOWN");
                    let conf_pct = (slot.confidence * 100.0).round() as u32;
                    let margin_pct = (slot.margin * 100.0).round() as u32;
                    println!(
                        "  {}. {} — {}% (second best: {}, margin: {}%, stable: {})",
                        slot.index + 1,
                        champ_str,
                        conf_pct,
                        slot.second_best_champion_id.as_deref().unwrap_or("None"),
                        margin_pct,
                        slot.stable
                    );
                }
                let audit_dir = std::path::Path::new("scratch/audit");
                let _ = std::fs::create_dir_all(audit_dir);
                for slot in &status.slots {
                    let card_path = audit_dir.join(format!("shop_{}_slot_{}.bmp", shops_audited, slot.index));
                    write_bmp(&card_path, &raw, ctx.w, ctx.h, slot.rect);
                }
                println!("  [Frame processing time: {:.1} ms]\n", elapsed_ms);
            }

            sleep(Duration::from_millis(500));
        }

        let avg_time = if total_frames_processed > 0 {
            total_processing_ms / total_frames_processed as f32
        } else {
            0.0
        };

        println!("=== AUDIT SUMMARY ===");
        println!("Shops audited: {}", shops_audited);
        println!("Total frames processed: {}", total_frames_processed);
        println!("Average frame processing time: {:.2} ms", avg_time);
    }
}
