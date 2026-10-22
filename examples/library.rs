use nova_physics::{Config, Universe};
fn main() -> anyhow::Result<()> {
    let mut universe = Universe::new(4096, Config::default())?;
    universe.step(100)?;
    let positions = &universe.particles.positions; // aligned, borrowed, no serialization
    println!("{} particles at tick {}", positions.len(), universe.tick);
    Ok(())
}
