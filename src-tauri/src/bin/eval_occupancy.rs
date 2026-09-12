use std::path::Path;
use std::time::Instant;
use tft_strategist_lib::board_vision::{BoardVisionEngine, OccupancyState};
use tft_strategist_lib::shop_vision::ShopVisionEngine;

fn load_png_as_bgra(path: &Path) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoder = png::Decoder::new(&bytes[..]);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let w = info.width;
    let h = info.height;

    let mut bgra = vec![0u8; (w * h * 4) as usize];
    match info.color_type {
        png::ColorType::Rgba => {
            for i in 0..(w * h) as usize {
                if (i + 1) * 4 <= buf.len() && (i + 1) * 4 <= bgra.len() {
                    let r = buf[i * 4];
                    let g = buf[i * 4 + 1];
                    let b = buf[i * 4 + 2];
                    let a = buf[i * 4 + 3];
                    bgra[i * 4] = b;
                    bgra[i * 4 + 1] = g;
                    bgra[i * 4 + 2] = r;
                    bgra[i * 4 + 3] = a;
                }
            }
        }
        png::ColorType::Rgb => {
            for i in 0..(w * h) as usize {
                if (i + 1) * 3 <= buf.len() && (i + 1) * 4 <= bgra.len() {
                    let r = buf[i * 3];
                    let g = buf[i * 3 + 1];
                    let b = buf[i * 3 + 2];
                    bgra[i * 4] = b;
                    bgra[i * 4 + 1] = g;
                    bgra[i * 4 + 2] = r;
                    bgra[i * 4 + 3] = 255;
                }
            }
        }
        _ => return Err(format!("Unsupported color type: {:?}", info.color_type)),
    }
    Ok((bgra, w, h))
}

fn load_bmp_as_bgra(path: &Path) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let w = i32::from_le_bytes(bytes[18..22].try_into().unwrap()) as u32;
    let h_raw = i32::from_le_bytes(bytes[22..26].try_into().unwrap());
    let h = h_raw.abs() as u32;
    let offset = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
    let raw = &bytes[offset..];
    
    let row_stride = ((w * 4 + 3) / 4) * 4;
    let mut bgra = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        let src_y = if h_raw > 0 { h - 1 - y } else { y };
        let src_row = (src_y * row_stride) as usize;
        let dst_row = (y * w * 4) as usize;
        if src_row + (w * 4) as usize <= raw.len() {
            bgra[dst_row..dst_row + (w * 4) as usize]
                .copy_from_slice(&raw[src_row..src_row + (w * 4) as usize]);
        }
    }
    Ok((bgra, w, h))
}

