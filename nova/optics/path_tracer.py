"""Bounded spectral Monte Carlo reference with NEE/MIS, dielectric spheres and HG.

Independent CPU calibration scene; not a production BDPT/ReSTIR pipeline or the
browser particle scene. Wavelength-to-XYZ uses analytic CIE fits, not a measured
spectral camera. No rendered result is asserted without an explicit execution.
"""

from dataclasses import dataclass

import numpy as np

from nova.bioma.determinism import SplitMix64

from .transport import aces_fitted, henyey_greenstein, thin_film_reflectance


@dataclass(frozen=True)
class Sphere:
    center: tuple
    radius: float
    pigment: tuple = (0.5, 0.5, 0.5)
    material: str = "diffuse"
    emission: float = 0.0
    ior: float = 1.45
    film_nm: float = 0.0
    scattering: float = 2.0


def unit(v):
    return v / max(np.linalg.norm(v), 1e-15)


def xyz_fit(w):
    def gaussian(mu, left, right):
        return np.exp(-0.5 * ((w - mu) * (left if w < mu else right)) ** 2)

    return np.array(
        [
            0.362 * gaussian(442.0, 0.0624, 0.0374)
            + 1.056 * gaussian(599.8, 0.0264, 0.0323)
            - 0.065 * gaussian(501.1, 0.049, 0.0382),
            0.821 * gaussian(568.8, 0.0213, 0.0247)
            + 0.286 * gaussian(530.9, 0.0613, 0.0322),
            1.217 * gaussian(437.0, 0.0845, 0.0278)
            + 0.681 * gaussian(459.0, 0.0385, 0.0725),
        ]
    )


def spectrum(rgb, wavelength):
    weights = np.exp(-0.5 * ((wavelength - np.array([620.0, 535.0, 450.0])) / 45) ** 2)
    weights /= max(weights.sum(), 1e-12)
    return float(np.clip(np.asarray(rgb) @ weights, 0.005, 0.99))


def basis(direction):
    w = unit(direction)
    u = unit(np.cross([0, 1, 0] if abs(w[1]) < 0.9 else [1, 0, 0], w))
    return u, np.cross(w, u), w


def cosine_sample(normal, rng):
    u, v, w = basis(normal)
    a = 2 * np.pi * rng.uniform((1,))[0]
    r = np.sqrt(rng.uniform((1,))[0])
    return unit(u * r * np.cos(a) + v * r * np.sin(a) + w * np.sqrt(max(0, 1 - r * r)))


def hg_sample(direction, g, rng):
    r = float(rng.uniform((1,))[0])
    cosine = (
        1 - 2 * r
        if abs(g) < 1e-6
        else (1 + g * g - ((1 - g * g) / (1 - g + 2 * g * r)) ** 2) / (2 * g)
    )
    sine = np.sqrt(max(0, 1 - cosine * cosine))
    angle = 2 * np.pi * rng.uniform((1,))[0]
    u, v, w = basis(direction)
    return unit(sine * (np.cos(angle) * u + np.sin(angle) * v) + cosine * w)


