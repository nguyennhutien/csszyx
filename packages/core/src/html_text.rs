//! The `class` attributes of an HTML text, read by the WHATWG tokenizer's
//! rules: only what decides where a start tag's attributes are. Text,
//! comments, bogus comments, the raw text of `<script>`, `<style>` and their
//! kin, and CDATA in SVG or MathML hold no attribute, so a `class=` there is
//! text. One copy for every lane: migrate converts what this reads, and the
//! webpack lane mangles it through the native or the wasm artifact.
//!
//! Held to `tests/fixtures/html-class-cases.json`, whose answers come from
//! parse5, with scripting on and off.
//!
//! Not modelled: an `annotation-xml` integration point (it depends on the
//! element's `encoding` value) and the elements the tree builder would close
//! or reopen around a misnested tag, neither of which changes what the
//! tokenizer reads as an attribute in the pages measured.

use serde::Serialize;

/// HTML's whitespace: the tokenizer's tab, line feed, form feed and space,
/// with the carriage return the input stream turns into a line feed.
pub const fn is_html_space(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | 0x0C | b'\r' | b' ')
}

/// One `class` attribute the tokenizer reads, in byte offsets: where its name
/// starts, where its value starts and ends (inside the quotes), where it ends
/// (past the closing quote), and its quote.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HtmlClassAttribute {
    pub start: usize,
    pub value_start: usize,
    pub value_end: usize,
    pub end: usize,
    pub quote: Option<u8>,
    /// The element has another `class` attribute after this one, which the
    /// tokenizer drops.
    pub repeated: bool,
}

/// Start tags that end SVG or MathML content: the tree builder pops back to
/// HTML before them. (`font` does so only with a `color`, `face` or `size`
/// attribute, and is read as staying.)
fn breaks_out_of_foreign(name: &[u8]) -> bool {
    const OUT: [&[u8]; 44] = [
        b"b",
        b"big",
        b"blockquote",
        b"body",
        b"br",
        b"center",
        b"code",
        b"dd",
        b"div",
        b"dl",
        b"dt",
        b"em",
        b"embed",
        b"h1",
        b"h2",
        b"h3",
        b"h4",
        b"h5",
        b"h6",
        b"head",
        b"hr",
        b"i",
        b"img",
        b"li",
        b"listing",
        b"menu",
        b"meta",
        b"nobr",
        b"ol",
        b"p",
        b"pre",
        b"ruby",
        b"s",
        b"small",
        b"span",
        b"strong",
        b"strike",
        b"sub",
        b"sup",
        b"table",
        b"tt",
        b"u",
        b"ul",
        b"var",
    ];
    OUT.iter().any(|out| out.eq_ignore_ascii_case(name))
}

/// Elements whose content the tokenizer reads as text up to their end tag.
/// `noscript` is one only with scripting on: a browser that runs scripts
/// never renders its content, one that does not renders it as markup.
fn is_raw_text(name: &[u8], scripting: bool) -> bool {
    // `script` too, read by `script_data_end` for its escaped states.
    const RAW: [&[u8]; 8] = [
        b"style",
        b"xmp",
        b"iframe",
        b"noembed",
        b"noframes",
        b"textarea",
        b"title",
        b"plaintext",
    ];
    if name.eq_ignore_ascii_case(b"noscript") {
        return scripting;
    }
    RAW.iter().any(|raw| raw.eq_ignore_ascii_case(name))
}

/// Where the tokenizer stands inside SVG or MathML: in foreign content, where
/// no element is raw text, or in an integration point (`foreignObject`,
/// `desc` and `title` in SVG, `mi`, `mo`, `mn`, `ms` and `mtext` in MathML),
/// where HTML is read again until the point's end tag.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Foreign<'a> {
    Svg,
    Math,
    Integration(&'a [u8]),
}

/// The integration point `name` opens inside `root`, if it is one.
fn is_integration_point(root: Foreign<'_>, name: &[u8]) -> bool {
    const SVG: [&[u8]; 3] = [b"foreignObject", b"desc", b"title"];
    const MATH: [&[u8]; 5] = [b"mi", b"mo", b"mn", b"ms", b"mtext"];
    let points: &[&[u8]] = if root == Foreign::Svg { &SVG } else { &MATH };
    points.iter().any(|point| point.eq_ignore_ascii_case(name))
}

/// The foreign root `name` opens: `svg` or `math`.
const fn foreign_root(name: &[u8]) -> Option<Foreign<'static>> {
    if name.eq_ignore_ascii_case(b"svg") {
        Some(Foreign::Svg)
    } else if name.eq_ignore_ascii_case(b"math") {
        Some(Foreign::Math)
    } else {
        None
    }
}

