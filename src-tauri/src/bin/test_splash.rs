use tft_strategist_lib::shop_vision::{
    extract_signature_from_bgra, PixelRect,
};

fn main() {
    let bmp_bytes = std::fs::read("C:/Users/K/.gemini/antigravity-ide/brain/7a8cb10b-2128-4285-9a79-13849c56b2e2/scratch/card_0.bmp").unwrap();
    let card_bgra = bmp_bytes[54..].to_vec();
    // card art: x=0..192, y=4..114
    let card_rect = PixelRect { x: 0, y: 4, width: 192, height: 110 };
    let card_sig = extract_signature_from_bgra(&card_bgra, 192, 154, card_rect).unwrap();

    let splash_bytes = std::fs::read("scratch/akali_splash_centered.png").unwrap();
    let decoder = png::Decoder::new(&splash_bytes[..]);
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).unwrap();
    let w = info.width;
    let h = info.height;
    let mut bgra = vec![0u8; (w * h * 4) as usize];
    for i in (0..buf.len()).step_by(4) {
        bgra[i] = buf[i + 2];
        bgra[i + 1] = buf[i + 1];
        bgra[i + 2] = buf[i];
        bgra[i + 3] = buf[i + 3];
    }

    // In 1024x512 splash, test different crops
    for x_pct in [0.05, 0.10, 0.15, 0.20, 0.25] {
        for w_pct in [0.55, 0.60, 0.65, 0.70, 0.75] {
            let splash_rect = PixelRect {
                x: (w as f32 * x_pct) as i32,
                y: (h as f32 * 0.05) as i32,
                width: (w as f32 * w_pct) as u32,
                height: (h as f32 * 0.85) as u32,
            };
            if let Some(splash_sig) = extract_signature_from_bgra(&bgra, w, h, splash_rect) {
                let color = card_sig.color_similarity(&splash_sig);
                let spatial = card_sig.spatial_similarity(&splash_sig);
                let total = card_sig.match_score(&splash_sig);
                println!("x={:.2}, w={:.2} => total={:.3}, color={:.3}, spatial={:.3}", x_pct, w_pct, total, color, spatial);
            }
        }
    }
}