fn main() {
    println!("==================================================");
    println!("M14C LIVE BOARD & BENCH OCCUPANCY AUDIT");
    println!("==================================================");

    let board_engine = BoardVisionEngine::new();
    let shop_engine = ShopVisionEngine::new();

    // 1. Audit 1080p frame (full_live_frame.png)
    let p1080_candidates = [
        Path::new("scratch/full_live_frame.png"),
        Path::new("../scratch/full_live_frame.png"),
    ];
    let p1080 = p1080_candidates.iter().find(|p| p.exists()).map(|p| *p);
    if let Some(p1080) = p1080 {
        println!("\nEvaluating 1080p frame: {}", p1080.display());
        let (bgra, w, h) = load_png_as_bgra(p1080).expect("load 1080p frame");
        println!("Loaded image: {}x{} ({} bytes)", w, h, bgra.len());

        // Warm up and evaluate for timing
        let _ = board_engine.process_frame(&bgra, w, h);
        let t_start = Instant::now();
        let res = board_engine.process_frame(&bgra, w, h);
        let board_bench_time = t_start.elapsed();

        let _ = shop_engine.process_frame(&bgra, w, h);
        let t_shop = Instant::now();
        let shop_res = shop_engine.process_frame(&bgra, w, h);
        let shop_time = t_shop.elapsed();

        println!("\n--- BENCH (9 Slots) ---");
        let mut bench_occ = 0;
        let mut bench_empty = 0;
        let mut bench_unk = 0;
        for s in &res.bench {
            let state_str = match s.occupancy {
                OccupancyState::Empty => { bench_empty += 1; "EMPTY" },
                OccupancyState::Occupied => { bench_occ += 1; "OCCUPIED" },
                OccupancyState::Unknown => { bench_unk += 1; "UNKNOWN" },
            };
            println!("  Slot B{}: {:8} (rect: [{}, {}, {}x{}])", s.slot + 1, state_str, s.rect.x, s.rect.y, s.rect.width, s.rect.height);
        }
        println!("Bench counts: Occupied={}, Empty={}, Unknown={}", bench_occ, bench_empty, bench_unk);

        println!("\n--- BOARD (28 Hexes: 4 Rows x 7 Cols) ---");
        let mut board_occ = 0;
        let mut board_empty = 0;
        let mut board_unk = 0;
        for c in &res.board {
            let state_str = match c.occupancy {
                OccupancyState::Empty => { board_empty += 1; "EMPTY" },
                OccupancyState::Occupied => { board_occ += 1; "OCCUPIED" },
                OccupancyState::Unknown => { board_unk += 1; "UNKNOWN" },
            };
            let cx = c.rect.x + (c.rect.width as i32) / 2;
            let cy = c.rect.y + (c.rect.height as i32) / 2;
            println!("  Hex {:02} (R{} C{}): {:8} (center: [{}, {}], rect: [{}, {}, {}x{}])",
                c.hex, c.row, c.col, state_str, cx, cy, c.rect.x, c.rect.y, c.rect.width, c.rect.height);
        }
        println!("Board counts: Occupied={}, Empty={}, Unknown={}", board_occ, board_empty, board_unk);

        println!("\n--- TIMING BREAKDOWN ---");
        println!("  Board + Bench vision:     {:.3} ms", board_bench_time.as_secs_f64() * 1000.0);
        println!("  Shop vision (M14B.1):     {:.3} ms", shop_time.as_secs_f64() * 1000.0);
        println!("  Combined per-frame:       {:.3} ms", (board_bench_time + shop_time).as_secs_f64() * 1000.0);

        println!("\n--- SHOP STATUS CHECK (M14B.1 FROZEN) ---");
        for s in &shop_res.slots {
            println!("  Slot {}: {:?} (conf: {:.2})", s.index, s.champion_name, s.confidence);
        }
    } else {
        println!("1080p frame not found");
    }

    // 2. Audit 900p frame (current_screen.bmp)
    let p900_candidates = [
        Path::new("scratch/current_screen.bmp"),
        Path::new("../scratch/current_screen.bmp"),
    ];
    let p900 = p900_candidates.iter().find(|p| p.exists()).map(|p| *p);
    if let Some(p900) = p900 {
        println!("\nEvaluating 900p frame: {}", p900.display());
        let (bgra, w, h) = load_bmp_as_bgra(p900).expect("load 900p frame");
        println!("Loaded image: {}x{} ({} bytes)", w, h, bgra.len());

        let board_engine_900 = BoardVisionEngine::new();
        let _ = board_engine_900.process_frame(&bgra, w, h);
        let t_start = Instant::now();
        let res = board_engine_900.process_frame(&bgra, w, h);
        let board_bench_time = t_start.elapsed();

        println!("\n--- BENCH 900p (9 Slots) ---");
        let mut bench_occ = 0;
        let mut bench_empty = 0;
        let mut bench_unk = 0;
        for s in &res.bench {
            let state_str = match s.occupancy {
                OccupancyState::Empty => { bench_empty += 1; "EMPTY" },
                OccupancyState::Occupied => { bench_occ += 1; "OCCUPIED" },
                OccupancyState::Unknown => { bench_unk += 1; "UNKNOWN" },
            };
            println!("  Slot B{}: {:8} (rect: [{}, {}, {}x{}])", s.slot + 1, state_str, s.rect.x, s.rect.y, s.rect.width, s.rect.height);
        }
        println!("Bench 900p counts: Occupied={}, Empty={}, Unknown={}", bench_occ, bench_empty, bench_unk);

        println!("\n--- BOARD 900p (28 Hexes) ---");
        let mut occ_count = 0;
        let mut empty_count = 0;
        let mut unk_count = 0;
        for c in &res.board {
            let state_str = match c.occupancy {
                OccupancyState::Empty => { empty_count += 1; "EMPTY" },
                OccupancyState::Occupied => { occ_count += 1; "OCCUPIED" },
                OccupancyState::Unknown => { unk_count += 1; "UNKNOWN" },
            };
            if c.occupancy != OccupancyState::Empty {
                println!("  Hex {:02} (R{} C{}): {:8}", c.hex, c.row, c.col, state_str);
            }
        }
        println!("Board 900p counts: Occupied={}, Empty={}, Unknown={}", occ_count, empty_count, unk_count);
        println!("Board + Bench 900p processing time: {:.3} ms", board_bench_time.as_secs_f64() * 1000.0);
    }
}
