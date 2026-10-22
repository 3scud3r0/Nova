"""Beer-Lambert, HG phase, diffuse BSSRDF profile and complex thin-film optics."""

import numpy as np


def beer_lambert(absorption, scattering, distance):
    a, s, d = np.broadcast_arrays(absorption, scattering, distance)
    if not all(np.isfinite(x).all() for x in (a, s, d)) or np.any(
        (a < 0) | (s < 0) | (d < 0)
    ):
        raise ValueError("finite nonnegative extinction and distance required")
    return np.exp(-(a + s) * d)


def henyey_greenstein(cosine, g):
    c = np.asarray(cosine, dtype=float)
    if not np.isfinite(c).all() or np.any(abs(c) > 1) or not -0.99 <= g <= 0.99:
        raise ValueError("phase domain exceeded")
    return (1 - g * g) / (4 * np.pi * (1 + g * g - 2 * g * c) ** 1.5)


def burley_profile(radius, diffusion_length):
    r, d = np.broadcast_arrays(radius, diffusion_length)
    if (
        not np.isfinite(r).all()
        or not np.isfinite(d).all()
        or np.any(r <= 0)
        or np.any(d <= 0)
    ):
        raise ValueError(
            "positive radius/diffusion length required; profile singularity is integrable at zero"
        )
    return (np.exp(-r / d) + np.exp(-r / (3 * d))) / (8 * np.pi * d * r)


def thin_film_reflectance(
    wavelength_nm, thickness_nm, cos_incident=1.0, n0=1.0, n1=1.33, n2=1.5
):
    wavelength = np.asarray(wavelength_nm, dtype=float)
    if (
        np.any(wavelength <= 0)
        or not np.isfinite(wavelength).all()
        or not np.isfinite(thickness_nm)
        or thickness_nm < 0
        or not 0 < cos_incident <= 1
    ):
        raise ValueError("invalid optical geometry/wavelength")
    # Complex refractive indices permit absorbing film/substrate. Branch chosen
    # with nonnegative forward attenuation; wavelengths/thickness share units.
    n0, n1, n2 = complex(n0), complex(n1), complex(n2)
    if any(
        n.real <= 0 or n.imag < 0 or not np.isfinite([n.real, n.imag]).all()
        for n in (n0, n1, n2)
    ):
        raise ValueError("passive refractive indices required")
    sin2 = 1 - cos_incident * cos_incident
    c1 = np.sqrt(1 - (n0 / n1) ** 2 * sin2 + 0j)
    c2 = np.sqrt(1 - (n0 / n2) ** 2 * sin2 + 0j)
    if (n1 * c1).imag < 0:
        c1 = -c1
    if (n2 * c2).imag < 0:
        c2 = -c2
    r01s = (n0 * cos_incident - n1 * c1) / (n0 * cos_incident + n1 * c1)
    r12s = (n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2)
    r01p = (n1 * cos_incident - n0 * c1) / (n1 * cos_incident + n0 * c1)
    r12p = (n2 * c1 - n1 * c2) / (n2 * c1 + n1 * c2)
    propagation = np.exp(4j * np.pi * n1 * c1 * thickness_nm / wavelength)
    s = (r01s + r12s * propagation) / (1 + r01s * r12s * propagation)
    p = (r01p + r12p * propagation) / (1 + r01p * r12p * propagation)
    return np.clip(0.5 * (np.abs(s) ** 2 + np.abs(p) ** 2), 0, 1)


def aces_fitted(linear_rgb, exposure=1.0):
    x = np.asarray(linear_rgb, dtype=float) * exposure
    if not np.isfinite(x).all() or np.any(x < 0):
        raise ValueError("finite nonnegative HDR radiance required")
    return np.clip(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)


def diffraction_psf(size=128, aperture_radius=0.4, blades=0):
    if (
        not 32 <= size <= 512
        or not 0.05 <= aperture_radius <= 0.49
        or not 0 <= blades <= 12
        or blades in (1, 2)
    ):
        raise ValueError("pupil discretization budget exceeded")
    axis = (np.arange(size) - size / 2) / size
    x, y = np.meshgrid(axis, axis)
    radius = np.sqrt(x * x + y * y)
    boundary = np.full_like(radius, aperture_radius)
    if blades:
        theta = np.arctan2(y, x)
        sector = (theta + np.pi / blades) % (2 * np.pi / blades) - np.pi / blades
        boundary = aperture_radius * np.cos(np.pi / blades) / np.cos(sector)
    pupil = (radius <= boundary).astype(float)
    field = np.fft.fftshift(np.fft.fft2(np.fft.ifftshift(pupil)))
    intensity = abs(field) ** 2
    return intensity / intensity.sum()
