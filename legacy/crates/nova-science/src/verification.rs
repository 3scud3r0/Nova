//! Exact polynomial Lie certificates. Numerical finite differences never earn reward.
use anyhow::{ensure, Result};
use num_bigint::BigInt;
use num_rational::BigRational;
use num_traits::Zero;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Term {
    pub numerator: String,
    pub denominator: String,
    pub powers: Vec<u8>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PolynomialClaim {
    pub variables: usize,
    pub invariant: Vec<Term>,
    pub field: Vec<Vec<Term>>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub schema: String,
    pub method: String,
    pub claim_sha256: String,
    pub status: String,
    pub reward: u8,
    pub scope: String,
    pub source_sha256: Option<String>,
    pub tool_version: Option<String>,
}
impl Receipt {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema == "NOVA-VERIFICATION-v1"
                && self.claim_sha256.len() == 64
                && self.claim_sha256.bytes().all(|x| x.is_ascii_hexdigit())
                && self.reward <= 1
                && self.scope.len() <= 4096
                && self.status.len() <= 128
                && self.method.len() <= 128,
            "invalid receipt"
        );
        ensure!(
            self.reward == 0 || self.status == "verified",
            "unverified reward"
        );
        Ok(())
    }
}
type Poly = BTreeMap<Vec<u8>, BigRational>;
fn polynomial(terms: &[Term], variables: usize) -> Result<Poly> {
    ensure!(terms.len() <= 4096, "term budget");
    let mut p = Poly::new();
    for t in terms {
        ensure!(
            t.numerator.len() <= 128
                && t.denominator.len() <= 128
                && t.powers.len() == variables
                && t.powers.iter().map(|&x| x as usize).sum::<usize>() <= 16,
            "polynomial degree/encoding budget"
        );
        let a: BigInt = t.numerator.parse()?;
        let b: BigInt = t.denominator.parse()?;
        ensure!(!b.is_zero(), "zero denominator");
        *p.entry(t.powers.clone()).or_insert_with(BigRational::zero) += BigRational::new(a, b);
    }
    p.retain(|_, c| !c.is_zero());
    Ok(p)
}
pub fn verify_lie(claim: &PolynomialClaim) -> Result<Receipt> {
    ensure!(
        claim.variables > 0 && claim.variables <= 16 && claim.field.len() == claim.variables,
        "invalid field dimension"
    );
    let invariant = polynomial(&claim.invariant, claim.variables)?;
    let mut result = Poly::new();
    let mut work = 0usize;
    for k in 0..claim.variables {
        let field = polynomial(&claim.field[k], claim.variables)?;
        for (a, c) in &invariant {
            if a[k] == 0 {
                continue;
            }
            for (b, d) in &field {
                work += 1;
                ensure!(work <= 1_000_000, "exact algebra work budget exceeded");
                let mut powers = vec![0; claim.variables];
                for j in 0..claim.variables {
                    powers[j] = a[j] + b[j] - u8::from(j == k);
                }
                let v = c * d * BigRational::from_integer(BigInt::from(a[k]));
                let coefficient = result.entry(powers).or_insert_with(BigRational::zero);
                *coefficient += v;
                ensure!(
                    coefficient.numer().bits() <= 131072 && coefficient.denom().bits() <= 131072,
                    "rational coefficient size budget exceeded"
                );
                ensure!(
                    result.len() <= 65536,
                    "polynomial result memory budget exceeded"
                );
            }
        }
    }
    let proved = result.values().all(Zero::is_zero);
    let receipt=Receipt{schema:"NOVA-VERIFICATION-v1".into(),method:"exact-rational-polynomial-Lie".into(),claim_sha256:format!("{:x}",Sha256::digest(serde_json::to_vec(claim)?)),status:if proved{"verified"}else{"refuted"}.into(),reward:u8::from(proved),scope:"Lie derivative identically zero for the supplied polynomial ODE over rationals; no claim about discretization, simulation fit or physical reality".into(),source_sha256:None,tool_version:None};
    receipt.validate()?;
    Ok(receipt)
}
/// Only this embedded algebraic theorem is executed; peer text is never compiled.
/// `ring` produces a kernel-checked proof, without sorry, user tactics or axioms.
const LEAN_SOURCE:&str="import Mathlib\n theorem nova_pair_impulse (pa pb impulse : ℝ) : (pa + impulse) + (pb - impulse) = pa + pb := by ring\n";
pub fn verify_pair_lean(project: &Path, timeout: Duration) -> Result<Receipt> {
    ensure!(
        timeout > Duration::ZERO && timeout <= Duration::from_secs(300),
        "invalid proof timeout"
    );
    let root = project.canonicalize()?;
    let source = LEAN_SOURCE.to_owned();
    let digest = format!("{:x}", Sha256::digest(source.as_bytes()));
    let filename = format!("NovaPair_{}_{}.lean", std::process::id(), &digest[..12]);
    let path = root.join(&filename);
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)?;
    file.write_all(source.as_bytes())?;
    drop(file);
    let result = (|| -> Result<Receipt> {
        let mut child = match Command::new("lake")
            .args(["env", "lean", &filename])
            .current_dir(&root)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(lean_receipt(&digest, "unavailable"))
            }
            Err(e) => return Err(e.into()),
        };
        let start = Instant::now();
        loop {
            if let Some(status) = child.try_wait()? {
                return Ok(lean_receipt(
                    &digest,
                    if status.success() {
                        "verified"
                    } else {
                        "unverified"
                    },
                ));
            }
            if start.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(lean_receipt(&digest, "timeout"));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    })();
    let _ = std::fs::remove_file(path);
    result
}
fn lean_receipt(digest: &str, status: &str) -> Receipt {
    Receipt{schema:"NOVA-VERIFICATION-v1".into(),method:"lean4-fixed-pair-impulse".into(),claim_sha256:digest.into(),status:status.into(),reward:u8::from(status=="verified"),scope:"Embedded algebraic pair-impulse identity under the selected local Lean/Mathlib project; unrelated hypotheses receive no credit".into(),source_sha256:Some(digest.into()),tool_version:None}
}

/// Reject zero/constant invariants as learning objectives, after canonicalization.
/// This avoids rewarding term masks whose nonzero terms cancel to a constant.
pub fn verify_nontrivial_lie(claim: &PolynomialClaim) -> Result<Receipt> {
    let mut receipt = verify_lie(claim)?;
    let invariant = polynomial(&claim.invariant, claim.variables)?;
    if !invariant.keys().any(|powers| powers.iter().any(|&p| p > 0)) {
        receipt.status = "trivial-candidate".into();
        receipt.reward = 0;
    }
    Ok(receipt)
}
