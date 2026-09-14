//! WASAPI loopback of the default output device ("what you hear").
use windows::core::Result;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::*;

pub struct Loopback {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    /// Channel count when the device refused 16-bit conversion and gives float.
    float_channels: Option<usize>,
}

pub struct Packet {
    /// 16-bit little-endian stereo PCM at 48 kHz.
    pub pcm: Vec<u8>,
    /// QPC time of the first sample, 100 ns.
    pub time: i64,
}

impl Loopback {
    pub fn open() -> Result<Loopback> {
        unsafe {
            let devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = devices.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
            let pcm16 = WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_PCM as u16,
                nChannels: 2,
                nSamplesPerSec: 48000,
                nAvgBytesPerSec: 192000,
                nBlockAlign: 4,
                wBitsPerSample: 16,
                cbSize: 0,
            };
            let flags = AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
            let (client, float_channels) = match client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                flags,
                2_000_000,
                0,
                &pcm16,
                None,
            ) {
                Ok(()) => (client, None),
                Err(_) => {
                    // Fall back to the device's own float mix format.
                    let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
                    let mix = client.GetMixFormat()?;
                    let channels = (*mix).nChannels as usize;
                    let r = client.Initialize(
                        AUDCLNT_SHAREMODE_SHARED,
                        AUDCLNT_STREAMFLAGS_LOOPBACK,
                        2_000_000,
                        0,
                        mix,
                        None,
                    );
                    CoTaskMemFree(Some(mix as _));
                    r?;
                    (client, Some(channels))
                }
            };
            let capture: IAudioCaptureClient = client.GetService()?;
            Ok(Loopback {
                client,
                capture,
                float_channels,
            })
        }
    }

    pub fn start(&self) -> Result<()> {
        unsafe { self.client.Start() }
    }

    pub fn stop(&self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }

    /// Everything captured since the last call.
    pub fn drain(&self) -> Result<Vec<Packet>> {
        let mut packets = vec![];
        unsafe {
            while self.capture.GetNextPacketSize()? > 0 {
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                let mut qpc = 0u64;
                self.capture.GetBuffer(
                    &mut data,
                    &mut frames,
                    &mut flags,
                    None,
                    Some(&mut qpc),
                )?;
                let count = frames as usize;
                let mut pcm = vec![0u8; count * 4];
                if flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) == 0 && !data.is_null() {
                    match self.float_channels {
                        None => std::ptr::copy_nonoverlapping(data, pcm.as_mut_ptr(), pcm.len()),
                        Some(channels) => {
                            let src = std::slice::from_raw_parts(data as *const f32, count * channels);
                            for f in 0..count {
                                for c in 0..2 {
                                    let v = src[f * channels + c.min(channels - 1)];
                                    let s = (v.clamp(-1.0, 1.0) * 32767.0) as i16;
                                    pcm[(f * 2 + c) * 2..(f * 2 + c) * 2 + 2]
                                        .copy_from_slice(&s.to_le_bytes());
                                }
                            }
                        }
                    }
                }
                self.capture.ReleaseBuffer(frames)?;
                // The QPC position is already in 100 ns units.
                packets.push(Packet {
                    pcm,
                    time: qpc as i64,
                });
            }
        }
        Ok(packets)
    }
}
