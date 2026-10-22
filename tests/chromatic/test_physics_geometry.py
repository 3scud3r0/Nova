"""Future physics/topology checks; not executed during delivery."""

import numpy as np

from nova.geometry.clifford import Clifford
from nova.geometry.dec import SimplicialComplex
from nova.geometry.dynamics import yoshida4
from nova.geometry.sdf import sphere, sphere_trace
from nova.matter.chemistry import (
    GillespieReactor,
    onsager_flux,
    regular_solution,
    regular_solution_binodal,
)
from nova.matter.constitutive import (
    herschel_bulkley,
    immersed_drag,
    saint_venant_kirchhoff,
    thixotropic_structure,
)
from nova.matter.mpm import MaterialPointSystem, MPMConfig
from nova.matter.particle_life import ParticleLife, ParticleLifeConfig, radial_force


def test_actual_affinity_law_changes_force_sign_and_has_repulsive_core():
    assert radial_force(0.1, 0.9) < 0
    assert radial_force(0.6, 0.9) > 0
    assert radial_force(0.6, -0.9) < 0
    assert radial_force(1.2, 0.9) == 0


def test_symmetric_two_particle_pair_preserves_total_momentum_without_damping():
    simulation = ParticleLife(ParticleLifeConfig(count=2, cutoff=0.3, damping=0))
    simulation.position = np.array([[-0.1, 0, 0], [0.1, 0, 0]])
    simulation.types[:] = 0
    simulation.step()
    np.testing.assert_allclose(simulation.velocity.sum(0), 0.0, atol=1e-14)
    assert simulation.velocity[0, 0] > 0


def test_rigid_rotation_has_zero_stvk_strain_energy():
    angle = 0.37
    F = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    stress, energy = saint_venant_kirchhoff(F, 3.0, 4.0)
    np.testing.assert_allclose(stress, 0.0, atol=1e-12)
    assert abs(energy) < 1e-20


def test_immersed_action_and_reaction_balance():
    body, fluid = immersed_drag(
        np.array([1.0, 0.0, 0.0]), np.zeros((3, 3)), [1, 2, 3], drag=2.0
    )
    np.testing.assert_allclose(body + fluid.sum(0), 0.0, atol=1e-15)


def test_thixotropic_state_stays_bounded_and_shear_thins():
    state = thixotropic_structure(np.ones(4), np.array([0, 1, 10, 100]), 0.1)
    assert np.all((state >= 0) & (state <= 1)) and state[-1] < state[0]
    assert herschel_bulkley(100.0) < herschel_bulkley(1.0)


def test_mpm_uniform_translation_without_stress_or_gravity():
    model = MaterialPointSystem(
        MPMConfig(particles=64, grid=16, mu=0, lam=0, bulk=0, gravity=0)
    )
    velocity = np.array([0.01, 0.005, 0])
    model.v[:] = velocity
    model.step()
    np.testing.assert_allclose(model.v, np.tile(velocity, (64, 1)), atol=1e-12)


def test_psd_onsager_matrix_produces_nonnegative_entropy():
    flux, entropy = onsager_flux(
        np.array([[1.0, -2.0], [-3.0, 0.5]]), np.array([[2.0, 0.5], [0.5, 1.0]])
    )
    assert flux.shape == (2, 2) and np.all(entropy >= 0)


def test_symmetric_mixture_binodal_is_common_tangent():
    phases = regular_solution_binodal(3.0)["fractions"]
    free, chemical = regular_solution(np.array(phases), 300.0, 3.0)
    np.testing.assert_allclose(chemical, 0.0, atol=1e-8)
    assert abs(free[0] - free[1]) < 1e-9


def test_stochastic_conversion_preserves_molecule_count():
    reactor = GillespieReactor([[1, 0]], [[0, 1]], [1.0], [100, 0], seed=4)
    reactor.step(10.0)
    assert reactor.counts.sum() == 100 and np.all(reactor.counts >= 0)


def test_dec_boundary_squared_and_disk_cohomology():
    mesh = SimplicialComplex([[0, 0], [1, 0], [1, 1], [0, 1]], [(0, 1, 2), (0, 2, 3)])
    assert mesh.chain_residual() == [0]
    assert mesh.betti() == [1, 0, 0]
    assert abs(mesh.gaussian_curvature().sum() - 2 * np.pi) < 1e-12


def test_conformal_embedding_is_null_and_encodes_distance():
    algebra = Clifford()
    a = algebra.conformal_point([1, 2, 3])
    b = algebra.conformal_point([2, 0, 1])
    assert abs(algebra.product(a, a)[0]) < 1e-12
    assert abs(algebra.product(a, b)[0] + 0.5 * (1 + 4 + 4)) < 1e-12


def test_yoshida_harmonic_energy_bounded_in_declared_regime():
    q, p = np.array([1.0]), np.array([0.0])
    energies = []
    for _ in range(1000):
        q, p = yoshida4(q, p, lambda x: -x, 0.05)
        energies.append(float(0.5 * (q @ q + p @ p)))
    assert np.ptp(energies) < 1e-5


def test_true_sdf_sphere_trace_returns_first_surface():
    result = sphere_trace(lambda p: sphere(p), [0, 0, 3], [0, 0, -1])
    assert result["hit"] and abs(result["distance"] - 2) < 1e-4