fn position_of(bytes: &[u8], from: usize, needle: u8) -> Option<usize> {
    bytes
        .get(from..)?
        .iter()
        .position(|&b| b == needle)
        .map(|i| from + i)
}

fn find(bytes: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    bytes
        .get(from..)?
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|i| from + i)
}

/// Where the raw text of `name` ends: at `</name` followed by whitespace,
/// `/` or `>`, in any ASCII case; the end of the text when it never does.
fn raw_text_end(bytes: &[u8], from: usize, name: &[u8]) -> usize {
    let mut at = from;
    while let Some(lt) = find(bytes, at, b"</") {
        if tag_name_at(bytes, lt + 2, name, true) {
            return lt;
        }
        at = lt + 2;
    }
    bytes.len()
}

/// Whether `name` stands at `at`, in any ASCII case, followed by whitespace,
/// `/` or `>` (or the end of the text when `at_end` allows it).
fn tag_name_at(bytes: &[u8], at: usize, name: &[u8], at_end: bool) -> bool {
    bytes
        .get(at..at + name.len())
        .is_some_and(|n| n.eq_ignore_ascii_case(name))
        && bytes
            .get(at + name.len())
            .map_or(at_end, |&b| is_html_space(b) || b == b'/' || b == b'>')
}

/// Where a script's text ends, with the tokenizer's escaped states: after
/// `<!--` a `<script>` opens a double-escaped stretch, where `</script>`
/// only goes back to the escaped one, and `-->` returns to plain script
/// data. One pass from `from`.
fn script_data_end(bytes: &[u8], from: usize) -> usize {
    #[derive(PartialEq, Eq)]
    enum State {
        Data,
        Escaped,
        DoubleEscaped,
    }
    let mut state = State::Data;
    let mut dashes = 0;
    let mut at = from;
    while at < bytes.len() {
        let byte = bytes[at];
        if state != State::Data {
            match byte {
                b'-' => {
                    dashes += 1;
                    at += 1;
                    continue;
                }
                b'>' if dashes >= 2 => state = State::Data,
                _ => {}
            }
        }
        dashes = 0;
        if byte == b'<' {
            match state {
                // Each arm changes the state and reads on from the next byte:
                // the `!--` after `<` and the name after `<` or `</` hold no
                // `<` and no `-->` that would read differently.
                State::Data if bytes[at..].starts_with(b"<!--") => state = State::Escaped,
                State::Data | State::Escaped
                    if bytes.get(at + 1) == Some(&b'/')
                        && tag_name_at(bytes, at + 2, b"script", true) =>
                {
                    return at;
                }
                State::Escaped if tag_name_at(bytes, at + 1, b"script", false) => {
                    state = State::DoubleEscaped;
                }
                State::DoubleEscaped
                    if bytes.get(at + 1) == Some(&b'/')
                        && tag_name_at(bytes, at + 2, b"script", false) =>
                {
                    state = State::Escaped;
                }
                _ => {}
            }
        }
        at += 1;
    }
    bytes.len()
}

/// The `>` that closes a comment whose text starts at `body`, past its
/// `<!--`: the first `>` with nothing, `-`, `--` or `--!` between it and
/// the text it ends (`<!-->`, `<!--->`, `-->`, `--!>`); the end of the text
/// when none does. The read goes on from that `>`, which opens nothing.
fn comment_end(bytes: &[u8], body: usize) -> usize {
    let mut at = body;
    while let Some(gt) = position_of(bytes, at, b'>') {
        let text = &bytes[body..gt];
        if text.is_empty() || text == b"-" || text.ends_with(b"--") || text.ends_with(b"--!") {
            return gt;
        }
        at = gt + 1;
    }
    bytes.len()
}

/// One start or end tag, read from its name.
struct Tag<'a> {
    name: &'a [u8],
    /// Where its `>` is, which the read goes on from; `None` when the text
    /// ends inside the tag, which drops it.
    end: Option<usize>,
    self_closing: bool,
    /// Its first `class` attribute, when that one has a value.
    class: Option<HtmlClassAttribute>,
    /// Whether it has a `color`, `face` or `size` attribute, which makes a
    /// `font` end SVG or MathML content.
    font_attribute: bool,
}

