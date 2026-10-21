//! Native CPU research kernels. Ternary coefficients use branches and add/subtract.
use numpy::{ndarray::Array2, PyArray2, PyReadonlyArray2};
use pyo3::{exceptions::PyValueError, prelude::*};
use rayon::prelude::*;

#[pyclass]
struct TernaryBlock {
    rows: usize,
    cols: usize,
    packed: Vec<u8>,
}

fn pack(weights: &[i8]) -> Result<Vec<u8>, &'static str> {
    let mut packed = vec![0u8; weights.len().div_ceil(4)];
    for (i, &w) in weights.iter().enumerate() {
        let code = match w { 0 => 0, 1 => 1, -1 => 2, _ => return Err("weights must be -1, 0, 1") };
        packed[i / 4] |= code << (2 * (i % 4));
    }
    Ok(packed)
}

#[pymethods]
impl TernaryBlock {
    #[new]
    fn new(weights: Vec<i8>, rows: usize, cols: usize) -> PyResult<Self> {
        if rows == 0 || cols == 0 || rows.checked_mul(cols) != Some(weights.len()) {
            return Err(PyValueError::new_err("invalid dimensions"));
        }
        Ok(Self { rows, cols, packed: pack(&weights).map_err(PyValueError::new_err)? })
    }
    #[getter]
    fn nbytes(&self) -> usize { self.packed.len() }
    fn packed_bytes(&self) -> Vec<u8> { self.packed.clone() }
    fn matmul<'py>(&self, py: Python<'py>, x: PyReadonlyArray2<'py, f64>) -> PyResult<Bound<'py, PyArray2<f64>>> {
        let a = x.as_array();
        if a.ncols() != self.rows { return Err(PyValueError::new_err("input dimension mismatch")); }
        let batch = a.nrows();
        let input: Vec<f64> = a.iter().copied().collect();
        let mut output = vec![0.; batch * self.cols];
        py.allow_threads(|| {
            output.par_chunks_mut(self.cols).enumerate().for_each(|(n, out)| {
                for k in 0..self.rows {
                    let value = input[n*self.rows+k];
                    for (j, result) in out.iter_mut().enumerate() {
                        let i = k*self.cols+j;
                        match (self.packed[i/4] >> (2*(i%4))) & 3 {
                            1 => *result += value,
                            2 => *result -= value,
                            _ => (),
                        }
                    }
                }
            });
        });
        let result = Array2::from_shape_vec((batch,self.cols),output).map_err(|e|PyValueError::new_err(e.to_string()))?;
        Ok(PyArray2::from_owned_array(py,result))
    }
}

fn hadamard(values: &mut [f64]) -> Result<(), &'static str> {
    if !values.len().is_power_of_two() { return Err("length must be a nonzero power of two"); }
    let mut width=1;
    while width<values.len() {
        for base in (0..values.len()).step_by(2*width) {
            for j in 0..width {
                let a=values[base+j]; let b=values[base+j+width];
                values[base+j]=a+b; values[base+j+width]=a-b;
            }
        }
        width*=2;
    }
    Ok(())
}

#[pyfunction]
fn fast_hadamard_transform(mut values: Vec<f64>, normalize: bool) -> PyResult<Vec<f64>> {
    hadamard(&mut values).map_err(PyValueError::new_err)?;
    if normalize { let scale=(values.len() as f64).sqrt(); for x in &mut values { *x/=scale; } }
    Ok(values)
}

#[pyfunction]
fn kuramoto_step(py: Python<'_>, theta: Vec<f64>, omega: Vec<f64>, adjacency: Vec<f64>, lag: Vec<f64>, coupling: f64, dt: f64) -> PyResult<Vec<f64>> {
    let n=theta.len();
    if n==0 || omega.len()!=n || adjacency.len()!=n*n || lag.len()!=n*n || dt<=0. {
        return Err(PyValueError::new_err("invalid Kuramoto dimensions/dt"));
    }
    Ok(py.allow_threads(|| (0..n).into_par_iter().map(|i| {
        let sum: f64=(0..n).map(|j|adjacency[i*n+j]*(theta[j]-theta[i]-lag[i*n+j]).sin()).sum();
        (theta[i]+dt*(omega[i]+coupling*sum/n as f64)).rem_euclid(std::f64::consts::TAU)
    }).collect()))
}


