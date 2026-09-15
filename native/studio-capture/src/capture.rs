//! Windows Graphics Capture: a monitor or window, without the cursor or the
//! yellow capture border, cropped on the GPU.
use crate::util::SendBox;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use windows::core::{IInspectable, Interface, Result, HSTRING};
use windows::Foundation::Metadata::ApiInformation;
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::*;
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::WinRT::Direct3D11::*;
use windows::Win32::System::WinRT::Graphics::Capture::*;

pub struct Gpu {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub winrt: IDirect3DDevice,
    pub adapter: String,
}

pub fn gpu() -> Result<Gpu> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let device = device.unwrap();
    let context = context.unwrap();
    // The capture callback and Media Foundation share this device.
    unsafe {
        let _ = device.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true);
    }
    let dxgi: IDXGIDevice = device.cast()?;
    let adapter = unsafe {
        let d = dxgi.GetAdapter()?.GetDesc()?;
        String::from_utf16_lossy(&d.Description)
            .trim_end_matches('\0')
            .to_string()
    };
    let winrt: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
    Ok(Gpu {
        device,
        context,
        winrt,
        adapter,
    })
}

pub enum Target {
    Monitor(HMONITOR),
    Window(HWND),
}

/// Area of the capture item that is recorded, in item pixels.
#[derive(Clone, Copy)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Captured frames wait here, in order, until the recording loop drains them.
/// A stall longer than this many refreshes loses the oldest (counted).
pub const QUEUE_DEPTH: usize = 12;

#[derive(Default)]
pub struct Frames {
    /// (capture time in QPC 100 ns, cropped texture, changed share 0..1).
    pub queue: VecDeque<(i64, ID3D11Texture2D, f64)>,
    pub captured: u64,
    pub dropped: u64,
    pub closed: bool,
    pub error: Option<String>,
    size: SizeInt32,
}
unsafe impl Send for Frames {}

pub struct Capture {
    pub session: GraphicsCaptureSession,
    pub pool: Direct3D11CaptureFramePool,
    #[allow(dead_code)] // keeps the capture item alive for the session
    pub item: GraphicsCaptureItem,
    pub frames: Arc<Mutex<Frames>>,
    pub crop: Crop,
    pub dirty_regions: bool,
    pub border_hidden: bool,
}

fn texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
    zeroed: bool,
) -> Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_DEFAULT,
        BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
        CPUAccessFlags: 0,
        MiscFlags: 0,
    };
    let zeros = if zeroed {
        vec![0u8; (width * height * 4) as usize]
    } else {
        vec![]
    };
    let data = D3D11_SUBRESOURCE_DATA {
        pSysMem: zeros.as_ptr() as _,
        SysMemPitch: width * 4,
        SysMemSlicePitch: 0,
    };
    let mut out: Option<ID3D11Texture2D> = None;
    unsafe {
        device.CreateTexture2D(
            &desc,
            if zeroed { Some(&data) } else { None },
            Some(&mut out),
        )?;
    }
    Ok(out.unwrap())
}

pub fn request_borderless() -> i32 {
    GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless)
        .and_then(|op| op.join())
        .map(|status| status.0)
        .unwrap_or(-1)
}

pub fn dirty_regions_supported() -> bool {
    ApiInformation::IsPropertyPresent(
        &HSTRING::from("Windows.Graphics.Capture.GraphicsCaptureSession"),
        &HSTRING::from("DirtyRegionMode"),
    )
    .unwrap_or(false)
}