/// Read the tag whose name starts at `from`: its attributes up to its `>`.
/// Only the first `class` counts, as the tokenizer drops a repeated name.
fn read_tag(bytes: &[u8], from: usize) -> Tag<'_> {
    let mut at = from;
    while at < bytes.len() && !is_html_space(bytes[at]) && bytes[at] != b'/' && bytes[at] != b'>' {
        at += 1;
    }
    let name = &bytes[from..at];
    let unclosed = Tag {
        name,
        end: None,
        self_closing: false,
        class: None,
        font_attribute: false,
    };
    let mut class: Option<HtmlClassAttribute> = None;
    let mut classes = 0;
    let mut font_attribute = false;
    loop {
        let gap = at;
        while at < bytes.len() && (is_html_space(bytes[at]) || bytes[at] == b'/') {
            at += 1;
        }
        match bytes.get(at) {
            None => return unclosed,
            Some(b'>') => {
                if let Some(class) = &mut class {
                    class.repeated = classes > 1;
                }
                return Tag {
                    name,
                    end: Some(at),
                    self_closing: at > gap && bytes[at - 1] == b'/',
                    class,
                    font_attribute,
                };
            }
            Some(_) => {}
        }
        // An attribute name runs to whitespace, `/`, `>` or `=`; its first
        // character may be an `=`.
        let name_start = at;
        at += 1;
        while at < bytes.len()
            && !is_html_space(bytes[at])
            && !matches!(bytes[at], b'/' | b'>' | b'=')
        {
            at += 1;
        }
        let attribute = &bytes[name_start..at];
        let is_class = attribute.eq_ignore_ascii_case(b"class");
        classes += usize::from(is_class);
        let first_class = is_class && classes == 1;
        font_attribute |= [&b"color"[..], b"face", b"size"]
            .iter()
            .any(|name| attribute.eq_ignore_ascii_case(name));
        let mut after = at;
        while after < bytes.len() && is_html_space(bytes[after]) {
            after += 1;
        }
        if bytes.get(after) != Some(&b'=') {
            at = after;
            continue;
        }
        at = after + 1;
        while at < bytes.len() && is_html_space(bytes[at]) {
            at += 1;
        }
        let (quote, value_start, value_end, end) = match bytes.get(at) {
            None => return unclosed,
            // `=` then `>`: an empty value, and nothing to read in it.
            Some(b'>') => continue,
            Some(&quote @ (b'"' | b'\'')) => match position_of(bytes, at + 1, quote) {
                Some(close) => (Some(quote), at + 1, close, close + 1),
                None => return unclosed,
            },
            // Unquoted: up to whitespace or `>`; quotes, `=`, `<` and a
            // backtick are part of it.
            Some(_) => {
                let mut end = at;
                while end < bytes.len() && !is_html_space(bytes[end]) && bytes[end] != b'>' {
                    end += 1;
                }
                (None, at, end, end)
            }
        };
        if first_class {
            class = Some(HtmlClassAttribute {
                start: name_start,
                value_start,
                value_end,
                end,
                quote,
                repeated: false,
            });
        }
        at = end;
    }
}

/// Every `class` attribute the tokenizer reads, in text order, with a value
/// (`class` alone or `class=` before `>` has none to read), with scripting
/// on as parse5 reads by default: migrate's reading, since an `sz` it wrote
/// inside `noscript` would need the script that is not running.
///
/// `n` = `text.len()`. Linear: each scan resumes where the one before it
/// stopped, and a construct that never closes ends the read, as it runs to
/// the end of the text. Total: every slice starts and ends at an ASCII byte,
/// so at a char boundary.
#[cfg(any(feature = "migrate", test))]
pub fn html_class_attributes(text: &str) -> Vec<HtmlClassAttribute> {
    class_attributes(text, true)
}

