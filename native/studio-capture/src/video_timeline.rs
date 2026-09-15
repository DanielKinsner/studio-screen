//! Constant-frame-rate slots filled by capture timestamp.
//!
//! Windows Graphics Capture stamps every frame with the screen refresh it
//! came from (`SystemRelativeTime`) but delivers it a little later, and by a
//! varying amount. The recording used to write "the newest picture at each
//! slot deadline", so when refreshes happened to fall near slot boundaries
//! every frame was a coin flip between two slots: 30 fps content came out as
//! 1,3,1,3 frames instead of 2,2,2, and it stayed that way for a whole take
//! because the two clocks run at the same rate. Slots are now filled by the
//! frame's own stamp, and the slot grid starts half a slot before a refresh
//! so stamps sit mid-slot, as far from any boundary as possible.
use std::collections::VecDeque;

/// One written slot: its recording time, the picture to show (None only
/// before the first frame ever arrived), the screen-change share captured
/// since the previous slot, and whether a new picture landed in this slot.
pub struct Slot<F> {
    pub time: i64,
    pub frame: Option<F>,
    pub changed: f64,
    #[allow(dead_code)] // diagnostics and tests
    pub fresh: bool,
}

pub struct Slotter<F> {
    interval: i64,
    /// A slot is written once a later frame proves nothing more belongs to
    /// it, or once this much time has passed after it ended.
    grace: i64,
    next: i64,
    pending: VecDeque<(i64, F, f64)>,
    current: Option<(i64, F)>,
    changed: f64,
}

impl<F: Clone> Slotter<F> {
    pub fn new(interval: i64) -> Slotter<F> {
        Slotter {
            interval,
            grace: interval * 2,
            next: 0,
            pending: VecDeque::new(),
            current: None,
            changed: 0.0,
        }
    }

    /// Recording time of the next slot to be written.
    pub fn next_slot(&self) -> i64 {
        self.next
    }

    /// A captured frame, stamped in recording time. Frames arrive in stamp
    /// order; a frame older than the last written slot still becomes the
    /// newest picture if nothing newer has arrived.
    pub fn push(&mut self, stamp: i64, frame: F, changed: f64) {
        self.pending.push_back((stamp, frame, changed));
    }

    /// Replace the picture without touching the slot clock: used while paused,
    /// so the take resumes on the latest screen rather than a stale one.
    pub fn set_current(&mut self, frame: F, changed: f64) {
        self.pending.clear();
        self.current = Some((self.next, frame));
        self.changed += changed;
    }

    /// Slots that can be written at recording time `now`.
    pub fn due(&mut self, now: i64) -> Vec<Slot<F>> {
        let mut out = vec![];
        loop {
            let end = self.next + self.interval;
            let proven = self.pending.back().map(|(t, _, _)| *t >= end).unwrap_or(false);
            if !proven && now < end + self.grace {
                break;
            }
            out.push(self.write_slot());
        }
        out
    }

    /// Every slot up to and including `end`: closes the take.
    pub fn flush(&mut self, end: i64) -> Vec<Slot<F>> {
        let mut out = vec![];
        while self.next <= end {
            out.push(self.write_slot());
        }
        out
    }

    fn write_slot(&mut self) -> Slot<F> {
        let end = self.next + self.interval;
        let mut fresh = false;
        while let Some((stamp, _, _)) = self.pending.front() {
            if *stamp >= end {
                break;
            }
            let (stamp, frame, changed) = self.pending.pop_front().unwrap();
            self.changed += changed;
            if self.current.as_ref().map(|(t, _)| stamp >= *t).unwrap_or(true) {
                self.current = Some((stamp, frame));
                fresh = true;
            }
        }
        let slot = Slot {
            time: self.next,
            frame: self.current.as_ref().map(|(_, f)| f.clone()),
            changed: self.changed,
            fresh,
        };
        self.changed = 0.0;
        self.next = end;
        slot
    }
}

/// The recording's zero point: the latest time at or before `begin` that
/// puts screen refreshes (`stamp` and every `interval` before or after it)
/// exactly half a slot into their slots.
pub fn aligned_base(begin: i64, stamp: i64, interval: i64) -> i64 {
    let target = stamp - interval / 2;
    begin - (begin - target).rem_euclid(interval)
}

#[cfg(test)]
mod tests {
    use super::*;
    const I: i64 = 166_667; // 1/60 s in 100 ns units

