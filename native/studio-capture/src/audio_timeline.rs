/// Number of silent stereo frames needed before the next 48 kHz packet.
/// Media Foundation's AAC encoder concatenates PCM; timestamps alone do not
/// preserve gaps, including those shorter than one AAC frame (~21 ms).
pub fn gap_frames(next: i64, time: i64) -> usize {
    if time > next {
        ((time - next) as i128 * 48000 / 10_000_000) as usize
    } else {
        0
    }
}

/// Loopback packets are one continuous stream; their QPC stamps jitter by a
/// few tens of microseconds. Stamps within this far of the expected time are
/// taken as contiguous rather than trimmed or padded, which used to bleed
/// ~16-27 samples a second (audio ran ~34 ms/min fast against the picture).
/// A genuinely missing 10 ms packet or a resume after a pause is far outside it.
pub const TOLERANCE: i64 = 20_000; // 2 ms in 100 ns units

#[derive(Debug, PartialEq)]
pub enum Align {
    /// Write the whole packet right after what was written; ignore its stamp.
    Contiguous,
    /// Write this many silent frames first, then the packet at its stamp.
    Fill(usize),
    /// Drop this many leading frames (already written), then continue.
    Trim(usize),
    /// Everything in the packet was already written.
    Drop,
}

/// How to place a packet stamped `time` holding `frames` after the track has
/// been written up to `next` (both 100 ns).
pub fn align(next: i64, time: i64, frames: usize) -> Align {
    let length = frames as i64 * 10_000_000 / 48000;
    if time + length <= next {
        return Align::Drop;
    }
    if (time - next).abs() <= TOLERANCE {
        return Align::Contiguous;
    }
    if time < next {
        let skip = (((next - time) * 48000 + 9_999_999) / 10_000_000) as usize;
        return if skip >= frames { Align::Drop } else { Align::Trim(skip) };
    }
    Align::Fill(gap_frames(next, time))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_short_gaps_before_aac_encoding() {
        assert_eq!(gap_frames(1_000_000, 1_100_000), 480);
        assert_eq!(gap_frames(0, 200_000), 960);
        assert_eq!(gap_frames(0, 3_000_000), 14400);
    }
    #[test]
    fn no_silence_for_contiguous_overlapping_or_subsample_packets() {
        assert_eq!(gap_frames(1_000_000, 1_000_000), 0);
        assert_eq!(gap_frames(1_000_000, 900_000), 0);
        assert_eq!(gap_frames(0, 100), 0);
    }

    /// Replays a minute of 10 ms packets whose stamps jitter like the real
    /// device (measured ±150 ticks); the written sample count must equal the
    /// captured sample count. The old ceil-trim / floor-fill arithmetic lost
    /// about 16 samples a second here.
    #[test]
    fn jittered_stamps_lose_no_samples() {
        let mut next = 0i64;
        let mut written = 0usize;
        let mut seed = 12345u64;
        for k in 0..6000i64 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let jitter = (seed >> 33) as i64 % 301 - 150;
            let time = k * 100_000 + jitter;
            match align(next, time, 480) {
                Align::Contiguous => {
                    written += 480;
                    next += 100_000;
                }
                other => panic!("packet {k} at {jitter:+} ticks was {other:?}"),
            }
        }
        assert_eq!(written, 6000 * 480);
    }

    #[test]
    fn real_gaps_and_overlaps_are_still_corrected() {
        // Eight missing 10 ms packets (the 9/14 encoder regression).
        assert_eq!(align(1_000_000, 1_100_000, 480), Align::Fill(480));
        assert_eq!(align(0, 800_000, 480), Align::Fill(3840));
        // A resume that replays 5 ms already written.
        assert_eq!(align(1_000_000, 950_000, 480), Align::Trim(240));
        // Fully replayed packet, and one that overlaps by exactly its length.
        assert_eq!(align(1_000_000, 850_000, 480), Align::Drop);
        assert_eq!(align(1_000_000, 900_000, 480), Align::Drop);
        // Just inside and just outside the tolerance.
        assert_eq!(align(1_000_000, 1_000_000 - TOLERANCE, 480), Align::Contiguous);
        assert_eq!(align(1_000_000, 1_000_000 + TOLERANCE, 480), Align::Contiguous);
        assert_eq!(align(1_000_000, 1_000_000 - TOLERANCE - 1, 480), Align::Trim(97));
        assert_eq!(align(1_000_000, 1_000_000 + TOLERANCE + 1, 480), Align::Fill(96));
    }
}