pub fn start(
    gpu: &Gpu,
    target: &Target,
    region: Option<[f64; 4]>,
    cursor: bool,
) -> Result<Capture> {
    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    let item: GraphicsCaptureItem = unsafe {
        match target {
            Target::Monitor(h) => interop.CreateForMonitor(*h)?,
            Target::Window(h) => interop.CreateForWindow(*h)?,
        }
    };
    let size = item.Size()?;
    let (w, h) = (size.Width.max(2) as f64, size.Height.max(2) as f64);
    let [rx, ry, rw, rh] = region.unwrap_or([0.0, 0.0, 1.0, 1.0]);
    let x = ((rx.clamp(0.0, 1.0) * w).round() as u32).min(size.Width as u32 - 2);
    let y = ((ry.clamp(0.0, 1.0) * h).round() as u32).min(size.Height as u32 - 2);
    let crop = Crop {
        x,
        y,
        width: (((rw.clamp(0.0, 1.0) * w).round() as u32).min(size.Width as u32 - x) & !1).max(2),
        height: (((rh.clamp(0.0, 1.0) * h).round() as u32).min(size.Height as u32 - y) & !1)
            .max(2),
    };

    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
        &gpu.winrt,
        DirectXPixelFormat::B8G8R8A8UIntNormalized,
        2,
        size,
    )?;
    let session = pool.CreateCaptureSession(&item)?;
    session.SetIsCursorCaptureEnabled(cursor)?;
    let border_hidden =
        session.SetIsBorderRequired(false).is_ok() && !session.IsBorderRequired().unwrap_or(true);
    let dirty_regions = dirty_regions_supported()
        && session
            .SetDirtyRegionMode(GraphicsCaptureDirtyRegionMode::ReportOnly)
            .is_ok();

    let frames = Arc::new(Mutex::new(Frames {
        size,
        ..Default::default()
    }));
    let black = texture(&gpu.device, crop.width, crop.height, true)?;
    let shared = frames.clone();
    let handles = SendBox((
        gpu.device.clone(),
        gpu.context.clone(),
        gpu.winrt.clone(),
        black,
    ));
    let area = (crop.width as f64) * (crop.height as f64);
    pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
        move |sender, _| {
            let (device, context, winrt, black) = handles.get();
            let result: Result<()> = (|| {
                let pool = sender.ok()?;
                let frame = pool.TryGetNextFrame()?;
                let time = frame.SystemRelativeTime()?.Duration;
                let content = frame.ContentSize()?;
                let mut changed = if dirty_regions { 0.0 } else { 1.0 };
                if dirty_regions {
                    let rects = frame.DirtyRegions()?;
                    for i in 0..rects.Size()? {
                        let r = rects.GetAt(i)?;
                        let left = (r.X as i64).max(crop.x as i64);
                        let top = (r.Y as i64).max(crop.y as i64);
                        let right = ((r.X + r.Width) as i64).min((crop.x + crop.width) as i64);
                        let bottom = ((r.Y + r.Height) as i64).min((crop.y + crop.height) as i64);
                        if right > left && bottom > top {
                            changed += ((right - left) * (bottom - top)) as f64 / area;
                        }
                    }
                }
                let surface = frame.Surface()?;
                let source: ID3D11Texture2D = unsafe {
                    surface
                        .cast::<IDirect3DDxgiInterfaceAccess>()?
                        .GetInterface()?
                };
                let target = texture(device, crop.width, crop.height, false)?;
                // A window that shrank below its starting size is padded with black.
                let visible_w = (content.Width.max(0) as u32)
                    .saturating_sub(crop.x)
                    .min(crop.width);
                let visible_h = (content.Height.max(0) as u32)
                    .saturating_sub(crop.y)
                    .min(crop.height);
                unsafe {
                    if visible_w < crop.width || visible_h < crop.height {
                        context.CopyResource(&target, black);
                    }
                    if visible_w > 0 && visible_h > 0 {
                        context.CopySubresourceRegion(
                            &target,
                            0,
                            0,
                            0,
                            0,
                            &source,
                            0,
                            Some(&D3D11_BOX {
                                left: crop.x,
                                top: crop.y,
                                front: 0,
                                right: crop.x + visible_w,
                                bottom: crop.y + visible_h,
                                back: 1,
                            }),
                        );
                    }
                }
                frame.Close()?;
                let mut state = shared.lock().unwrap();
                if content.Width != state.size.Width || content.Height != state.size.Height {
                    // Windows can change size; keep the pool matched to the content.
                    state.size = content;
                    pool.Recreate(
                        winrt,
                        DirectXPixelFormat::B8G8R8A8UIntNormalized,
                        2,
                        content,
                    )?;
                }
                state.queue.push_back((time, target, changed.min(1.0)));
                if state.queue.len() > QUEUE_DEPTH {
                    state.queue.pop_front();
                    state.dropped += 1;
                }
                state.captured += 1;
                let _ = device;
                Ok(())
            })();
            if let Err(e) = result {
                shared.lock().unwrap().error = Some(format!("{e:?}"));
            }
            Ok(())
        },
    ))?;
    let closed = frames.clone();
    item.Closed(&TypedEventHandler::<GraphicsCaptureItem, IInspectable>::new(
        move |_, _| {
            closed.lock().unwrap().closed = true;
            Ok(())
        },
    ))?;
    session.StartCapture()?;
    Ok(Capture {
        session,
        pool,
        item,
        frames,
        crop,
        dirty_regions,
        border_hidden,
    })
}