/// [`html_class_attributes`], with scripting on or off.
fn class_attributes(text: &str, scripting: bool) -> Vec<HtmlClassAttribute> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    // Open SVG and MathML roots and integration points, innermost last.
    let mut stack: Vec<Foreign<'_>> = Vec::new();
    let in_foreign =
        |stack: &[Foreign<'_>]| matches!(stack.last(), Some(Foreign::Svg | Foreign::Math));
    // The tree builder pops foreign elements back to HTML before a tag
    // that breaks out; an integration point is HTML already.
    let break_out = |stack: &mut Vec<Foreign<'_>>| {
        while matches!(stack.last(), Some(Foreign::Svg | Foreign::Math)) {
            stack.pop();
        }
    };
    let mut at = 0;
    while let Some(lt) = position_of(bytes, at, b'<') {
        at = lt + 1;
        match bytes.get(at) {
            Some(b'!') => {
                at = if bytes[at..].starts_with(b"!--") {
                    comment_end(bytes, at + 3)
                } else if in_foreign(&stack) && bytes[at..].starts_with(b"![CDATA[") {
                    find(bytes, at, b"]]>").map_or(bytes.len(), |end| end + 3)
                } else {
                    position_of(bytes, at, b'>').unwrap_or(bytes.len())
                };
            }
            // A bogus comment: the read goes on from its `>`, which opens nothing.
            Some(b'?') => at = position_of(bytes, at, b'>').unwrap_or(bytes.len()),
            Some(b'/') => match bytes.get(at + 1) {
                Some(c) if c.is_ascii_alphabetic() => {
                    let tag = read_tag(bytes, at + 1);
                    let Some(end) = tag.end else { break };
                    at = end;
                    match stack.last().copied() {
                        Some(root @ (Foreign::Svg | Foreign::Math)) => {
                            if tag.name.eq_ignore_ascii_case(b"p")
                                || tag.name.eq_ignore_ascii_case(b"br")
                            {
                                break_out(&mut stack);
                            } else if foreign_root(tag.name) == Some(root) {
                                stack.pop();
                            }
                        }
                        Some(Foreign::Integration(point))
                            if point.eq_ignore_ascii_case(tag.name) =>
                        {
                            stack.pop();
                        }
                        _ => {}
                    }
                }
                Some(b'>') => at += 2,
                Some(_) => at = position_of(bytes, at, b'>').unwrap_or(bytes.len()),
                None => break,
            },
            Some(c) if c.is_ascii_alphabetic() => {
                let tag = read_tag(bytes, at);
                let Some(end) = tag.end else { break };
                at = end;
                found.extend(tag.class);
                if let Some(root @ (Foreign::Svg | Foreign::Math)) = stack.last().copied() {
                    let font = tag.name.eq_ignore_ascii_case(b"font") && tag.font_attribute;
                    if !(breaks_out_of_foreign(tag.name) || font) {
                        if tag.self_closing {
                            continue;
                        }
                        if is_integration_point(root, tag.name) {
                            stack.push(Foreign::Integration(tag.name));
                        } else if foreign_root(tag.name) == Some(root) {
                            stack.push(root);
                        }
                        continue;
                    }
                    break_out(&mut stack);
                }
                if let Some(root) = foreign_root(tag.name) {
                    if !tag.self_closing {
                        stack.push(root);
                    }
                } else if tag.name.eq_ignore_ascii_case(b"script") {
                    at = script_data_end(bytes, at);
                } else if is_raw_text(tag.name, scripting) {
                    if tag.name.eq_ignore_ascii_case(b"plaintext") {
                        break;
                    }
                    at = raw_text_end(bytes, at, tag.name);
                }
            }
            _ => {}
        }
    }
    found
}

/// What a numeric character reference stands for: NUL, a surrogate or a
/// number past Unicode reads as U+FFFD, and the C1 controls as the
/// Windows-1252 characters a page meant by them.
fn numeric_reference(number: u32) -> char {
    const C1: [u32; 32] = [
        0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160,
        0x2039, 0x0152, 0x8D, 0x017D, 0x8F, 0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013,
        0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
    ];
    let number = match number {
        0x80..=0x9F => C1[(number - 0x80) as usize],
        _ => number,
    };
    if number == 0 {
        return '\u{FFFD}';
    }
    char::from_u32(number).unwrap_or('\u{FFFD}')
}

/// One piece of a decoded attribute value: the bytes of the raw value it
/// came from, and what they read as.
enum Piece<'a> {
    /// Raw text that reads as itself.
    Text(usize, &'a str),
    /// A character reference, or a NUL, and the character it reads as.
    Char(usize, usize, char),
    /// The `&` of `&name;` with a name the reader cannot tell. None of them
    /// reads as whitespace (of the 2,125 names, only `Tab` and `NewLine` do,
    /// and both are read), so it stays inside the class name it is written
    /// in, and the name and `;` after it read as that name's text.
    Unknown(usize),
}

/// Walk an attribute value as the tokenizer decodes it. `&name;` with a name
/// outside the legacy set, `apos`, `Tab` and `NewLine` comes as
/// [`Piece::Unknown`]: HTML names 2,231, and reading one wrong would rewrite
/// a class the page never had. An `&` that starts no name is text (`R&D`,
/// `[&a]:p-4`).
fn decode_pieces<'a>(raw: &'a str, mut piece: impl FnMut(Piece<'a>)) {
    let bytes = raw.as_bytes();
    let mut text_start = 0;
    let mut at = 0;
    while at < bytes.len() {
        let (len, character) = match bytes[at] {
            b'\0' => (1, '\u{FFFD}'),
            b'&' => match reference_at(bytes, at) {
                Reference::Text => {
                    at += 1;
                    continue;
                }
                Reference::Char(len, character) => (len, character),
                Reference::Unknown => {
                    piece(Piece::Text(text_start, &raw[text_start..at]));
                    piece(Piece::Unknown(at));
                    at += 1;
                    text_start = at;
                    continue;
                }
            },
            _ => {
                at += 1;
                continue;
            }
        };
        // A text piece may be empty: it adds nothing to a value or a name.
        piece(Piece::Text(text_start, &raw[text_start..at]));
        piece(Piece::Char(at, at + len, character));
        at += len;
        text_start = at;
    }
    piece(Piece::Text(text_start, &raw[text_start..]));
}

