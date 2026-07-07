use std::collections::HashSet;
use std::fmt::Write;

use sha2::{Digest, Sha256};

use crate::{Result, SchedulerError, ValidationError};

pub const MAX_SLUG_LEN: usize = 120;

pub fn sha256_hex(input: impl AsRef<[u8]>) -> String {
    let digest = Sha256::digest(input.as_ref());
    let mut out = String::with_capacity(64);
    for byte in digest {
        write!(&mut out, "{byte:02x}").expect("writing to String cannot fail");
    }
    out
}

pub fn prompt_hash(prompt: &str) -> String {
    sha256_hex(prompt.as_bytes())
}

pub fn slugify(name: &str) -> Result<String> {
    let mut slug = String::new();

    for ch in name.chars() {
        let ch = ch.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.len() > MAX_SLUG_LEN {
        slug.truncate(MAX_SLUG_LEN);
        while slug.ends_with('-') {
            slug.pop();
        }
    }

    validate_slug(&slug)?;
    Ok(slug)
}

pub fn validate_slug(slug: &str) -> Result<()> {
    let valid = !slug.is_empty()
        && slug.len() <= MAX_SLUG_LEN
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');

    if valid {
        Ok(())
    } else {
        Err(SchedulerError::Validation(ValidationError::InvalidSlug(
            slug.to_owned(),
        )))
    }
}

pub fn unique_slug<'a, I>(name: &str, existing_slugs: I) -> Result<String>
where
    I: IntoIterator<Item = &'a str>,
{
    let base = slugify(name)?;
    let existing = existing_slugs.into_iter().collect::<HashSet<_>>();

    if !existing.contains(base.as_str()) {
        return Ok(base);
    }

    for suffix_number in 2.. {
        let suffix = format!("-{suffix_number}");
        let max_base_len = MAX_SLUG_LEN - suffix.len();
        let mut candidate_base = base.clone();
        if candidate_base.len() > max_base_len {
            candidate_base.truncate(max_base_len);
            while candidate_base.ends_with('-') {
                candidate_base.pop();
            }
        }
        let candidate = format!("{candidate_base}{suffix}");
        if !existing.contains(candidate.as_str()) {
            return Ok(candidate);
        }
    }

    unreachable!("unbounded suffix search always returns")
}
