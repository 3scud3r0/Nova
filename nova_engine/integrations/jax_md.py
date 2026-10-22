"""JAX-MD Lennard-Jones control backend (distinct from directed Particle Life)."""
def create(positions, *, seed=42, dt=0.001, temperature=0.1, sigma=0.1):
    import jax
    import jax.numpy as jnp
    from jax_md import space, energy, simulate
    positions = jnp.asarray(positions)
    if positions.ndim != 2 or positions.shape[1] != 3 or len(positions) > 8192:
        raise ValueError("expected bounded 3D positions")
    displacement, shift = space.free()
    potential = energy.lennard_jones_pair(displacement, sigma=sigma)
    init, step = simulate.nve(potential, shift, dt=dt)
    state = init(jax.random.PRNGKey(seed), positions, kT=temperature)
    return state, jax.jit(step), potential
