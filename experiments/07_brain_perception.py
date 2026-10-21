"""F-I curves and microcircuit spectra; biological reference acceptance is separate."""

import numpy as np
from nova.neuron import AdExPopulation
from nova.brain import Microcircuit, spectral_metrics
from nova.perception import PredictiveHierarchy
from experiments.common import write_report


def main():
    rows = []
    for seed in range(5):
        for current in (0.0, 200.0, 400.0, 600.0):
            model = AdExPopulation(20, seed=seed, backend="rust")
            counts = np.zeros(20)
            for _ in range(2000):
                counts += model.step((current, 0.0), dt=0.1)[0]
            rows.append(
                dict(
                    seed=seed,
                    condition="fi",
                    current_pa=current,
                    rate_hz=float(counts.mean() * 5),
                )
            )
        circuit = Microcircuit(100, seed=seed, backend="rust")
        spikes = []
        for _ in range(5000):
            spikes.append(circuit.step()[0])
        metrics = spectral_metrics(spikes, 0.1)
        hierarchy = PredictiveHierarchy(seed=seed)
        _, energy = hierarchy.infer(np.ones(8))
        rows.append(
            dict(
                seed=seed,
                condition="microcircuit",
                dale=circuit.check_dale(),
                prediction_energy_before=energy[0],
                prediction_energy_after=energy[-1],
                **metrics,
            )
        )
    write_report(
        7,
        rows,
        "AdEx Python/Rust com dois compartimentos; curvas F–I (200 ms por corrente); microcircuito E/PV/SST/VIP esparso (500 ms); relaxamento preditivo. Cinco sementes.",
        "Modelos N0/N1/N2, áudio log-mel em fluxo, visão foveal, texto, slots e fusão têm testes. Não há registros Allen/Blue Brain fornecidos nem ajuste de parâmetros contra eles. Banda gama é medida, não garantida; estes números não constituem validação biológica. Comparador de referências e importador de conectoma CSV implementados. Escala cluster e hardware neuromórfico não validados.",
    )


if __name__ == "__main__":
    main()
