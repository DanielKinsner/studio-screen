//! Media Foundation sink writer: hardware H.264 + AAC into a fragmented MP4.
//! Fragments are flushed about every 0.3 s, so a killed recording stays playable.
use crate::capture::Gpu;
use windows::core::{Interface, Result, HSTRING};
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::Media::MediaFoundation::*;

pub struct Encoder {
    writer: IMFSinkWriter,
    video: u32,
    audio: Option<u32>,
    _manager: IMFDXGIDeviceManager,
}

unsafe fn audio_type(subtype: &windows::core::GUID) -> Result<IMFMediaType> {
    let t = MFCreateMediaType()?;
    t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
    t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
    t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
    t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, 48000)?;
    t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 2)?;
    if *subtype == MFAudioFormat_AAC {
        t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 24000)?;
    } else {
        t.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 4)?;
        t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 192000)?;
    }
    Ok(t)
}

unsafe fn video_type(
    subtype: &windows::core::GUID,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<IMFMediaType> {
    let t = MFCreateMediaType()?;
    t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
    t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
    t.SetUINT64(&MF_MT_FRAME_SIZE, ((width as u64) << 32) | height as u64)?;
    t.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
    t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
    Ok(t)
}

impl Encoder {
    pub fn create(
        gpu: &Gpu,
        path: &str,
        width: u32,
        height: u32,
        fps: u32,
        with_audio: bool,
    ) -> Result<Encoder> {
        unsafe {
            let mut token = 0u32;
            let mut manager: Option<IMFDXGIDeviceManager> = None;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
            let manager = manager.unwrap();
            manager.ResetDevice(&gpu.device, token)?;
            let mut attrs: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut attrs, 4)?;
            let attrs = attrs.unwrap();
            attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)?;
            attrs.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_FMPEG4)?;
            attrs.SetUnknown(&MF_SINK_WRITER_D3D_MANAGER, &manager)?;
            attrs.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1)?;
            let writer =
                MFCreateSinkWriterFromURL(&HSTRING::from(path), None::<&IMFByteStream>, &attrs)?;

            // Screen content is mostly sharp text: give it generous bitrate.
            let bitrate = ((width as f64) * (height as f64) * (fps as f64) * 0.08)
                .clamp(8e6, 80e6) as u32;
            let out = video_type(&MFVideoFormat_H264, width, height, fps)?;
            out.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            // Hardware encoders default to Constrained Baseline; High is sharper.
            out.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
            let video = writer.AddStream(&out)?;
            let input = video_type(&MFVideoFormat_RGB32, width, height, fps)?;
            let mut params: Option<IMFAttributes> = None;
            MFCreateAttributes(&mut params, 1)?;
            let params = params.unwrap();
            // A key frame every two seconds keeps scrubbing in the editor quick.
            params.SetUINT32(&CODECAPI_AVEncMPVGOPSize, fps * 2)?;
            writer.SetInputMediaType(video, &input, Some(&params))?;

            let audio = if with_audio {
                let stream = writer.AddStream(&audio_type(&MFAudioFormat_AAC)?)?;
                writer.SetInputMediaType(
                    stream,
                    &audio_type(&MFAudioFormat_PCM)?,
                    None::<&IMFAttributes>,
                )?;
                Some(stream)
            } else {
                None
            };
            writer.BeginWriting()?;
            Ok(Encoder {
                writer,
                video,
                audio,
                _manager: manager,
            })
        }
    }

    pub fn write_video(&self, texture: &ID3D11Texture2D, time: i64, duration: i64) -> Result<()> {
        unsafe {
            let buffer = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, texture, 0, false)?;
            buffer.SetCurrentLength(buffer.cast::<IMF2DBuffer>()?.GetContiguousLength()?)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(duration)?;
            self.writer.WriteSample(self.video, &sample)
        }
    }

    pub fn has_audio(&self) -> bool {
        self.audio.is_some()
    }

    /// Writes 16-bit stereo PCM at `time`; returns its duration (100 ns).
    pub fn write_audio(&self, pcm: &[u8], time: i64) -> Result<i64> {
        let Some(stream) = self.audio else {
            return Ok(0);
        };
        let frames = (pcm.len() / 4) as i64;
        if frames == 0 {
            return Ok(0);
        }
        let duration = frames * 10_000_000 / 48000;
        unsafe {
            let buffer = MFCreateMemoryBuffer(pcm.len() as u32)?;
            let mut data: *mut u8 = std::ptr::null_mut();
            buffer.Lock(&mut data, None, None)?;
            std::ptr::copy_nonoverlapping(pcm.as_ptr(), data, pcm.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(pcm.len() as u32)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(duration)?;
            self.writer.WriteSample(stream, &sample)?;
        }
        Ok(duration)
    }

    pub fn finalize(&self) -> Result<()> {
        unsafe { self.writer.Finalize() }
    }
}

/// True when a hardware H.264 encoder is installed.
pub fn hardware_h264() -> bool {
    unsafe {
        let output = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count = 0u32;
        let ok = MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            None,
            Some(&output),
            &mut activates,
            &mut count,
        )
        .is_ok();
        if !activates.is_null() {
            for i in 0..count as usize {
                std::ptr::drop_in_place(activates.add(i));
            }
            windows::Win32::System::Com::CoTaskMemFree(Some(activates as _));
        }
        ok && count > 0
    }
}