/// What an `&` starts ([`reference_at`]).
enum Reference {
    /// Nothing: the `&` is text.
    Text,
    /// A reference this long, and the character it reads as.
    Char(usize, char),
    /// `&name;` with a name the reader cannot tell.
    Unknown,
}

/// What the `&` at `at` starts ([`decode_pieces`]).
fn reference_at(bytes: &[u8], at: usize) -> Reference {
    let rest = &bytes[at + 1..];
    if let Some(after_hash) = rest.strip_prefix(b"#") {
        let (hex, digits) = match after_hash.first() {
            Some(b'x' | b'X') => (true, &after_hash[1..]),
            _ => (false, after_hash),
        };
        let count = digits
            .iter()
            .take_while(|b| {
                if hex {
                    b.is_ascii_hexdigit()
                } else {
                    b.is_ascii_digit()
                }
            })
            .count();
        if count == 0 {
            return Reference::Text;
        }
        let number = digits[..count].iter().fold(0u32, |number, &digit| {
            let value = u32::from(match digit {
                b'0'..=b'9' => digit - b'0',
                _ => (digit | 0x20) - b'a' + 10,
            });
            // Past Unicode it stays past Unicode, without overflowing.
            number
                .saturating_mul(if hex { 16 } else { 10 })
                .saturating_add(value)
                .min(0x11_0000)
        });
        let semicolon = usize::from(digits.get(count) == Some(&b';'));
        let len = 1 + 1 + usize::from(hex) + count + semicolon;
        return Reference::Char(len, numeric_reference(number));
    }
    let run = rest
        .iter()
        .take_while(|b| b.is_ascii_alphanumeric())
        .count();
    if run == 0 {
        return Reference::Text;
    }
    let name = &rest[..run];
    let semicolon = rest.get(run) == Some(&b';');
    let legacy = LEGACY_NAMES
        .split(' ')
        .position(|legacy| legacy.as_bytes() == name)
        .map(|index| char::from(LEGACY_CHARACTERS[index]));
    // The names besides the legacy ones that the reader knows: `apos`, and
    // the only two that read as whitespace, which split a class list.
    let known = match name {
        b"apos" => Some('\''),
        b"Tab" => Some('\t'),
        b"NewLine" => Some('\n'),
        _ => None,
    };
    match (legacy.or(known), semicolon) {
        (Some(character), true) => Reference::Char(run + 2, character),
        // Without its `;`, a legacy name before `=` stays text in a value.
        (Some(character), false) if legacy.is_some() && rest.get(run) != Some(&b'=') => {
            Reference::Char(run + 1, character)
        }
        // Any of the other names with a `;`: only the full table says.
        (None, true) => Reference::Unknown,
        // No name matches, or a legacy one runs on: the `&` is text.
        _ => Reference::Text,
    }
}

/// The 106 names a page may write without their `;` (WHATWG's legacy
/// character references, from the `entities` package's `legacy.json`), and
/// in [`LEGACY_CHARACTERS`] at the same position the character each stands
/// for, all in Latin-1. Each also exists with its `;`, as the same character.
/// Locked to parse5 by the fixture cases that write every one of them. One
/// string and one byte each rather than a table of slices: the wasm artifact
/// carries every byte, and this lookup runs only on an `&` before a letter.
const LEGACY_NAMES: &str =
    "AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc \
     Egrave Euml GT Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash \
     Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute \
     aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg \
     divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl \
     igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc \
     ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy \
     sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml";

/// The characters of [`LEGACY_NAMES`], in its order.
const LEGACY_CHARACTERS: &[u8; 106] =
    b"\xc6\x26\xc1\xc2\xc0\xc5\xc3\xc4\xa9\xc7\xd0\xc9\xca\xc8\xcb\x3e\xcd\xce\xcc\xcf\
      \x3c\xd1\xd3\xd4\xd2\xd8\xd5\xd6\x22\xae\xde\xda\xdb\xd9\xdc\xdd\xe1\xe2\xb4\xe6\
      \xe0\x26\xe5\xe3\xe4\xa6\xe7\xb8\xa2\xa9\xa4\xb0\xf7\xe9\xea\xe8\xf0\xeb\xbd\xbc\
      \xbe\x3e\xed\xee\xa1\xec\xbf\xef\xab\x3c\xaf\xb5\xb7\xa0\xac\xf1\xf3\xf4\xf2\xaa\
      \xba\xf8\xf5\xf6\xb6\xb1\xa3\x22\xbb\xae\xa7\xad\xb9\xb2\xb3\xdf\xfe\xd7\xfa\xfb\
      \xf9\xa8\xfc\xfd\xa5\xff";

