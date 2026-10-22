//! Runtime-dispatched AVX2 / baseline AArch64 NEON, scalar fallback everywhere else.
pub fn transition(
    neighbors: [[u64; 4]; 8],
    current: [u64; 4],
    birth: u32,
    survive: u32,
) -> [u64; 4] {
    #[cfg(target_arch = "x86_64")]
    if std::arch::is_x86_feature_detected!("avx2") {
        // SAFETY: feature detection precedes the target-feature call; arrays have 32 readable bytes.
        return unsafe { avx2(neighbors, current, birth, survive) };
    }
    #[cfg(target_arch = "aarch64")]
    {
        return unsafe { neon(neighbors, current, birth, survive) };
    }
    #[allow(unreachable_code)]
    scalar(neighbors, current, birth, survive)
}
fn scalar(neighbors: [[u64; 4]; 8], current: [u64; 4], birth: u32, survive: u32) -> [u64; 4] {
    let mut out = [0; 4];
    for lane in 0..4 {
        let mut bits = [0; 4];
        for neighbor in neighbors {
            let mut carry = neighbor[lane];
            for bit in &mut bits {
                let c = *bit & carry;
                *bit ^= carry;
                carry = c;
            }
        }
        let mut born = 0;
        let mut live = 0;
        for n in 0..=8 {
            let mut eq = !0;
            for (k, &bit) in bits.iter().enumerate() {
                eq &= if n & (1 << k) != 0 { bit } else { !bit };
            }
            if birth & (1 << n) != 0 {
                born |= eq;
            }
            if survive & (1 << n) != 0 {
                live |= eq;
            }
        }
        out[lane] = (born & !current[lane]) | (live & current[lane]);
    }
    out
}
#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "avx2")]
unsafe fn avx2(neighbors: [[u64; 4]; 8], current: [u64; 4], birth: u32, survive: u32) -> [u64; 4] {
    use std::arch::x86_64::*;
    let zero = _mm256_setzero_si256();
    let ones = _mm256_set1_epi64x(-1);
    let mut bits = [zero; 4];
    for row in &neighbors {
        let mut carry = unsafe { _mm256_loadu_si256(row.as_ptr().cast()) };
        for bit in &mut bits {
            let c = _mm256_and_si256(*bit, carry);
            *bit = _mm256_xor_si256(*bit, carry);
            carry = c;
        }
    }
    let mut born = zero;
    let mut live = zero;
    for n in 0..=8 {
        let mut eq = ones;
        for (k, &bit) in bits.iter().enumerate() {
            eq = _mm256_and_si256(
                eq,
                if n & (1 << k) != 0 {
                    bit
                } else {
                    _mm256_xor_si256(bit, ones)
                },
            );
        }
        if birth & (1 << n) != 0 {
            born = _mm256_or_si256(born, eq);
        }
        if survive & (1 << n) != 0 {
            live = _mm256_or_si256(live, eq);
        }
    }
    let c = unsafe { _mm256_loadu_si256(current.as_ptr().cast()) };
    let result = _mm256_or_si256(_mm256_andnot_si256(c, born), _mm256_and_si256(c, live));
    let mut out = [0u64; 4];
    unsafe {
        _mm256_storeu_si256(out.as_mut_ptr().cast(), result);
    }
    out
}
#[cfg(target_arch = "aarch64")]
#[target_feature(enable = "neon")]
unsafe fn neon(neighbors: [[u64; 4]; 8], current: [u64; 4], birth: u32, survive: u32) -> [u64; 4] {
    use std::arch::aarch64::*;
    let mut out = [0; 4];
    for offset in [0, 2] {
        let zero = vdupq_n_u64(0);
        let ones = vdupq_n_u64(u64::MAX);
        let mut bits = [zero; 4];
        for row in &neighbors {
            let mut carry = unsafe { vld1q_u64(row.as_ptr().add(offset)) };
            for bit in &mut bits {
                let c = vandq_u64(*bit, carry);
                *bit = veorq_u64(*bit, carry);
                carry = c;
            }
        }
        let mut born = zero;
        let mut live = zero;
        for n in 0..=8 {
            let mut eq = ones;
            for (k, &bit) in bits.iter().enumerate() {
                eq = vandq_u64(
                    eq,
                    if n & (1 << k) != 0 {
                        bit
                    } else {
                        veorq_u64(bit, ones)
                    },
                );
            }
            if birth & (1 << n) != 0 {
                born = vorrq_u64(born, eq);
            }
            if survive & (1 << n) != 0 {
                live = vorrq_u64(live, eq);
            }
        }
        let c = unsafe { vld1q_u64(current.as_ptr().add(offset)) };
        let result = vorrq_u64(vbicq_u64(born, c), vandq_u64(live, c));
        unsafe {
            vst1q_u64(out.as_mut_ptr().add(offset), result);
        }
    }
    out
}
