//! Read-only NumPy views own an Arc snapshot; stepping requires exclusive ownership.
use nova_core::{Lineage, Particle};
use nova_physics::{Config, Universe};
use numpy::{ndarray::ArrayView2, PyArray2, PyArrayMethods};
use pyo3::{
    exceptions::{PyRuntimeError, PyValueError},
    prelude::*,
};
use std::sync::Arc;
fn value(e: impl std::fmt::Display) -> PyErr {
    PyValueError::new_err(e.to_string())
}
#[pyclass(name = "Universe")]
struct PyUniverse {
    inner: Arc<Universe>,
}
#[pyclass(frozen)]
struct Snapshot {
    inner: Arc<Universe>,
}
#[pymethods]
impl PyUniverse {
    #[new]
    #[pyo3(signature=(particles=4096,seed=42,preset="particle-life",enable_crossover=false,max_particles=262144))]
    fn new(
        particles: usize,
        seed: u64,
        preset: &str,
        enable_crossover: bool,
        max_particles: usize,
    ) -> PyResult<Self> {
        let mut config = Config {
            seed,
            max_particles,
            ..Default::default()
        };
        match preset {
            "particle-life" => (),
            "cosmic-ink" => config.curl = 0.4,
            "particle-vm" => {
                config.pvm = true;
                config.crossover = enable_crossover;
            }
            "liquid-mpm" => {
                config.mpm = true;
                config.dt = 0.001;
            }
            "hunar" | "realethersim" | "primordial-dish" | "par-particle-life" | "fusion"
            | "cellflow" => {
                config.fusion = Some(nova_physics::fusion_family(preset).map_err(value)?);
            }
            _ => {
                return Err(value(
                    "unknown preset; use a Nova preset or hunar, realethersim, primordial-dish, par-particle-life, cellflow, fusion",
                ))
            }
        }
        if enable_crossover && !config.pvm {
            return Err(value("crossover requires particle-vm"));
        }
        Ok(Self {
            inner: Arc::new(Universe::new(particles, config).map_err(value)?),
        })
    }
    fn step(&mut self, py: Python<'_>, ticks: usize) -> PyResult<()> {
        let u=Arc::get_mut(&mut self.inner).ok_or_else(||PyRuntimeError::new_err("release Snapshot and all its array/tensor views before stepping; views pin simulation memory"))?;
        py.allow_threads(|| u.step(ticks)).map_err(value)
    }
    fn enable_neural(&mut self) -> PyResult<()> {
        let u = Arc::get_mut(&mut self.inner)
            .ok_or_else(|| value("release snapshots before enabling neural organisms"))?;
        u.enable_neural(Default::default()).map_err(value)
    }
    fn neural_statistics(&self) -> PyResult<String> {
        serde_json::to_string(&self.inner.neural.as_ref().map(|n| &n.stats)).map_err(value)
    }
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            inner: self.inner.clone(),
        }
    }
    #[getter]
    fn tick(&self) -> u64 {
        self.inner.tick
    }
    fn __len__(&self) -> usize {
        self.inner.particles.len()
    }
    fn set_affinities(&mut self, matrix: Vec<Vec<f32>>) -> PyResult<()> {
        if matrix.len() != 8
            || matrix
                .iter()
                .any(|r| r.len() != 8 || r.iter().any(|v| !v.is_finite() || v.abs() > 1.))
        {
            return Err(value("expected finite 8x8 matrix in [-1,1]"));
        }
        let u = Arc::get_mut(&mut self.inner)
            .ok_or_else(|| value("release all snapshots before mutation"))?;
        for (i, row) in matrix.iter().enumerate() {
            u.matrix[i].copy_from_slice(row);
        }
        Ok(())
    }
    fn inject(
        &mut self,
        position: [f32; 3],
        velocity: [f32; 3],
        mass: f32,
        radius: f32,
        species: u32,
        genome: [u8; 16],
    ) -> PyResult<u64> {
        let u = Arc::get_mut(&mut self.inner)
            .ok_or_else(|| value("release all snapshots before mutation"))?;
        if u.config.mpm || u.fusion.is_some() {
            return Err(value("MPM/fusion membership is fixed for a run"));
        }
        if u.particles.len() >= u.config.max_particles {
            return Err(value("particle capacity exceeded"));
        }
        let p = Particle {
            pos_rad: [position[0], position[1], position[2], radius],
            vel_mass: [velocity[0], velocity[1], velocity[2], mass],
            phenotype: [species, 0, 0, 10000],
            genome_tape: genome,
        };
        u.particles
            .push(p, Lineage::new(&genome, vec![], 0, u.tick))
            .map_err(value)
    }
}
#[pymethods]
impl Snapshot {
    #[getter]
    fn tick(&self) -> u64 {
        self.inner.tick
    }
    #[getter]
    fn positions<'py>(this: Bound<'py, Self>) -> Bound<'py, PyArray2<f32>> {
        let (ptr, n) = {
            let owner = this.borrow();
            (
                owner.inner.particles.positions.as_ptr().cast::<f32>(),
                owner.inner.particles.len(),
            )
        };
        // SAFETY: Float4 is contiguous 16-byte POD with no padding. Snapshot owns
        // the Arc; Universe cannot mutate/reallocate while any snapshot exists.
        let view = unsafe { ArrayView2::from_shape_ptr((n, 4), ptr) };
        let array = unsafe { PyArray2::borrow_from_array(&view, this.into_any()) };
        array.readwrite().make_nonwriteable();
        array
    }
    #[getter]
    fn velocities<'py>(this: Bound<'py, Self>) -> Bound<'py, PyArray2<f32>> {
        let (ptr, n) = {
            let owner = this.borrow();
            (
                owner.inner.particles.velocities.as_ptr().cast::<f32>(),
                owner.inner.particles.len(),
            )
        };
        let view = unsafe { ArrayView2::from_shape_ptr((n, 4), ptr) };
        let array = unsafe { PyArray2::borrow_from_array(&view, this.into_any()) };
        array.readwrite().make_nonwriteable();
        array
    }
    #[getter]
    fn genomes<'py>(this: Bound<'py, Self>) -> Bound<'py, PyArray2<u8>> {
        let (ptr, n) = {
            let owner = this.borrow();
            (
                owner.inner.particles.genomes.as_ptr().cast::<u8>(),
                owner.inner.particles.len(),
            )
        };
        let view = unsafe { ArrayView2::from_shape_ptr((n, 16), ptr) };
        let array = unsafe { PyArray2::borrow_from_array(&view, this.into_any()) };
        array.readwrite().make_nonwriteable();
        array
    }
}
#[pyclass(name = "Conway")]
struct PyConway {
    inner: nova_physics::conway::Conway,
}
#[pymethods]
impl PyConway {
    #[new]
    #[pyo3(signature=(width=2048,height=2048,rule="B3/S23",seed=42))]
    fn new(width: usize, height: usize, rule: &str, seed: u64) -> PyResult<Self> {
        Ok(Self {
            inner: nova_physics::conway::Conway::new(
                width,
                height,
                nova_physics::conway::Rule::parse(rule).map_err(value)?,
                seed,
            )
            .map_err(value)?,
        })
    }
    fn step(&mut self, py: Python<'_>, ticks: usize) -> PyResult<()> {
        if ticks > 1_000_000 {
            return Err(value("tick budget exceeded"));
        }
        py.allow_threads(|| {
            for _ in 0..ticks {
                self.inner.step()
            }
        });
        Ok(())
    }
    #[getter]
    fn population(&self) -> u64 {
        self.inner.population()
    }
    fn words(&self) -> Vec<u64> {
        self.inner.words.clone()
    }
}
#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyUniverse>()?;
    m.add_class::<Snapshot>()?;
    m.add_class::<PyConway>()?;
    Ok(())
}