/// An attribute value as the tokenizer decodes it; `None` when it holds a
/// named reference the reader cannot tell ([`Piece::Unknown`]), which
/// migrate leaves as written.
#[cfg(any(feature = "migrate", test))]
pub fn decode_attribute_value(raw: &str) -> Option<std::borrow::Cow<'_, str>> {
    match decode_attribute(raw) {
        (_, true) => None,
        (text, false) => Some(text),
    }
}

/// An attribute value as the tokenizer decodes it, each `&name;` the reader
/// cannot tell ([`Piece::Unknown`]) kept as written, and whether there was one.
#[cfg(any(feature = "migrate", feature = "native-engine", test))]
fn decode_attribute(raw: &str) -> (std::borrow::Cow<'_, str>, bool) {
    if !raw.bytes().any(|b| b == b'&' || b == b'\0') {
        return (std::borrow::Cow::Borrowed(raw), false);
    }
    let mut decoded = String::with_capacity(raw.len());
    let mut unknown = false;
    decode_pieces(raw, |piece| match piece {
        Piece::Text(_, text) => decoded.push_str(text),
        Piece::Char(_, _, character) => decoded.push(character),
        Piece::Unknown(_) => {
            unknown = true;
            decoded.push('&');
        }
    });
    (std::borrow::Cow::Owned(decoded), unknown)
}

/// Every text a class attribute string written as `raw` can put in the DOM,
/// each once: as JSX reads it, then as HTML does. `raw` itself is one of them
/// when a language reads it as written.
///
/// A scanner that does not know which language a file's attribute is in
/// reads every one, so a name the element carries is never missed; reading
/// one it does not carry only keeps a class from being renamed. HTML keeps a
/// name it cannot tell as written, as the class reader does.
///
/// `n` = `raw.len()`: one walk per language, none when `raw` holds no `&`
/// and no NUL.
#[cfg(feature = "native-engine")]
pub fn class_attribute_readings(raw: &str) -> Vec<String> {
    let mut readings: Vec<String> = Vec::with_capacity(2);
    for reading in [
        crate::transform::jsx_text::decode_jsx_attribute_text(raw),
        decode_attribute(raw).0,
    ] {
        if !readings.iter().any(|seen| *seen == reading) {
            readings.push(reading.into_owned());
        }
    }
    readings
}

/// One class name of a `class` attribute the tokenizer reads: where its
/// spelling lies in the text, in UTF-16 units as JavaScript counts them, and
/// the name it decodes to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HtmlClassName {
    pub start: usize,
    pub end: usize,
    pub name: String,
}

/// Every class name of every `class` attribute the tokenizer reads
/// ([`html_class_attributes`]), split on HTML whitespace after decoding, so
/// `a&#32;b` is two names. A caller rewrites a name by replacing its
/// spelling, which keeps every byte around it as written. A name holding a
/// named reference the reader cannot tell is left out; the others in its
/// list are not.
///
/// `n` = `text.len()`: one walk of the text for the attributes, one of each
/// value, and one running count of UTF-16 units across the text.
pub fn html_class_names(text: &str) -> Vec<HtmlClassName> {
    let mut names = Vec::new();
    let mut utf16 = Utf16Counter::new(text);
    for attribute in class_attributes(text, false) {
        let base = attribute.value_start;
        let raw = &text[base..attribute.value_end];
        // Each name with where its spelling lies, and whether it holds a
        // reference the reader cannot tell, which leaves that name alone.
        let mut tokens: Vec<(usize, usize, String, bool)> = Vec::new();
        let mut current: Option<(usize, usize, String, bool)> = None;
        let mut push = |start: usize, end: usize, character: Option<char>| {
            if character.is_some_and(|c| c.is_ascii() && is_html_space(c as u8)) {
                tokens.extend(current.take());
            } else {
                let token = current.get_or_insert_with(|| (start, end, String::new(), true));
                token.1 = end;
                match character {
                    Some(character) => token.2.push(character),
                    None => token.3 = false,
                }
            }
        };
        decode_pieces(raw, |piece| match piece {
            Piece::Text(offset, part) => {
                for (index, character) in part.char_indices() {
                    let start = offset + index;
                    push(start, start + character.len_utf8(), Some(character));
                }
            }
            Piece::Char(start, end, character) => push(start, end, Some(character)),
            // Its range is never read: a name holding one is left out.
            Piece::Unknown(at) => push(at, at, None),
        });
        tokens.extend(current);
        for (start, end, name, _) in tokens.into_iter().filter(|token| token.3) {
            names.push(HtmlClassName {
                start: utf16.at(base + start),
                end: utf16.at(base + end),
                name,
            });
        }
    }
    names
}

/// UTF-16 offsets for byte offsets that never decrease, counted on from the
/// last one asked, so a page costs one walk whatever it holds.
struct Utf16Counter<'a> {
    text: &'a str,
    byte: usize,
    unit: usize,
}

