//! What a key press writes to the event log. Typed text never does: a
//! character key only records that typing happened, and a key is named only
//! when it's part of a real shortcut (Ctrl, Alt or Win held, or a function key).

use std::collections::HashSet;

const CTRL: [u32; 3] = [0x11, 0xA2, 0xA3];
const ALT: [u32; 3] = [0x12, 0xA4, 0xA5];
const SHIFT: [u32; 3] = [0x10, 0xA0, 0xA1];
const WIN: [u32; 2] = [0x5B, 0x5C];
const RIGHT_ALT: u32 = 0xA5;

#[derive(Debug, PartialEq)]
pub enum Key {
    /// A modifier on its own: nothing is logged.
    Modifier,
    /// A shortcut, logged with its label ("Ctrl + S").
    Shortcut(String),
    /// Typing activity, logged without saying which key.
    Typing,
    /// Anything else: nothing is logged.
    Other,
}

/// Classifies `vk` (just pressed) given every key currently held, `vk` included.
pub fn classify(vk: u32, pressed: &HashSet<u32>) -> Key {
    if CTRL.contains(&vk) || ALT.contains(&vk) || SHIFT.contains(&vk) || WIN.contains(&vk) {
        return Key::Modifier;
    }
    let held = |keys: &[u32]| keys.iter().any(|k| pressed.contains(k));
    let (ctrl, alt, shift, win) = (held(&CTRL), held(&ALT), held(&SHIFT), held(&WIN));
    // AltGr (German, French, Nordic... layouts) reaches the hook as left Ctrl
    // plus right Alt, and with a character key it types text (@ { } €), so it
    // counts as typing. A real Ctrl + right Alt shortcut is rare; logging it
    // as typing loses only its label, never leaks a key.
    if ctrl && pressed.contains(&RIGHT_ALT) && is_typing_key(vk) {
        return Key::Typing;
    }
    let function = (0x70..=0x87).contains(&vk);
    match key_label(vk) {
        Some(label) if ctrl || alt || win || function => Key::Shortcut(format!(
            "{}{}{}{}{}",
            if ctrl { "Ctrl + " } else { "" },
            if alt { "Alt + " } else { "" },
            if win { "Win + " } else { "" },
            if shift { "Shift + " } else { "" },
            label
        )),
        _ if is_typing_key(vk) => Key::Typing,
        _ => Key::Other,
    }
}

fn key_label(vk: u32) -> Option<String> {
    Some(match vk {
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk)?.to_string(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x20 => "Space".into(),
        0x0D => "Enter".into(),
        0x09 => "Tab".into(),
        0x1B => "Esc".into(),
        0x08 => "Backspace".into(),
        0x2E => "Delete".into(),
        0x25 => "←".into(),
        0x26 => "↑".into(),
        0x27 => "→".into(),
        0x28 => "↓".into(),
        0x24 => "Home".into(),
        0x23 => "End".into(),
        0x21 => "Page Up".into(),
        0x22 => "Page Down".into(),
        _ => return None,
    })
}

fn is_typing_key(vk: u32) -> bool {
    matches!(vk, 0x20 | 0x30..=0x39 | 0x41..=0x5A | 0x60..=0x6F | 0xBA..=0xC0 | 0xDB..=0xDF | 0xE2)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEFT_CTRL: u32 = 0xA2;
    const LEFT_ALT: u32 = 0xA4;
    const LEFT_SHIFT: u32 = 0xA0;

    /// Presses `vk` while `held` are down, as the recording loop sees it.
    fn press(held: &[u32], vk: u32) -> Key {
        let mut pressed: HashSet<u32> = held.iter().copied().collect();
        pressed.insert(vk);
        classify(vk, &pressed)
    }

    #[test]
    fn ctrl_letter_is_a_named_shortcut() {
        assert_eq!(press(&[LEFT_CTRL], 0x43), Key::Shortcut("Ctrl + C".into()));
        assert_eq!(press(&[LEFT_CTRL, LEFT_SHIFT], 0x53), Key::Shortcut("Ctrl + Shift + S".into()));
    }

    #[test]
    fn plain_and_shifted_letters_are_anonymous_typing() {
        assert_eq!(press(&[], 0x41), Key::Typing);
        assert_eq!(press(&[LEFT_SHIFT], 0x41), Key::Typing);
        assert_eq!(press(&[], 0xBE), Key::Typing);
    }

    #[test]
    fn altgr_characters_are_typing_not_shortcuts() {
        // AltGr on German, French, Nordic... layouts arrives as left Ctrl +
        // right Alt. AltGr+Q is @, AltGr+7 is {, AltGr+E is €: typed text,
        // which must never be logged as "Ctrl + Alt + Q".
        for vk in [0x51, 0x37, 0x45, 0x30, 0xDB] {
            assert_eq!(press(&[LEFT_CTRL, RIGHT_ALT], vk), Key::Typing, "vk {vk:#x}");
        }
    }

    #[test]
    fn ctrl_with_left_alt_is_still_a_shortcut() {
        assert_eq!(press(&[LEFT_CTRL, LEFT_ALT], 0x51), Key::Shortcut("Ctrl + Alt + Q".into()));
        assert_eq!(press(&[LEFT_ALT], 0x09), Key::Shortcut("Alt + Tab".into()));
    }

    #[test]
    fn function_keys_are_shortcuts_even_alone() {
        assert_eq!(press(&[], 0x74), Key::Shortcut("F5".into()));
    }

    #[test]
    fn modifiers_alone_log_nothing() {
        assert_eq!(press(&[], LEFT_CTRL), Key::Modifier);
        assert_eq!(press(&[LEFT_CTRL], RIGHT_ALT), Key::Modifier);
    }
}
