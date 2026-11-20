//! Reader for `java.util.Properties` files, as `Properties.load(InputStream)` reads them:
//! ISO-8859-1 bytes, `\uXXXX` escapes (UTF-16 units, so surrogate pairs become one character),
//! `\t \n \r \f` escapes, any other `\x` → `x`, `#`/`!` comment lines, line continuation with an odd
//! number of trailing backslashes, and the key ending at the first unescaped `=`, `:` or whitespace.
//!
//! The `java-properties` crate used before decoded each `\uXXXX` on its own and rejected the
//! surrogate pairs Java writes for emoji (stream titles like "🎬" in `nuvio_watch_progress`), so the
//! library migration stopped. This reader combines the UTF-16 units like the JDK; on a real
//! installation it gave the same pairs as that crate for every other store. An invalid sequence is
//! decoded leniently instead of failing the whole file.

use std::collections::HashMap;

/// Natural lines → logical lines: a line ending with an odd number of backslashes continues on the
/// next one (whose leading whitespace is dropped); comment lines never continue.
fn logical_lines(text: &[char]) -> Vec<Vec<char>> {
    let mut out = Vec::new();
    let mut current: Vec<char> = Vec::new();
    let mut skip_whitespace = true;
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        if c == '\n' || c == '\r' {
            if c == '\r' && text.get(i + 1) == Some(&'\n') {
                i += 1;
            }
            i += 1;
            skip_whitespace = true;
            let comment = matches!(current.first(), Some('#' | '!'));
            let trailing = current.iter().rev().take_while(|&&ch| ch == '\\').count();
            if trailing % 2 == 1 && !comment {
                current.pop();
                continue;
            }
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            continue;
        }
        if skip_whitespace && matches!(c, ' ' | '\t' | '\u{c}') {
            i += 1;
            continue;
        }
        skip_whitespace = false;
        current.push(c);
        i += 1;
    }
    let trailing = current.iter().rev().take_while(|&&ch| ch == '\\').count();
    if trailing % 2 == 1 {
        current.pop();
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// Unescapes `chars` into UTF-16 units, then decodes them (lone surrogates become U+FFFD).
fn unescape(chars: &[char]) -> String {
    let mut units: Vec<u16> = Vec::with_capacity(chars.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c != '\\' || i + 1 == chars.len() {
            if c != '\\' {
                units.push(c as u16);
            }
            i += 1;
            continue;
        }
        let next = chars[i + 1];
        i += 2;
        match next {
            't' => units.push(b'\t' as u16),
            'n' => units.push(b'\n' as u16),
            'r' => units.push(b'\r' as u16),
            'f' => units.push(0x0c),
            'u' => {
                let hex: String = chars.iter().skip(i).take(4).collect();
                match (hex.len() == 4).then(|| u16::from_str_radix(&hex, 16).ok()).flatten() {
                    Some(unit) => {
                        units.push(unit);
                        i += 4;
                    }
                    // The JDK throws here; a lenient reader keeps the text as written.
                    None => units.push(b'u' as u16),
                }
            }
            other => units.push(other as u16),
        }
    }
    String::from_utf16_lossy(&units)
}

pub fn parse(bytes: &[u8]) -> HashMap<String, String> {
    // ISO-8859-1: every byte is the code point of the same value.
    let text: Vec<char> = bytes.iter().map(|&b| b as char).collect();
    let mut out = HashMap::new();
    for line in logical_lines(&text) {
        let first = line.iter().position(|c| !matches!(c, ' ' | '\t' | '\u{c}'));
        let Some(start) = first else { continue };
        if matches!(line[start], '#' | '!') {
            continue;
        }
        let line = &line[start..];
        // Key: up to the first unescaped separator.
        let mut k = 0;
        let mut escaped = false;
        while k < line.len() {
            let c = line[k];
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if matches!(c, '=' | ':' | ' ' | '\t' | '\u{c}') {
                break;
            }
            k += 1;
        }
        let key = unescape(&line[..k]);
        let mut v = k;
        while v < line.len() && matches!(line[v], ' ' | '\t' | '\u{c}') {
            v += 1;
        }
        if v < line.len() && matches!(line[v], '=' | ':') {
            v += 1;
            while v < line.len() && matches!(line[v], ' ' | '\t' | '\u{c}') {
                v += 1;
            }
        }
        out.insert(key, unescape(&line[v.min(line.len())..]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_jdk_rules() {
        let file = "#Thu Nov 19\n! other comment\n  a=1\nb\\:c = x\\:y\\=z\nlong=one \\\n    two\nemoji=\\uD83C\\uDFAC caf\\u00E9\nbad=\\uZZ\njson={\"t\"\\:\"A\\\\u00e9\"}\nempty=\ntab\\ key\tv\n";
        let map = parse(file.as_bytes());
        assert_eq!(map["a"], "1");
        assert_eq!(map["b:c"], "x:y=z");
        assert_eq!(map["long"], "one two");
        assert_eq!(map["emoji"], "🎬 café");
        assert_eq!(map["bad"], "uZZ");
        assert_eq!(map["json"], r#"{"t":"A\u00e9"}"#);
        assert_eq!(map["empty"], "");
        assert_eq!(map["tab key"], "v");
        assert_eq!(map.len(), 8);
    }

    #[test]
    fn latin1_bytes_are_code_points() {
        assert_eq!(parse(&[b'k', b'=', 0xE9])["k"], "é");
    }
}
