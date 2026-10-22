import numpy as np
import pytest

from nova.optics.reservoir import Reservoir
from nova.optics.transport import (
    beer_lambert,
    burley_profile,
    diffraction_psf,
    henyey_greenstein,
    thin_film_reflectance,
)


def test_extinction_composes_along_segments():
    a = beer_lambert(0.2, 0.3, 2.0)
    b = beer_lambert(0.2, 0.3, 3.0)
    assert abs(a * b - beer_lambert(0.2, 0.3, 5.0)) < 1e-14
    with pytest.raises(ValueError):
        beer_lambert(-1, 0, 1)


def test_hg_phase_integrates_to_one_on_sphere():
    cosine = np.linspace(-1, 1, 20001)
    assert (
        abs(2 * np.pi * np.trapezoid(henyey_greenstein(cosine, 0.6), cosine) - 1) < 1e-6
    )


def test_normalized_diffusion_profile_integrates_over_surface():
    radius = np.linspace(1e-7, 60, 100001)
    assert (
        abs(np.trapezoid(2 * np.pi * radius * burley_profile(radius, 1.0), radius) - 1)
        < 1e-6
    )


def test_zero_thickness_film_reduces_to_bare_interface():
    reflectance = thin_film_reflectance(
        np.array([450.0, 550.0, 650.0]), 0, n0=1.0, n1=1.33, n2=1.5
    )
    np.testing.assert_allclose(reflectance, 0.04, atol=1e-12)


def test_pupil_psf_conserves_normalized_power():
    psf = diffraction_psf(64, blades=6)
    assert psf.min() >= 0 and abs(psf.sum() - 1) < 1e-12
    assert np.argmax(psf) == 32 * 64 + 32


def test_ris_constant_integrand_has_correct_normalization():
    reservoir = Reservoir(1)
    for i in range(100):
        reservoir.update(i, 1.0, 1.0)
    assert reservoir.estimate(1.0) == 1.0