class SpectralPathTracer:
    def __init__(
        self,
        spheres=None,
        *,
        seed=42,
        max_bounces=8,
        scattering=0.05,
        absorption=0.01,
        g=0.25,
    ):
        self.spheres = spheres or [
            Sphere((0, -1001, 0), 1000, (0.25, 0.26, 0.3)),
            Sphere((-0.65, 0, 0), 0.68, (0.9, 0.05, 0.2), "dielectric", film_nm=350),
            Sphere((0.65, 0, -0.1), 0.65, (0.03, 0.35, 0.9), "dielectric", film_nm=620),
            Sphere((0, 2.8, 1.0), 0.65, (1, 1, 1), "diffuse", emission=20.0),
        ]
        if (
            len(self.spheres) > 64
            or not 1 <= max_bounces <= 16
            or not 0 <= scattering <= 10
            or not 0 <= absorption <= 10
            or not -0.95 <= g <= 0.95
        ):
            raise ValueError("optical scene/path budget exceeded")
        for s in self.spheres:
            if (
                len(s.center) != 3
                or len(s.pigment) != 3
                or not np.isfinite(
                    [*s.center, *s.pigment, s.radius, s.emission, s.ior, s.film_nm]
                ).all()
                or s.radius <= 0
                or s.material not in ("diffuse", "dielectric")
                or not 1 <= s.ior <= 3
                or s.emission < 0
                or s.film_nm < 0
                or not 0 <= s.scattering <= 100
                or any(not 0 < c <= 1 for c in s.pigment)
            ):
                raise ValueError("invalid optical sphere")
        self.rng = SplitMix64(seed)
        self.max_bounces = max_bounces
        self.scattering = scattering
        self.absorption = absorption
        self.g = g
        self.lights = [i for i, s in enumerate(self.spheres) if s.emission > 0]

    def hit(self, origin, direction, limit=np.inf):
        best = limit
        selected = None
        for i, s in enumerate(self.spheres):
            offset = origin - np.asarray(s.center)
            b = offset @ direction
            c = offset @ offset - s.radius * s.radius
            d = b * b - c
            if d < 0:
                continue
            root = np.sqrt(d)
            near = -b - root
            far = -b + root
            t = near if near > 1e-5 else far
            if 1e-5 < t < best:
                best = t
                selected = i
        return best, selected

    def direct(self, p, normal, incoming, wavelength, phase=False):
        if not self.lights:
            return 0.0
        light_id = self.lights[int(self.rng.integers(0, len(self.lights), (1,))[0])]
        light = self.spheres[light_id]
        z = self.rng.uniform((1,), -1, 1)[0]
        angle = self.rng.uniform((1,), 0, 2 * np.pi)[0]
        n = np.array(
            [np.sqrt(1 - z * z) * np.cos(angle), z, np.sqrt(1 - z * z) * np.sin(angle)]
        )
        point = np.asarray(light.center) + light.radius * n
        d = point - p
        distance = np.linalg.norm(d)
        direction = d / max(distance, 1e-12)
        cos_light = max(0, -n @ direction)
        if cos_light <= 0:
            return 0.0
        hit_distance, hit_id = self.hit(
            p + direction * 1e-4, direction, distance + 1e-3
        )
        if hit_id != light_id or abs(hit_distance - distance) > 2e-3:
            return 0.0
        light_pdf = (
            distance
            * distance
            / (4 * np.pi * light.radius**2 * cos_light * len(self.lights))
        )
        bsdf_pdf = (
            float(henyey_greenstein(np.clip(incoming @ direction, -1, 1), self.g))
            if phase
            else max(0, normal @ direction) / np.pi
        )
        mis = light_pdf**2 / (light_pdf**2 + bsdf_pdf**2)
        return (
            light.emission
            * np.exp(-(self.absorption + self.scattering) * distance)
            * bsdf_pdf
            / light_pdf
            * mis
        )

    def trace(self, origin, direction, wavelength):
        throughput = 1.0
        radiance = 0.0
        inside = None
        previous_pdf = 0.0
        previous_point = origin
        previous_nee = False
        for bounce in range(self.max_bounces):
            distance, index = self.hit(origin, direction)
            if distance > 20.0:
                index = None
                distance = 20.0
            max_distance = min(distance, 20.0)
            sigma_a = self.absorption
            sigma_s = self.scattering
            if inside is not None:
                sigma_s += self.spheres[inside].scattering
                sigma_a += (
                    -np.log(spectrum(self.spheres[inside].pigment, wavelength)) * 1.5
                )
            sigma_t = sigma_a + sigma_s
            free = (
                -np.log(max(float(self.rng.uniform((1,))[0]), 2.0**-53)) / sigma_t
                if sigma_t > 0
                else np.inf
            )
            if free < max_distance:
                origin = origin + direction * free
                throughput *= sigma_s / max(sigma_t, 1e-20)
                if throughput <= 0:
                    break
                if inside is None:
                    radiance += throughput * self.direct(
                        origin, None, direction, wavelength, phase=True
                    )
                old_direction = direction
                direction = hg_sample(direction, self.g, self.rng)
                previous_pdf = float(
                    henyey_greenstein(np.clip(old_direction @ direction, -1, 1), self.g)
                )
                previous_point = origin.copy()
                previous_nee = inside is None
                origin += direction * 1e-4
            else:
                if index is None:
                    radiance += throughput * 0.025
                    break
                p = origin + distance * direction
                s = self.spheres[index]
                outward = unit(p - np.asarray(s.center))
                front = direction @ outward < 0
                normal = outward if front else -outward
                if s.emission:
                    weight = 1.0
                    if previous_nee and previous_pdf > 0:
                        cos_light = max(0, -outward @ direction)
                        light_pdf = np.linalg.norm(p - previous_point) ** 2 / max(
                            4 * np.pi * s.radius**2 * cos_light * len(self.lights),
                            1e-20,
                        )
                        weight = previous_pdf**2 / (previous_pdf**2 + light_pdf**2)
                    radiance += throughput * s.emission * weight
                    break
                previous_point = p.copy()
                if s.material == "diffuse":
                    albedo = spectrum(s.pigment, wavelength)
                    radiance += (
                        throughput
                        * albedo
                        * self.direct(p, normal, direction, wavelength)
                    )
                    direction = cosine_sample(normal, self.rng)
                    throughput *= albedo
                    previous_pdf = max(normal @ direction, 0) / np.pi
                    previous_nee = True
                else:
                    eta_i, eta_t = (1.0, s.ior) if front else (s.ior, 1.0)
                    eta = eta_i / eta_t
                    cosine = max(0, -direction @ normal)
                    sin2 = eta * eta * (1 - cosine * cosine)
                    if sin2 >= 1:
                        fresnel = 1.0
                    else:
                        c2 = np.sqrt(1 - sin2)
                        rs = (eta_i * cosine - eta_t * c2) / (
                            eta_i * cosine + eta_t * c2
                        )
                        rp = (eta_t * cosine - eta_i * c2) / (
                            eta_t * cosine + eta_i * c2
                        )
                        fresnel = 0.5 * (rs * rs + rp * rp)
                        if front and s.film_nm:
                            fresnel = float(
                                thin_film_reflectance(
                                    wavelength,
                                    s.film_nm,
                                    s.scattering,
                                    max(cosine, 1e-6),
                                    n0=eta_i,
                                    n1=1.33,
                                    n2=eta_t,
                                )
                            )
                    if self.rng.uniform((1,))[0] < fresnel:
                        direction = unit(direction + 2 * cosine * normal)
                    else:
                        direction = unit(
                            eta * direction
                            + (eta * cosine - np.sqrt(max(0, 1 - sin2))) * normal
                        )
                        throughput *= eta * eta
                        inside = index if front else None
                    previous_pdf = 0.0
                    previous_nee = False
                origin = p + direction * 1e-4
            if bounce >= 3:
                survival = float(np.clip(throughput, 0.05, 0.95))
                if self.rng.uniform((1,))[0] > survival:
                    break
                throughput /= survival
        return radiance

    def render(self, width=128, height=96, samples=16, *, aperture=0.015, focus=3.6):
        if (
            not 16 <= width <= 512
            or not 16 <= height <= 512
            or not 1 <= samples <= 256
            or width * height * samples > 8_000_000
            or not 0 <= aperture <= 0.2
            or not 1 <= focus <= 10
        ):
            raise ValueError("CPU spectral render budget exceeded")
        eye = np.array([0.0, 0.65, 3.5])
        forward = unit(np.array([0.0, 0.0, 0.0]) - eye)
        right = unit(np.cross(forward, [0, 1, 0]))
        up = np.cross(right, forward)
        xyz = np.zeros((height, width, 3))
        for y in range(height):
            for x in range(width):
                for _ in range(samples):
                    jitter = self.rng.uniform((2,))
                    u = (2 * (x + jitter[0]) / width - 1) * width / height * 0.35
                    v = (1 - 2 * (y + jitter[1]) / height) * 0.35
                    direction = unit(forward + u * right + v * up)
                    focus_point = eye + direction * focus / (direction @ forward)
                    radius = aperture * np.sqrt(self.rng.uniform((1,))[0])
                    angle = 2 * np.pi * self.rng.uniform((1,))[0]
                    origin = eye + radius * (np.cos(angle) * right + np.sin(angle) * up)
                    direction = unit(focus_point - origin)
                    wavelength = 380 + 400 * self.rng.uniform((1,))[0]
                    xyz[y, x] += (
                        self.trace(origin, direction, wavelength)
                        * xyz_fit(wavelength)
                        * 400
                        / (106.856895 * samples)
                    )
        matrix = np.array(
            [
                [3.2406, -1.5372, -0.4986],
                [-0.9689, 1.8758, 0.0415],
                [0.0557, -0.204, 1.057],
            ]
        )
        hdr = np.maximum(xyz @ matrix.T, 0)
        display = aces_fitted(hdr) ** (1 / 2.2)
        return hdr, np.rint(display * 255).astype(np.uint8)