impl<'a> Utf16Counter<'a> {
    const fn new(text: &'a str) -> Self {
        Self {
            text,
            byte: 0,
            unit: 0,
        }
    }

    fn at(&mut self, byte: usize) -> usize {
        debug_assert!(byte >= self.byte, "offsets are asked in text order");
        self.unit += self.text[self.byte..byte]
            .chars()
            .map(char::len_utf16)
            .sum::<usize>();
        self.byte = byte;
        self.unit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "native-engine")]
    #[test]
    fn a_class_attribute_reads_as_jsx_then_as_html() {
        // Both languages agree: one reading.
        assert_eq!(class_attribute_readings("p&#45;4 a&amp;b"), ["p-4 a&b"]);
        // JSX knows `hellip`, HTML keeps it as written.
        assert_eq!(
            class_attribute_readings("x&hellip;"),
            ["x\u{2026}", "x&hellip;"]
        );
        // HTML decodes `&lt` before a space with no `;`, JSX reads it as written.
        assert_eq!(class_attribute_readings("x&lt y"), ["x&lt y", "x< y"]);
        assert_eq!(class_attribute_readings("&lt;a&lt b"), ["<a&lt b", "<a< b"]);
        // Nothing to decode, or nothing either language reads: the text itself.
        assert_eq!(class_attribute_readings("p-4 [&_p]:m-2"), ["p-4 [&_p]:m-2"]);
        assert_eq!(class_attribute_readings("a&bogus;b"), ["a&bogus;b"]);
        // A NUL reads as U+FFFD in HTML only.
        assert_eq!(class_attribute_readings("a\0b"), ["a\0b", "a\u{FFFD}b"]);
    }

    #[test]
    fn an_attribute_keeps_a_name_the_reader_cannot_tell_and_says_so() {
        assert!(matches!(
            decode_attribute("p-4"),
            (std::borrow::Cow::Borrowed("p-4"), false)
        ));
        let (text, unknown) = decode_attribute("&foo;&amp;x&#65;");
        assert_eq!((text.as_ref(), unknown), ("&foo;&xA", true));
        assert!(!decode_attribute("&amp;").1);
    }

    /// The cases parse5 answers (`tests/fixtures/html-class-cases.json`):
    /// where each `class` lies, in UTF-16 units, and the value it decodes to.
    #[test]
    fn reads_the_class_attributes_parse5_reads() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../tests/fixtures/html-class-cases.json"))
                .expect("cases parse");
        for case in cases {
            let html = case["html"].as_str().expect("html");
            // Migrate reads with scripting on, as parse5 does by default; the
            // mangle reads with it off, where `noscript` holds markup.
            assert_attributes(html, true, &case["found"]);
            let off = case
                .get("foundScriptingOff")
                .unwrap_or_else(|| &case["found"]);
            assert_attributes(html, false, off);
            assert_names(html, &expected_names(off));
        }
    }

    /// Seeded random pages mixing comments, raw text, script escapes, SVG and
    /// MathML, references and unquoted values, answered by parse5 8.0.1
    /// (`tests/fixtures/html-class-corpus.json`; the generator is not in the
    /// repository): the `class` attributes with scripting on, the class names
    /// with it off.
    #[test]
    fn reads_generated_pages_as_parse5_does() {
        let pages: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../tests/fixtures/html-class-corpus.json"))
                .expect("corpus parses");
        assert!(pages.len() >= 800);
        for page in pages {
            let html = page["html"].as_str().expect("html");
            assert_attributes(html, true, &page["found"]);
            let names: Vec<String> = page["names"]
                .as_array()
                .expect("names")
                .iter()
                .map(|name| name.as_str().expect("name").to_string())
                .collect();
            assert_names(html, &names);
        }
    }

    /// The `class` attributes of `html`, read with scripting on or off, are
    /// where parse5 puts them and decode to what it reads.
    fn assert_attributes(html: &str, scripting: bool, expected: &serde_json::Value) {
        let expected = expected.as_array().expect("found");
        let found = class_attributes(html, scripting);
        assert_eq!(
            found.len(),
            expected.len(),
            "{html:?} (scripting {scripting}): {found:?}"
        );
        let mut utf16 = Utf16Counter::new(html);
        for (at, want) in found.iter().zip(expected) {
            let offset = |field: &str| usize::try_from(want[field].as_u64().unwrap()).unwrap();
            assert_eq!(utf16.at(at.start), offset("start"), "{html:?}");
            assert_eq!(utf16.at(at.end), offset("end"), "{html:?}");
            let raw = &html[at.value_start..at.value_end];
            let undecoded = want.get("undecoded").is_some();
            match decode_attribute_value(raw) {
                Some(value) => {
                    assert!(!undecoded, "{html:?} read {value:?}");
                    assert_eq!(value, want["value"].as_str().unwrap(), "{html:?}");
                }
                None => assert!(undecoded, "{html:?} left {raw:?} undecoded"),
            }
        }
    }

    /// The names a mangle reads from parse5's attributes: every name of each
    /// value, or, for a value holding a reference the reader cannot tell,
    /// the names the fixture lists without it.
    fn expected_names(found: &serde_json::Value) -> Vec<String> {
        let strings = |names: &serde_json::Value| -> Vec<String> {
            names
                .as_array()
                .expect("names")
                .iter()
                .map(|name| name.as_str().expect("name").to_string())
                .collect()
        };
        found
            .as_array()
            .expect("found")
            .iter()
            .flat_map(|at| {
                at.get("names").map_or_else(
                    || {
                        at["value"]
                            .as_str()
                            .expect("value")
                            .split(|c: char| c.is_ascii() && is_html_space(c as u8))
                            .filter(|name| !name.is_empty())
                            .map(str::to_string)
                            .collect()
                    },
                    strings,
                )
            })
            .collect()
    }

    /// The class names a mangle reads from `html` are `expected`, and each
    /// one's spelling without a reference is the name itself.
    fn assert_names(html: &str, expected: &[String]) {
        let names = html_class_names(html);
        let read: Vec<&str> = names.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(read, expected, "{html:?}");
        let units: Vec<u16> = html.encode_utf16().collect();
        for name in &names {
            let spelled = String::from_utf16(&units[name.start..name.end]).expect("spelling");
            if !spelled.contains('&') && !spelled.contains('\0') {
                assert_eq!(spelled, name.name, "{html:?}");
            }
        }
    }

    #[test]
    fn splits_class_names_after_decoding_and_keeps_their_spelling() {
        let html = "<p title=\"é\" class=\" a&#32;b\tc&amp;d \">x</p><i class=e&#x20;f>";
        let names = html_class_names(html);
        let units: Vec<u16> = html.encode_utf16().collect();
        let spelled = |n: &HtmlClassName| String::from_utf16(&units[n.start..n.end]).unwrap();
        assert_eq!(
            names
                .iter()
                .map(|n| (spelled(n), n.name.as_str()))
                .collect::<Vec<_>>(),
            [
                ("a".to_string(), "a"),
                ("b".to_string(), "b"),
                ("c&amp;d".to_string(), "c&d"),
                ("e".to_string(), "e"),
                ("f".to_string(), "f"),
            ]
        );
        // A name holding a reference the reader cannot tell is left out,
        // and only that name.
        assert!(html_class_names("<p class=\"a&foo;b\">").is_empty());
        // A value with no reference and no NUL is the text itself, not a copy.
        assert!(matches!(
            decode_attribute_value("p-4 m-2"),
            Some(std::borrow::Cow::Borrowed("p-4 m-2"))
        ));
        assert!(matches!(
            decode_attribute_value("p-4&amp;"),
            Some(std::borrow::Cow::Owned(_))
        ));
        let names = html_class_names("<p class=\"p-4 &check;x m-2\">");
        assert_eq!(
            names.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(),
            ["p-4", "m-2"]
        );
        // A NUL reads as U+FFFD, as the tokenizer reads it.
        assert_eq!(html_class_names("<p class=\"a\0b\">")[0].name, "a\u{FFFD}b");
    }

    /// Any text reads without a panic, and every range lies on char
    /// boundaries inside the text, in order.
    #[test]
    fn reads_any_text() {
        const PARTS: [&str; 24] = [
            "<", ">", "/", "!", "-", "--", "=", "\"", "'", " ", "\n", "class", "CLASS", "svg",
            "script", "style", "</", "![CDATA[", "]]>", "&", "#x", ";", "é", "😀",
        ];
        let mut rng = crate::transform::test_rng::Rng::new(17);
        for _ in 0..20_000 {
            let len = rng.below(24);
            let text: String = (0..len).map(|_| PARTS[rng.below(PARTS.len())]).collect();
            let mut last = 0;
            for at in html_class_attributes(&text) {
                assert!(last <= at.start && at.start < at.value_start, "{text:?}");
                assert!(
                    at.value_start <= at.value_end && at.value_end <= at.end,
                    "{text:?}"
                );
                assert!(
                    at.end <= text.len() && text.is_char_boundary(at.value_end),
                    "{text:?}"
                );
                last = at.end;
            }
            let units = text.encode_utf16().count();
            let mut last = 0;
            for name in html_class_names(&text) {
                assert!(
                    last <= name.start && name.start < name.end && name.end <= units,
                    "{text:?}"
                );
                last = name.end;
            }
        }
    }
}
