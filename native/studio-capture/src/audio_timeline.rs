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
}
