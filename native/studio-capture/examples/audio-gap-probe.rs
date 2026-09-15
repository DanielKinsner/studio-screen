#![allow(dead_code)]
// Synthetic encoder probe: no screen capture or input hooks.
#[path = "../src/audio_timeline.rs"]
mod audio_timeline;
#[path = "../src/capture.rs"]
mod capture;
#[path = "../src/encoder.rs"]
mod encoder;
#[path = "../src/util.rs"]
mod util;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::WinRT::*;

fn main() -> windows::core::Result<()> {
    unsafe {
        RoInitialize(RO_INIT_MULTITHREADED)?;
        MFStartup(MF_VERSION, MFSTARTUP_FULL)?;
    }
    let args: Vec<String> = std::env::args().collect();
    let raw = args.get(2).map(|s| s == "raw").unwrap_or(false);
    let gpu = capture::gpu()?;
    let encoder = encoder::Encoder::create(&gpu, &args[1], 640, 360, 60, true)?;
    let desc = D3D11_TEXTURE2D_DESC {
        Width: 640,
        Height: 360,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        ..Default::default()
    };
    let pixels = vec![0u8; 640 * 360 * 4];
    let data = D3D11_SUBRESOURCE_DATA {
        pSysMem: pixels.as_ptr() as _,
        SysMemPitch: 640 * 4,
        SysMemSlicePitch: 0,
    };
    let mut texture = None;
    unsafe {
        gpu.device
            .CreateTexture2D(&desc, Some(&data), Some(&mut texture))?;
    }
    let texture = texture.unwrap();
    let mut next_video = 0;
    let mut audio_next = 0;
    for packet in 0..300 {
        let time = packet * 100_000;
        while next_video <= time {
            encoder.write_video(&texture, next_video, 166_666)?;
            next_video += 166_666;
        }
        // Eight missing 10 ms silent packets before the 1 s tone.
        let gap = (10..90).contains(&packet) && packet % 10 == 5;
        if gap {
            continue;
        }
        let silence = audio_timeline::gap_frames(audio_next, time);
        if !raw && silence > 0 {
            encoder.write_audio(&vec![0u8; silence * 4], audio_next)?;
        }
        let mut pcm = Vec::with_capacity(480 * 4);
        for sample in 0..480 {
            let t = packet as f64 / 100.0 + sample as f64 / 48000.0;
            let value = if (1.0..1.2).contains(&t) {
                (16000.0 * (t * 1000.0 * std::f64::consts::TAU).sin()) as i16
            } else {
                0
            };
            pcm.extend_from_slice(&value.to_le_bytes());
            pcm.extend_from_slice(&value.to_le_bytes());
        }
        audio_next = time + encoder.write_audio(&pcm, time)?;
    }
    encoder.finalize()?;
    Ok(())
}