    /// Frame ids per slot for a source refreshing every `period` slots, with
    /// stamps mid-slot and delivery late by a varying 1-12 ms.
    fn run(period: i64, count: usize) -> Vec<usize> {
        let mut s: Slotter<usize> = Slotter::new(I);
        let mut seed = 99u64;
        let mut ids = vec![];
        for k in 0..count {
            let stamp = k as i64 * period * I + I / 2;
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let delay = 10_000 + (seed >> 33) as i64 % 110_000;
            // The loop polls every 3 ms; the frame is seen at stamp + delay.
            let seen = stamp + delay;
            for slot in s.due(seen - 1) {
                ids.push(slot.frame.unwrap());
            }
            s.push(stamp, k, 1.0);
            for slot in s.due(seen) {
                ids.push(slot.frame.unwrap());
            }
        }
        for slot in s.flush(count as i64 * period * I - I) {
            ids.push(slot.frame.unwrap());
        }
        ids
    }

    fn runs(ids: &[usize]) -> Vec<usize> {
        let mut out = vec![];
        let mut n = 1;
        for w in ids.windows(2) {
            if w[0] == w[1] { n += 1 } else { out.push(n); n = 1 }
        }
        out.push(n);
        out
    }

    #[test]
    fn sixty_hz_source_lands_one_frame_per_slot() {
        let ids = run(1, 600);
        assert_eq!(ids, (0..600).collect::<Vec<_>>());
    }

    #[test]
    fn thirty_fps_content_holds_every_frame_for_two_slots() {
        let ids = run(2, 300);
        assert_eq!(ids.len(), 600);
        assert!(runs(&ids).iter().all(|&r| r == 2), "{:?}", runs(&ids));
    }

    /// The old rule, for the record: newest picture at each deadline, judged
    /// by delivery time. Refreshes near a boundary flip between slots.
    #[test]
    fn newest_at_deadline_flips_frames_near_boundaries() {
        let mut seed = 7u64;
        let mut ids = vec![];
        let mut latest = 0usize;
        let mut next = 0i64;
        for k in 0..300usize {
            let stamp = k as i64 * 2 * I; // refresh right on a slot boundary
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let seen = stamp + 10_000 + (seed >> 33) as i64 % 110_000;
            while next <= seen - 1 { ids.push(latest); next += I; }
            latest = k;
            while next <= seen { ids.push(latest); next += I; }
        }
        let r = runs(&ids);
        assert!(r.iter().any(|&x| x != 2), "old rule unexpectedly clean: {r:?}");
    }

    #[test]
    fn late_frame_never_moves_an_earlier_slot_but_updates_the_picture() {
        let mut s: Slotter<u32> = Slotter::new(I);
        s.push(I / 2, 1, 1.0);
        // Slot 0 written by grace before frame 2 (stamped in slot 1) shows up.
        let a = s.due(I * 4);
        assert_eq!(a.iter().map(|x| (x.time, x.frame.unwrap())).collect::<Vec<_>>(), vec![(0, 1), (I, 1)]);
        s.push(I + I / 2, 2, 1.0);
        let b = s.due(I * 5);
        assert_eq!(b.len(), 1);
        assert_eq!((b[0].time, b[0].frame.unwrap(), b[0].fresh), (2 * I, 2, true));
    }

    #[test]
    fn static_screen_repeats_the_current_picture() {
        let mut s: Slotter<u32> = Slotter::new(I);
        s.push(I / 2, 7, 0.4);
        let slots = s.due(60 * I + s.grace);
        assert_eq!(slots.len(), 60);
        assert!(slots.iter().all(|x| x.frame == Some(7)));
        assert!(slots[0].fresh && (slots[0].changed - 0.4).abs() < 1e-9);
        assert!(slots[1..].iter().all(|x| !x.fresh && x.changed == 0.0));
    }

    #[test]
    fn paused_picture_replaces_pending_frames() {
        let mut s: Slotter<u32> = Slotter::new(I);
        s.push(I / 2, 1, 1.0);
        s.push(I + I / 2, 2, 1.0);
        s.set_current(9, 0.5);
        let slots = s.due(5 * I);
        assert!(slots.iter().all(|x| x.frame == Some(9)), "pause must resume on the latest picture");
        assert!((slots[0].changed - 0.5).abs() < 1e-9);
    }

    #[test]
    fn aligned_base_puts_refreshes_mid_slot() {
        let mut seed = 3u64;
        for _ in 0..1000 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let stamp = (seed >> 20) as i64 % 100_000_000;
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let begin = stamp + (seed >> 20) as i64 % 30_000_000;
            let base = aligned_base(begin, stamp, I);
            assert!(base <= begin && begin - base < I, "base {base} begin {begin}");
            assert_eq!((stamp - base).rem_euclid(I), I / 2);
        }
    }
}