#[pyfunction]
#[allow(clippy::too_many_arguments)]
fn adex_step(py: Python<'_>, v: Vec<f64>, w: Vec<f64>, dendrite: Vec<f64>, refractory: Vec<f64>, basal: Vec<f64>, apical: Vec<f64>, adapt_a: Vec<f64>, adapt_b: Vec<f64>, tau: Vec<f64>, dt: f64, nmda: bool) -> PyResult<(Vec<f64>,Vec<f64>,Vec<f64>,Vec<f64>,Vec<bool>)> {
    let n=v.len();
    if n==0 || [w.len(),dendrite.len(),refractory.len(),basal.len(),apical.len(),adapt_a.len(),adapt_b.len(),tau.len()].iter().any(|&len|len!=n) || dt<=0. || dt>1. || tau.iter().any(|&t|t<=0.) {
        return Err(PyValueError::new_err("invalid AdEx arrays/dt (0 < dt <= 1 ms)"));
    }
    let results: Vec<(f64,f64,f64,f64,bool)>=py.allow_threads(|| (0..n).into_par_iter().map(|i| {
        let nmda_current=if nmda { 30./(1.+(-(dendrite[i]+40.)/5.).exp()) } else { 0. };
        let d=dendrite[i]+dt*(-5.*(dendrite[i]+70.)+2.*(v[i]-dendrite[i])+apical[i]+nmda_current)/100.;
        let mut new_w=w[i]+dt*(adapt_a[i]*(v[i]+70.)-w[i])/tau[i];
        let mut r=(refractory[i]-dt).max(0.);
        let mut new_v=if refractory[i]>0. { -58. } else {
            v[i]+dt*(-10.*(v[i]+70.)+20.*((v[i]+50.)/2.).min(10.).exp()-w[i]+2.*(dendrite[i]-v[i])+basal[i])/200.
        };
        let spike=new_v>=20.;
        if spike { new_v=-58.;new_w+=adapt_b[i];r=2.; }
        (new_v,new_w,d,r,spike)
    }).collect());
    Ok((results.iter().map(|r|r.0).collect(),results.iter().map(|r|r.1).collect(),results.iter().map(|r|r.2).collect(),results.iter().map(|r|r.3).collect(),results.iter().map(|r|r.4).collect()))
}

#[pyfunction]
fn cascade_rk4(py: Python<'_>, state: Vec<f64>, matrix: Vec<f64>, drive: Vec<f64>, reservoirs: usize, dt: f64) -> PyResult<Vec<f64>> {
    if reservoirs==0 || state.len()%reservoirs!=0 || drive.len()!=state.len()/reservoirs || matrix.len()!=reservoirs*reservoirs || dt<=0. {
        return Err(PyValueError::new_err("invalid cascade shapes/dt"));
    }
    Ok(py.allow_threads(|| {
        let mut result=state.clone();
        result.par_chunks_mut(reservoirs).enumerate().for_each(|(index,out)| {
            let s=&state[index*reservoirs..(index+1)*reservoirs];
            let f=|v:&[f64]| -> Vec<f64> {(0..reservoirs).map(|i| {
                let value:f64=(0..reservoirs).map(|j|matrix[i*reservoirs+j]*v[j]).sum();
                value+if i==0 {drive[index]} else {0.}
            }).collect()};
            let advance=|k:&[f64],factor:f64| -> Vec<f64> {s.iter().zip(k).map(|(v,d)|v+dt*factor*d).collect()};
            let k1=f(s);let k2=f(&advance(&k1,0.5));let k3=f(&advance(&k2,0.5));let k4=f(&advance(&k3,1.));
            for i in 0..reservoirs {out[i]=s[i]+dt*(k1[i]+2.*k2[i]+2.*k3[i]+k4[i])/6.;}
        });
        result
    }))
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<TernaryBlock>()?;
    m.add_function(wrap_pyfunction!(adex_step,m)?)?;
    m.add_function(wrap_pyfunction!(cascade_rk4,m)?)?;
    m.add_function(wrap_pyfunction!(fast_hadamard_transform,m)?)?;
    m.add_function(wrap_pyfunction!(kuramoto_step,m)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn packing_and_invalid() { assert_eq!(pack(&[0,1,-1,0,1]).unwrap(),vec![36,1]); assert!(pack(&[2]).is_err()); }
    #[test]
    fn hadamard_involution() {
        let mut x=vec![1.,2.,3.,4.]; hadamard(&mut x).unwrap(); hadamard(&mut x).unwrap();
        assert_eq!(x,vec![4.,8.,12.,16.]); assert!(hadamard(&mut [1.,2.,3.]).is_err());
    }
}
